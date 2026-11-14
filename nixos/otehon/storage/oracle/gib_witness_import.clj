;; Hosted single-run measurement using an existing task-owned 1 GiB fixture.
;; The atom is a test witness, not an independent authority or production CAS.
(require '[clojure.edn :as edn] '[otehon.storage :as store]
         '[otehon.pack-store :as pack] '[awai.fs.car :as car])
(import '[java.nio.file Files Paths OpenOption LinkOption] '[java.security MessageDigest] '[java.util HexFormat])
(def fixture (or (System/getenv "GIB_SOURCE") (throw (ex-info "GIB_SOURCE required" {}))))
(def output (or (System/getenv "GIB_WITNESS_OUTPUT") (throw (ex-info "GIB_WITNESS_OUTPUT required" {}))))
(defn ensure! [x msg] (when-not x (throw (ex-info msg {}))))
(defn sha-source [path]
  (let [md (MessageDigest/getInstance "SHA-256") buf (byte-array 1048576)]
    (with-open [in (Files/newInputStream (Paths/get path (make-array String 0)) (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
      (loop [] (let [n (.read in buf)] (when (pos? n) (.update md buf 0 n) (recur)))))
    (.formatHex (HexFormat/of) (.digest md))))
(defn witness [root]
  {:read! #(deref root)
   :compare-and-set! (fn [old new] (locking root (if (= @root old) (do (reset! root new) true) false)))})
(case (first *command-line-args*)
  "write"
  (let [source-store (str fixture "/store") original (pack/recover source-store)
        group (get-in (pack/summary original) [:groups "gib"])
        refs (:packs group)
        _ (ensure! (and (= 64 (count refs)) (= 64 (count (set (map :stored-sha refs))))) "expected 64 distinct Packs")
        files (mapv #(str source-store "/" (:stored-sha %) ".forest") refs)
        bytes (byte-array (map unchecked-byte (car/hex-decode (:manifest-hex group))))
        cid (:manifest-cid group)]
    (ensure! (.mkdir (java.io.File. output)) "output must be new")
    (doseq [mode [:control :witnessed]]
      (let [dir (str output "/" (name mode)) _ (store/init! dir)
            root (atom (:root (store/read-store dir))) w (witness root)
            start (System/nanoTime)
            result (pack/import-logical-forest-files! dir "gib" files bytes cid
                     (cond-> {:expected-generation 1 :file-backed? true} (= mode :witnessed) (assoc :witness w)))
            elapsed (/ (double (- (System/nanoTime) start)) 1e9)]
        (ensure! (= 64 (count (get-in result [:group :packs]))) "wrong imported count")
        (when (= mode :witnessed)
          (ensure! (= @root (:root (store/read-store dir))) "witness mismatch")
          (spit (str output "/witness.edn") (pr-str @root)))
        (prn {:mode mode :seconds elapsed :logical-bytes 1073741824 :packs 64 :manifest cid :pass true}) (flush))))
  "read"
  (let [source (str fixture "/source") _ (ensure! (= 1073741824 (Files/size (Paths/get source (make-array String 0)))) "wrong source size")
        expected (sha-source source) start (System/nanoTime)
        h (pack/recover-witnessed (str output "/witnessed") #(edn/read-string (slurp (str output "/witness.edn"))))
        refs (get-in (pack/summary h) [:groups "gib" :packs]) md (MessageDigest/getInstance "SHA-256")]
    (ensure! (= 64 (count refs)) "wrong recovered Pack count")
    (dotimes [i 1024] (.update md ^bytes (pack/read-group-range h "gib" (* i 1048576) 1048576)))
    (let [actual (.formatHex (HexFormat/of) (.digest md))]
      (ensure! (= expected actual) "full SHA mismatch")
      (prn {:mode :read :seconds (/ (double (- (System/nanoTime) start)) 1e9) :logical-bytes 1073741824
            :packs 64 :sha256 actual :full-read true :pass true})))
  (throw (ex-info "mode must be write or read" {})))
