;; Hosted isolated 1 GiB writer SIGKILL boundary; not OS or power-loss evidence.
(require '[otehon.pack-store :as pack] '[otehon.storage :as store] '[otehon.forest-writer :as writer] '[clojure.edn :as edn])
(import '[java.nio ByteBuffer] '[java.nio.channels FileChannel]
        '[java.nio.file Files Paths OpenOption StandardOpenOption] '[java.security MessageDigest] '[java.util HexFormat])
(defn ensure! [v msg] (when-not v (throw (ex-info msg {}))))
(def mode (first *command-line-args*))
(def base (or (System/getenv "GIB_CRASH_OUTPUT") (throw (ex-info "output required" {}))))
(def store-path (str base "/store"))
(def input-path (str base "/new-source"))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "tool required" {}))))
(def size (* 1024 1024 1024))
(defn input-sha []
  (let [md (MessageDigest/getInstance "SHA-256") b (byte-array 1048576)]
    (with-open [in (Files/newInputStream (Paths/get input-path (make-array String 0)) (make-array OpenOption 0))]
      (loop [] (let [n (.read in b)] (when (pos? n) (.update md b 0 n) (recur)))))
    (.formatHex (HexFormat/of) (.digest md))))
(case mode
 "prepare"
 (do (with-open [out (FileChannel/open (Paths/get input-path (make-array String 0))
                                        (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
       (dotimes [i 1024]
         (let [marker (doto (ByteBuffer/allocate 4) (.putInt (+ 1024 i)) (.flip))]
           (ensure! (= 4 (.write out marker (* i 1048576))) "short marker write")))
       (ensure! (= 1 (.write out (ByteBuffer/wrap (byte-array [0])) (dec size))) "short last write")
       (.force out true))
     (let [s (store/read-store store-path)]
       (ensure! (not (:degraded? s)) "source store degraded")
       (spit (str base "/baseline-root.edn") (pr-str (:root s)))
       (prn {:prepared true :generation (get-in s [:root :generation])})))
 "write"
 (let [counter (atom 0) generation (:generation (edn/read-string (slurp (str base "/baseline-root.edn"))))]
   (binding [store/*write-observer* (fn [event role]
              (when (and (= event :half-written) (= role :forest) (= 32 (swap! counter inc)))
                (spit (str base "/boundary.ready") (pr-str {:event event :role role :ordinal 32}))
                (Thread/sleep 600000)))]
     (writer/put-file-large! store-path "gib" input-path (str base "/stage") tool {:expected-generation generation}))
   (throw (ex-info "boundary not reached" {:count @counter})))
 "verify-old"
 (let [baseline (edn/read-string (slurp (str base "/baseline-root.edn"))) state (store/read-store store-path)
       h (pack/recover store-path) group (get-in (pack/summary h) [:groups "gib"]) md (MessageDigest/getInstance "SHA-256")]
   (ensure! (= baseline (:root state)) "published root changed")
   (ensure! (= 64 (count (:packs group))) "partial pack group")
   (ensure! (= "bafyreidk3dxbsrqaocvdhfr624j4n75v6ddgmyfgkyu24z3lirlg5aj4g4" (:manifest-cid group)) "wrong old manifest")
   (dotimes [i 1024] (.update md ^bytes (pack/read-group-range h "gib" (* i 1048576) 1048576)))
   (let [actual (.formatHex (HexFormat/of) (.digest md))]
     (ensure! (= "1f7e0c0d3fefe5579e556a04f7796b7de01278916e49a6d31df864e16adf1708" actual) "old bytes changed")
     (prn {:generation (:generation baseline) :packs 64 :sha256 actual :root :unchanged :pass true})))
 "retry"
 (let [generation (get-in (store/read-store store-path) [:root :generation])
       result (writer/put-file-large! store-path "gib" input-path (str base "/stage-retry") tool {:expected-generation generation})]
   (ensure! (= 64 (:pack-count result)) "retry pack count")
   (ensure! (= size (:file-size result)) "retry file size")
   (ensure! (not= "bafyreidk3dxbsrqaocvdhfr624j4n75v6ddgmyfgkyu24z3lirlg5aj4g4" (:manifest-cid result)) "retry root unchanged")
   (spit (str base "/retry-manifest.edn") (pr-str (:manifest-cid result)))
   (prn {:retry :published :manifest (:manifest-cid result) :packs 64 :pass true}))
 "verify-new"
 (let [baseline (edn/read-string (slurp (str base "/baseline-root.edn"))) state (store/read-store store-path)
       h (pack/recover store-path) group (get-in (pack/summary h) [:groups "gib"]) md (MessageDigest/getInstance "SHA-256")]
   (ensure! (> (get-in state [:root :generation]) (:generation baseline)) "generation did not advance")
   (ensure! (= 64 (count (:packs group))) "partial retry group")
   (ensure! (= (edn/read-string (slurp (str base "/retry-manifest.edn"))) (:manifest-cid group)) "wrong new manifest")
   (dotimes [i 1024] (.update md ^bytes (pack/read-group-range h "gib" (* i 1048576) 1048576)))
   (let [actual (.formatHex (HexFormat/of) (.digest md))]
     (ensure! (= (input-sha) actual) "new bytes differ")
     (prn {:generation (get-in state [:root :generation]) :packs 64 :sha256 actual :retry :verified :pass true})))
 (throw (ex-info "prepare/write/verify-old required" {})))
