;; Otehon hosted 1 GiB boundary oracle; retained synthetic output only.
(require '[otehon.pack-store :as pack] '[otehon.storage :as store]
         '[otehon.forest-writer :as writer])
(import '[java.nio ByteBuffer] '[java.nio.channels FileChannel]
        '[java.nio.file Files Paths OpenOption StandardOpenOption] '[java.security MessageDigest] '[java.util HexFormat])
(defn ensure! [v msg] (when-not v (throw (ex-info msg {}))))
(def mode (first *command-line-args*))
(def base (or (System/getenv "GIB_ACTUAL_OUTPUT") (throw (ex-info "output required" {}))))
(def store-dir (str base "/store"))
(def input-path (str base "/source"))
(def stage (str base "/stage"))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "tool required" {}))))
(def size (* 1024 1024 1024))
(defn input-sha256 []
  (let [digest (MessageDigest/getInstance "SHA-256") buffer (byte-array 1048576)]
    (with-open [input (Files/newInputStream (Paths/get input-path (make-array String 0)) (make-array OpenOption 0))]
      (loop []
        (let [n (.read input buffer)]
          (when (pos? n) (.update digest buffer 0 n) (recur)))))
    (.formatHex (HexFormat/of) (.digest digest))))
(case mode
 "write"
 (do
   (ensure! (.mkdir (java.io.File. base)) "fresh output required")
   (with-open [out (FileChannel/open (Paths/get input-path (make-array String 0))
                                    (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
     (dotimes [i 1024]
       (let [marker (doto (ByteBuffer/allocate 4) (.putInt i) (.flip))]
         (ensure! (= 4 (.write out marker (* i 1048576))) "marker short write")))
     (ensure! (= 1 (.write out (ByteBuffer/wrap (byte-array [0])) (dec size))) "end short write")
     (.force out true))
   (store/init! store-dir)
   (let [g (get-in (store/read-store store-dir) [:root :generation])
         started (System/nanoTime)
         result (writer/put-file-large! store-dir "gib" input-path stage tool {:expected-generation g})]
     (ensure! (= 64 (:pack-count result)) "wrong pack count")
     (ensure! (= size (:file-size result)) "wrong file size")
     (prn {:mode :write :logical-bytes size :packs (:pack-count result)
           :manifest (:manifest-cid result) :elapsed-ms (quot (- (System/nanoTime) started) 1000000) :pass true})))
 "read"
 (let [started (System/nanoTime) h (pack/recover store-dir)
       refs (get-in (pack/summary h) [:groups "gib" :packs]) md (MessageDigest/getInstance "SHA-256")]
   (ensure! (= 64 (count refs)) "wrong pack count")
   (ensure! (= 0 (get-in (pack/summary h) [:stats :cache-entries-before])) "cache not empty")
   (dotimes [i 1024] (.update md ^bytes (pack/read-group-range h "gib" (* i 1048576) 1048576)))
   (let [actual (.formatHex (HexFormat/of) (.digest md)) expected (input-sha256)]
     (ensure! (= expected actual) "full SHA mismatch")
     (prn {:mode :read :logical-bytes size :packs (count refs) :sha256 actual
           :elapsed-ms (quot (- (System/nanoTime) started) 1000000) :pass true})))
 (throw (ex-info "write/read required" {})))
