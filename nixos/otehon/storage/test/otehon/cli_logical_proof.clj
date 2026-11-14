;; Exercise the product CLI in separate processes with real Forest fixtures.
(require '[babashka.classpath :as cp] '[otehon.forest :as forest]
         '[otehon.storage :as store] '[awai.fs.car :as car]
         '[otehon.cli :as cli] '[otehon.pack-store :as pack])
(import '[java.nio.file Files Paths OpenOption] '[java.nio.file.attribute FileAttribute]
        '[java.util Arrays] '[java.security MessageDigest])
(def fixtures (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack"))
(defn ensure! [x msg] (when-not x (throw (ex-info msg {}))))
(defn run-cli [& args]
  (let [p (.start (doto (ProcessBuilder. ^java.util.List
                          (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) "-m" "otehon.cli"] args))
                    (.redirectErrorStream true)))
        output (slurp (.getInputStream p))]
    (ensure! (.waitFor p 90 java.util.concurrent.TimeUnit/SECONDS) "CLI timeout")
    {:exit (.exitValue p) :output output}))
(defn manifest [paths]
  (let [blocks (mapcat #(butlast (:blocks (car/carv1-decode (:carv1 (forest/open
                         (Files/readAllBytes (Paths/get % (make-array String 0)))))))) paths)
        chunks (mapv (fn [i b] {"cid" {:tag 42 :bytes (:cid b)} "offset" (* i 65536)
                                "length" (count (:bytes b))}) (range) blocks)
        v (car/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" (* 65536 (count chunks))
                            "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" 65536} "chunks" chunks})
        bytes (byte-array (map unchecked-byte v))
        sha (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes))]
    {:bytes bytes :cid (car/cid-str (car/cid-bytes car/codec-dag-cbor sha))}))
(let [dir (first *command-line-args*)
      _ (Files/createDirectory (Paths/get dir (make-array String 0)) (make-array FileAttribute 0))
      store-dir (str dir "/store") output (str dir "/range.bin") manifest-path (str dir "/manifest.cbor")
      paths (mapv #(str fixtures "/part-" % ".forest.car.zst") (range 4))
      {:keys [bytes cid]} (manifest paths) offset (- (* 8 65536) 20)
      expected (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range offset (+ offset 40))))]
  (Files/write (Paths/get manifest-path (make-array String 0)) bytes (make-array OpenOption 0))
  (ensure! (zero? (:exit (run-cli "init" store-dir))) "CLI init failed")
  (let [before (:root (store/read-store store-dir))]
    (ensure! (not (zero? (:exit (apply run-cli (concat ["logical-forest-import" store-dir "file" manifest-path "bad"] paths))))) "bad CID accepted")
    (ensure! (= before (:root (store/read-store store-dir))) "bad CID published root")
    (let [link (Paths/get (str dir "/pack-link") (make-array String 0))]
      (Files/createSymbolicLink link (.toAbsolutePath (Paths/get (first paths) (make-array String 0))) (make-array FileAttribute 0))
      (ensure! (not (zero? (:exit (apply run-cli (concat ["logical-forest-import" store-dir "file" manifest-path cid (str link)] (rest paths)))))) "symlink accepted")
      (ensure! (= before (:root (store/read-store store-dir))) "symlink published root")))
  (ensure! (zero? (:exit (apply run-cli (concat ["logical-forest-import" store-dir "file" manifest-path cid] paths)))) "CLI import failed")
  ;; The real entry must capture generation before importer work. Inject a
  ;; second local writer at that seam and prove the stale candidate is refused.
  (let [original pack/import-logical-forest-files! after-other (atom nil)
        outcome (with-redefs [pack/import-logical-forest-files!
                              (fn [& args]
                                (store/transact! store-dir :put {:key "other-writer" :value "advanced"})
                                (reset! after-other (store/read-store store-dir))
                                (apply original args))]
                  (try (with-out-str (apply cli/-main (concat ["logical-forest-import" store-dir "file" manifest-path cid] paths)))
                       :unexpected-success
                       (catch Exception e (:type (ex-data e)))))]
    (ensure! (= :stale-generation outcome) "racing import was not refused")
    (ensure! (= @after-other (store/read-store store-dir)) "stale import changed store after competing write")
    (ensure! (Arrays/equals expected (pack/read-group-range (pack/recover store-dir) "file" offset 40)) "stale import changed visible bytes"))
  (ensure! (zero? (:exit (run-cli "forest-group-range" store-dir "file" output (str offset) "40"))) "CLI range failed")
  (ensure! (Arrays/equals expected (Files/readAllBytes (Paths/get output (make-array String 0)))) "cross-Pack range mismatch")
  (ensure! (not (zero? (:exit (run-cli "forest-group-range" store-dir "file" output (str offset) "40")))) "CLI overwrote output")
  (let [dest (str dir "/full.bin")
        size (pack/group-size (pack/recover store-dir) "file")
        expected-full (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range size)))]
    (ensure! (zero? (:exit (run-cli "forest-group-export" store-dir "file" dest))) "CLI full export failed")
    (ensure! (Arrays/equals expected-full (Files/readAllBytes (Paths/get dest (make-array String 0)))) "CLI full export mismatch")
    (ensure! (not (zero? (:exit (run-cli "forest-group-export" store-dir "file" dest)))) "CLI full export overwrote output")
    (ensure! (Arrays/equals expected-full (Files/readAllBytes (Paths/get dest (make-array String 0)))) "existing export changed"))
  (prn {:manifest-cid cid :cross-pack-range true :full-export true :bad-cid-rejected true :symlink-rejected true :overwrite-rejected true :stale-import-rejected true :pass true}))
