;; Bounded Otehon integration experiment. This is not a production file API.
(require '[cheshire.core :as json] '[clojure.edn :as edn] '[clojure.java.io :as io]
         '[babashka.classpath :as cp] '[awai.fs.car :as car]
         '[otehon.storage :as store] '[otehon.pack-store :as pack])
(import '[java.io ByteArrayOutputStream] '[java.nio.file Files Paths CopyOption StandardCopyOption]
        '[java.security MessageDigest] '[java.util Arrays HexFormat])
(def leaf 65536)
(def part-size (* 8 leaf))
(def size (* 4 part-size))
(def fixtures (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack"))
(defn insist [v message] (when-not v (throw (ex-info message {}))))
(defn bytevec [b] (mapv #(bit-and 255 %) b))
(defn array [v] (byte-array (map unchecked-byte v)))
(defn digest [b] (bytevec (.digest (MessageDigest/getInstance "SHA-256") b)))
(defn cid [codec b] (car/cid-str (car/cid-bytes codec (digest b))))
(defn make-data [] (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range size))))
(defn bytes-file [name] (Files/readAllBytes (Paths/get (str fixtures "/" name) (make-array String 0))))
(defn logical [size leaf chunks]
  (car/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" size
                    "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" leaf}
                    "chunks" (mapv (fn [{:keys [cid length offset]}]
                                     {"cid" {:tag 42 :bytes (car/base32-decode (subs cid 1))}
                                      "length" length "offset" offset}) chunks)}))
(defn corpus-check []
  (let [case (json/parse-string (slurp (str fixtures "/logical-file-corpus.json")) true)
        input (:input case)
        bytes (array (logical (:size input) (get-in input [:profile :leafSize]) (:chunks input)))]
    (insist (= (:wireHex case) (.formatHex (HexFormat/of) bytes)) "shared corpus bytes differ")
    (insist (= (:cid case) (cid car/codec-dag-cbor bytes)) "shared corpus CID differs")
    {:case (:name case) :cid (:cid case)}))
(defn manifest [data]
  (let [chunks (mapv (fn [offset] (let [b (Arrays/copyOfRange data offset (+ offset leaf))]
                                   {:offset offset :length leaf :cid (cid car/codec-raw b)}))
                     (range 0 size leaf))
        bytes (array (logical size leaf chunks))]
    {:cid (cid car/codec-dag-cbor bytes) :wire (.formatHex (HexFormat/of) bytes) :chunks chunks}))
(defn read-all [h]
  (with-open [out (ByteArrayOutputStream.)]
    (doseq [i (range 4)] (.write out ^bytes (pack/read-data h (str "part-" i))))
    (.toByteArray out)))
(defn read-range [h offset length]
  (with-open [out (ByteArrayOutputStream.)]
    (doseq [i (range 4)
            :let [base (* i part-size) lo (max offset base) hi (min (+ offset length) (+ base part-size))]
            :when (< lo hi)]
      (.write out ^bytes (pack/read-range-verified-leaves h (str "part-" i) (- lo base) (- hi lo))))
    (.toByteArray out)))
(defn verify [dir profile]
  (let [original (make-data) expected (manifest original)
        saved (edn/read-string (get-in (store/read-store dir) [:state "proof/logical-file"]))
        h (pack/recover dir) before (pack/summary h)]
    (insist (= expected saved) "persisted logical manifest differs")
    (insist (zero? (get-in before [:stats :cache-entries-before])) "cache was not empty")
    (insist (= 4 (count (:files before))) "not four packs")
    (insist (Arrays/equals original (read-all h)) "file bytes differ")
    (doseq [[off n] [[0 4096] [(- part-size 20) 40] [(- (* 2 part-size) 13) 50] [(- size 20) 20]]]
      (insist (Arrays/equals (Arrays/copyOfRange original off (+ off n)) (read-range h off n)) "range differs"))
    ;; Forest path: the logical manifest's block CID selects the durable frame.
    (when (= profile "forest")
      (doseq [[i chunk] (map-indexed vector (:chunks expected))]
        (let [block (pack/read-forest-block h (str "part-" (quot i 8))
                                           (car/base32-decode (subs (:cid chunk) 1)))]
          (insist (and block (= (:cid chunk) (cid car/codec-raw block))) "CID lookup differs"))))
    {:pass true :fresh-process true :profile profile :file-size size
     :logical-cid (:cid expected) :leaf-cids (mapv :cid (:chunks expected))
     :full-sha (.formatHex (HexFormat/of) (array (digest original))) :ranges 4
     :empty-cache true :forest-cid-lookups (if (= profile "forest") 32 0)}))
(defn child [script dir profile]
  (.start (doto (ProcessBuilder. ^java.util.List [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) script "read" dir profile])
            (.redirectErrorStream true))))
(defn finish [p]
  (try (insist (.waitFor p 90 java.util.concurrent.TimeUnit/SECONDS) "reader timeout")
       (let [s (slurp (.getInputStream p))]
         (when-not (zero? (.exitValue p)) (throw (ex-info "reader failed" {:output s})))
         (edn/read-string s))
       (finally (.destroyForcibly p))))
(defn build [dir profile data]
  (store/init! dir)
  (dotimes [i 4]
    (let [name (str "part-" i) start (* i part-size)]
      (if (= profile "forest")
        (pack/import-forest-direct! dir name (bytes-file (str name ".forest.car.zst")))
        (pack/put-data-zstd3! dir name (Arrays/copyOfRange data start (+ start part-size))))))
  ;; Harness-owned pointer is published after each existing Pack has been validated.
  ;; This demonstrates a snapshot, not an atomic production multi-pack writer.
  (store/transact! dir :put {:key "proof/logical-file" :value (pr-str (manifest data))}
                   (fn [directory _] (pack/recover directory)))
  (pack/checkpoint! dir))
(defn run-proof [script output]
  (insist (.mkdir (io/file output)) "output must not already exist")
  (let [data (make-data) zdir (str output "/zpack") fdir (str output "/forest")]
    (build zdir "zpack" data) (build fdir "forest" data)
    (let [a (finish (child script zdir "zpack")) b (finish (child script fdir "forest"))
          before (:root (store/read-store fdir))
          ref (get-in (pack/summary (pack/recover fdir)) [:files "part-1"])
          path (Paths/get (str fdir "/" (:stored-sha ref) ".forest") (make-array String 0))
          moved (Paths/get (str fdir "/preserved-missing-forest") (make-array String 0))]
      (insist (= (dissoc a :profile :forest-cid-lookups) (dissoc b :profile :forest-cid-lookups)) "logical identity/results differ")
      (Files/move path moved (make-array CopyOption 0))
      (try (insist (try (pack/recover fdir) false (catch Exception _ true)) "missing pack was accepted")
           (insist (= before (:root (store/read-store fdir))) "published root changed")
           (finally (Files/move moved path (into-array CopyOption [StandardCopyOption/ATOMIC_MOVE]))))
      (let [original (Files/readAllBytes path) damaged (aclone original)]
        (aset-byte damaged 100 (unchecked-byte (bit-xor 1 (aget damaged 100))))
        (try
          (Files/write path damaged (make-array java.nio.file.OpenOption 0))
          (insist (try (pack/recover fdir) false (catch Exception _ true)) "corrupt pack was accepted")
          (insist (= before (:root (store/read-store fdir))) "published root changed on corruption")
          (finally (Files/write path original (make-array java.nio.file.OpenOption 0)))))
      (prn {:corpus (corpus-check) :zpack a :forest b :missing-pack-refused true
            :corrupt-pack-refused true :published-root-unchanged true :forest-files-preserved true :pass true}))))
(let [[mode dir profile] *command-line-args*]
  (case mode
    "read" (prn (verify dir profile))
    "run" (try (run-proof *file* dir) (finally (shutdown-agents)))
    (throw (ex-info "use run or read" {}))))
