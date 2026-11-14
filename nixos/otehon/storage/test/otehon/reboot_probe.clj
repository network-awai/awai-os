;; Guest reboot probe for the actual bounded Pack group API.
(require '[otehon.pack-store :as pack] '[otehon.storage :as store]
         '[otehon.segmented :as segmented] '[otehon.forest :as forest]
         '[otehon.forest-writer :as writer]
         '[awai.fs.car :as car])
(import '[java.nio ByteBuffer] '[java.nio.channels FileChannel]
        '[java.nio.file Files Paths OpenOption StandardOpenOption] '[java.security MessageDigest] '[java.util HexFormat])
(defn ensure! [v] (when-not v (throw (ex-info "reboot probe failed" {}))))
(def fixtures (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack"))
(defn files [] (mapv #(Files/readAllBytes (Paths/get (str fixtures "/part-" % ".forest.car.zst") (make-array String 0))) (range 4)))
(defn paths [] (mapv #(str fixtures "/part-" % ".forest.car.zst") (range 4)))
(def expected-cid "bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny")
(defn manifest [inputs]
  (let [blocks (mapcat #(butlast (:blocks (car/carv1-decode (:carv1 (forest/open %))))) inputs)
        chunks (mapv (fn [i block] {"cid" {:tag 42 :bytes (:cid block)}
                                    "offset" (* i 65536) "length" (count (:bytes block))})
                     (range) blocks)
        wire (car/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" (* (count chunks) 65536)
                               "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" 65536} "chunks" chunks})
        bytes (byte-array (map unchecked-byte wire))
        digest (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))
        cid (car/cid-str (car/cid-bytes car/codec-dag-cbor digest))]
    (ensure! (= expected-cid cid))
    {:bytes bytes :cid cid}))
(let [[mode dir] *command-line-args*]
  (case mode
    ("create" "create-v2") (let [inputs (files) m (manifest inputs)]
               (store/init! dir)
               (pack/import-logical-forest-files! dir "reboot" (paths) (:bytes m) (:cid m)
                                                  (if (= mode "create-v2") {:file-backed? true} {}))
               (println "created-logical-four-pack-file-import" mode))
    ("read" "read-v2") (let [h (pack/recover dir)
                 refs (get-in (pack/summary h) [:groups "reboot" :packs])
                 offset (- (* 8 65536) 20)
                 expected (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256))
                                           (range offset (+ offset 40))))]
             (ensure! (= (mapv segmented/sha (files)) (mapv :stored-sha refs)))
             (ensure! (every? #(= (:format %)
                                  (if (= mode "read-v2")
                                    :awai.otehon-store/pack-forest-file-v2
                                    :awai.otehon-store/pack-forest-v1)) refs))
             (ensure! (= expected-cid (get-in (pack/summary h) [:groups "reboot" :manifest-cid])))
             (ensure! (= 0 (get-in (pack/summary h) [:stats :cache-entries-before])))
             (ensure! (java.util.Arrays/equals expected (pack/read-group-range h "reboot" offset 40)))
             (doseq [start (range 0 (* 2 1024 1024) 262144)]
               (let [expected (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256))
                                               (range start (+ start 262144))))]
                 (ensure! (java.util.Arrays/equals expected (pack/read-group-range h "reboot" start 262144)))))
             (println "recovered-logical-four-packs-and-full-two-mib" mode))
    "create-large" (let [source (str dir "-input") stage (str dir "-stage")
                         tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "FOREST_TOOL required" {})))]
                     ;; Sparse input keeps the guest fixture small on disk while
                     ;; preserving distinct content and a 17 MiB logical size.
                     (with-open [out (FileChannel/open (Paths/get source (make-array String 0))
                                                      (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
                       (dotimes [i 17]
                         (ensure! (= 1 (.write out (ByteBuffer/wrap (byte-array [(unchecked-byte (+ i 1))])) (* i 1048576)))))
                       (ensure! (= 1 (.write out (ByteBuffer/wrap (byte-array [0])) (dec (* 17 1048576)))))
                       (.force out true))
                     (store/init! dir)
                     (let [generation (get-in (store/read-store dir) [:root :generation])
                           result (writer/put-file-large! dir "file" source stage tool {:expected-generation generation})]
                       (ensure! (= 2 (:pack-count result)))
                       (ensure! (= (* 17 1048576) (:file-size result)))
                       (println "created-large-two-pack-file-with-conditional-writer")))
    "read-large" (let [h (pack/recover dir) source (or (System/getenv "FOREST_PROBE_SOURCE") (str dir "-input"))
                       refs (get-in (pack/summary h) [:groups "file" :packs])
                       md (MessageDigest/getInstance "SHA-256")]
                   (ensure! (= 2 (count refs)))
                   (ensure! (= 0 (get-in (pack/summary h) [:stats :cache-entries-before])))
                   (dotimes [i 17] (.update md ^bytes (pack/read-group-range h "file" (* i 1048576) 1048576)))
                   (let [actual (.formatHex (HexFormat/of) (.digest md))]
                     (ensure! (= (:sha (store/forest-source-digest source)) actual))
                     (println "recovered-large-two-pack-full-sha256" actual)))
    "read-gib" (let [h (pack/recover dir)
                     refs (get-in (pack/summary h) [:groups "gib" :packs])
                     md (java.security.MessageDigest/getInstance "SHA-256")]
                 (ensure! (= 64 (count refs) (count (set (map :stored-sha refs)))))
                 (ensure! (= 0 (get-in (pack/summary h) [:stats :cache-entries-before])))
                 (dotimes [i 1024]
                   (.update md ^bytes (pack/read-group-range h "gib" (* i 1048576) 1048576)))
                 (let [digest (.formatHex (java.util.HexFormat/of) (.digest md))]
                   (ensure! (= "dd4ec50fea8f5a68daf225da4945af367e25bb870a09346060fa9dc088c001b0" digest))
                   (println "recovered-full-gib-64-packs-sha256" digest)))
    (throw (ex-info "unknown reboot probe mode" {}))))
