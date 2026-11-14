;; Hosted Otehon proof: run write and read in separate processes.
(require '[otehon.storage :as s] '[otehon.forest-writer :as w] '[otehon.pack-store :as p])
(import '[java.nio.file Files Paths OpenOption StandardOpenOption] '[java.nio ByteBuffer]
        '[java.nio.channels FileChannel] '[java.security MessageDigest] '[java.util Random Arrays HexFormat])
(def mode (first *command-line-args*))
(def base (second *command-line-args*))
(def tool (nth *command-line-args* 2))
(def input (str base "/input"))
(def zeros (str base "/zeros"))
(def target (str base "/store"))
(defn check! [v m] (when-not v (throw (ex-info m {}))))
(case mode
 "write"
 (do (check! (.mkdir (java.io.File. base)) "output must not exist")
     (let [rng (Random. 532) buf (byte-array 1048576)]
       (with-open [out (Files/newOutputStream (Paths/get input (make-array String 0)) (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
         (dotimes [_ 17] (.nextBytes rng buf) (.write out buf))))
     (with-open [out (Files/newOutputStream (Paths/get zeros (make-array String 0)) (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
       (.write out (byte-array (* 2 1048576))))
     (s/init! target)
     (let [r (w/put-file-large! target "file" input (str base "/stage") tool)
           z (w/put-file-large! target "zeros" zeros (str base "/zeros-stage") tool)]
       (check! (= 2 (:pack-count r)) "expected two Packs")
       (check! (= 1 (:pack-count z)) "expected one compressed Pack")
       (check! (= "bafyreidfmsqrb6skzr2jrnmetx3rnsxz3px6owq3esx6z3zj5nxiposyfy" (:manifest-cid r)) "manifest CID differs")
       (prn {:file-size (:file-size r) :packs (:pack-count r) :manifest (:manifest-cid r)
             :compressed-size (get-in z [:group :packs 0 :stored-size])})))
 "read"
 (let [h (p/recover target) start (- (* 16 1048576) 32) expected (byte-array 64)
       ref (first (get-in (p/summary h) [:groups "zeros" :packs])) md (MessageDigest/getInstance "SHA-256")]
   (check! (and (= :awai.otehon-store/pack-forest-file-v2 (:format ref)) (< (:stored-size ref) 1048576))
           "compressed-small v2 route not exercised")
   (with-open [in (FileChannel/open (Paths/get input (make-array String 0)) (into-array OpenOption [StandardOpenOption/READ]))]
     (let [buf (ByteBuffer/wrap expected)]
       (loop [pos start] (when (.hasRemaining buf) (let [n (.read in buf pos)] (check! (pos? n) "short input") (recur (+ pos n)))))))
   (check! (Arrays/equals expected (p/read-group-range h "file" start 64)) "cross Pack range differs")
   (dotimes [i 17] (.update md ^bytes (p/read-group-range h "file" (* i 1048576) 1048576)))
   (check! (= (:sha (s/forest-source-digest input)) (.formatHex (HexFormat/of) (.digest md))) "full file digest differs")
   (check! (Arrays/equals (byte-array 64) (p/read-group-range h "zeros" (- 1048576 32) 64)) "zero range differs")
   (prn {:recovered true :full-file-sha :matched :cross-pack true :compressed-small true}))
 (throw (ex-info "unknown proof mode" {:mode mode})))
