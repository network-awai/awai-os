;; Process-death proof only. The synced local test witness is neither an
;; independent authority nor an atomic multi-writer CAS implementation.
(require '[clojure.edn :as edn] '[clojure.java.io :as io]
         '[babashka.classpath :as cp] '[otehon.storage :as store]
         '[otehon.pack-store :as pack] '[otehon.forest :as forest] '[awai.fs.car :as car])
(import '[java.nio.file Files Paths OpenOption StandardOpenOption]
        '[java.nio ByteBuffer] '[java.nio.channels FileChannel])
(defn ensure! [x msg data] (when-not x (throw (ex-info msg data))))
(defn fixtures []
  (let [base (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack")
        paths (mapv #(str base "/part-" % ".forest.car.zst") (range 4))
        blocks (mapcat #(butlast (:blocks (car/carv1-decode (:carv1 (forest/open (Files/readAllBytes (Paths/get % (make-array String 0)))))))) paths)
        chunks (mapv (fn [i b] {"cid" {:tag 42 :bytes (:cid b)} "offset" (* i 65536) "length" (count (:bytes b))}) (range) blocks)
        value {"format" "awai.logical-file" "version" 1 "fileSize" (* (count chunks) 65536)
               "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" 65536} "chunks" chunks}
        bytes (byte-array (map unchecked-byte (car/cbor-encode value)))
        digest (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))]
    {:paths paths :bytes bytes :cid (car/cid-str (car/cid-bytes car/codec-dag-cbor digest))}))
(defn witness-write! [path root & [during-write]]
  (with-open [out (FileChannel/open (Paths/get path (make-array String 0))
                    (into-array OpenOption [StandardOpenOption/CREATE StandardOpenOption/WRITE StandardOpenOption/TRUNCATE_EXISTING]))]
    (let [bytes (.getBytes (pr-str root) "UTF-8")
          _ (when during-write
              (let [partial (ByteBuffer/wrap bytes 0 1)]
                (while (.hasRemaining partial) (.write out partial)))
              (.force out true)
              (during-write))
          buf (ByteBuffer/wrap bytes (if during-write 1 0) (if during-write (dec (alength bytes)) (alength bytes)))]
      (while (.hasRemaining buf) (.write out buf)))
    (.force out true)))
(defn witness [path & [during-write]]
  {:read! #(edn/read-string (slurp path))
   :compare-and-set! (fn [old new] (if (= old (edn/read-string (slurp path)))
                                     (do (witness-write! path new during-write) true) false))})
(defn spawn [script mode dir & args]
  (.start (doto (ProcessBuilder. ^java.util.List (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) script mode dir] args)) (.redirectErrorStream true))))
(defn finish [p]
  (try (ensure! (.waitFor p 30 java.util.concurrent.TimeUnit/SECONDS) "reader timeout" {})
       (let [s (slurp (.getInputStream p))]
         (ensure! (zero? (.exitValue p)) "reader failed" {:output s}) (edn/read-string s))
       (finally (.destroyForcibly p))))
(defn write-child [dir path event role]
  (let [{:keys [paths bytes cid]} (fixtures)]
    (binding [store/*write-observer*
              (fn [e r] (when (= [e r] [event role])
                          (prn {:ready true}) (flush) (Thread/sleep 30000)
                          (throw (ex-info "writer was not killed" {}))))]
      (pack/import-logical-forest-files! dir "proof" paths bytes cid
        {:expected-generation 1
         :witness (witness path (when (= [event role] [:during-write :witness])
                                  (fn [] (prn {:ready true}) (flush) (Thread/sleep 30000)
                                    (throw (ex-info "writer was not killed" {})))))}))
    (throw (ex-info "boundary not reached" {}))))
(defn read-child [dir path]
  (try (let [handle (pack/recover-witnessed dir (:read! (witness path)))
             n (count (get-in (pack/summary handle) [:groups "proof" :packs]))]
         (when (= n 4)
           (let [offset (- (* 8 65536) 20)
                 expected (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range offset (+ offset 40))))]
             (ensure! (java.util.Arrays/equals expected (pack/read-group-range handle "proof" offset 40)) "range changed" {})))
         {:generation (get-in (pack/summary handle) [:basis :generation]) :packs n})
       (catch Exception e {:error (or (:type (ex-data e)) :witness-read-failed)})))
(defn run-case [script output event role expected]
  (let [base (str output "/" (name role) "-" (name event)) dir (str base "/store") path (str base "/witness.edn")]
    (ensure! (.mkdir (io/file base)) "case exists" {:base base})
    (store/init! dir) (witness-write! path (:root (store/read-store dir)))
    (let [writer (spawn script "write" dir path (name event) (name role))]
      (try
        (with-open [r (io/reader (.getInputStream writer))]
          (let [s (deref (future (.readLine ^java.io.BufferedReader r)) 25000 nil)]
            (ensure! (and s (:ready (edn/read-string s))) "writer boundary not reached" {:output s})))
        (.destroyForcibly writer)
        (ensure! (and (.waitFor writer 10 java.util.concurrent.TimeUnit/SECONDS) (= 137 (.exitValue writer))) "kill failed" {})
        (let [actual (finish (spawn script "read" dir path))]
          (ensure! (= expected actual) "unexpected recovered basis" {:actual actual :expected expected})
          (when (= [event role] [:during-write :witness])
            (ensure! (= 1 (Files/size (Paths/get path (make-array String 0)))) "witness was not partially written" {})
            (let [unguarded (pack/summary (pack/recover dir))]
              (ensure! (and (= 2 (get-in unguarded [:basis :generation]))
                            (= 4 (count (get-in unguarded [:groups "proof" :packs]))))
                       "partial-witness control did not retain a readable published group" {})))
          (prn {:event event :role role :result actual :pass true}))
        (finally (.destroyForcibly writer))))))
(let [[mode dir a b c] *command-line-args*]
  (case mode
    "write" (write-child dir a (keyword b) (keyword c))
    "read" (prn (read-child dir a))
    "run" (try
            (ensure! (.mkdir (io/file dir)) "output must be new" {})
            (doseq [[event role expected] [[:dir-synced :forest {:generation 1 :packs 0}]
                                           [:half-written :wal {:generation 1 :packs 0}]
                                           [:half-written :root {:generation 1 :packs 0}]
                                           [:renamed :root {:error :witness-mismatch}]
                                           [:before-cas :witness {:error :witness-mismatch}]
                                           [:during-write :witness {:error :witness-read-failed}]
                                           [:after-cas :witness {:generation 2 :packs 4}]]]
              (run-case *file* dir event role expected))
            (prn {:cases 7 :pass true :independent-witness false :os-cache-loss false})
            (finally (shutdown-agents)))
    (throw (ex-info "use run, write or read" {}))))
