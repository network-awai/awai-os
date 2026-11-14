;; Otehon hosted integration proof. Run each mode in a separate process.
(require '[otehon.forest :as f] '[otehon.storage :as s] '[otehon.pack-store :as p] '[awai.fs.car :as c])
(import '[java.nio.file Files Paths OpenOption StandardOpenOption] '[java.nio.channels FileChannel]
        '[java.nio ByteBuffer] '[java.security MessageDigest] '[java.util Arrays Random])
(def mode (first *command-line-args*))
(def base (second *command-line-args*))
(def file (str base "/large.forest"))
(def carfile (str base "/input.car"))
(def store (str base "/store"))
(defn check! [x msg] (when-not x (throw (ex-info msg {}))))
(defn sha [v] (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") (byte-array (map unchecked-byte v)))))
(defn manifest []
  (let [idx (:index (f/verify-file file))
        chunks (mapv (fn [i x] {"cid" {:tag 42 :bytes (:cid x)} "length" (:length x) "offset" (* i 1048576)}) (range) idx)
        v (c/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" 2097152 "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" 1048576} "chunks" chunks})]
    {:bytes (byte-array (map unchecked-byte v)) :cid (c/cid-str (c/cid-bytes c/codec-dag-cbor (sha v)))}))
(case mode
 "generate"
 (let [_ (check! (.mkdir (java.io.File. base)) "output must not exist") rng (Random. 531532)
       leaves (mapv (fn [_] (let [b (byte-array 1048576)] (.nextBytes rng b)
                              (let [v (mapv #(bit-and 255 %) b)] {:bytes v :digest (sha v)}))) (range 2))
       v (:car (c/assemble-pack leaves sha)) end (first (c/decode-u64-le v 43))
       out (byte-array (map unchecked-byte (subvec v 51 end)))]
   (Files/write (Paths/get carfile (make-array String 0)) out (make-array OpenOption 0))
   (prn {:generated-bytes (alength out)}))
 "write"
 (let [m (manifest)] (s/init! store)
   (let [r (p/import-logical-forest-files! store "large" [file] (:bytes m) (:cid m))]
     (check! (= :awai.otehon-store/pack-forest-file-v2 (get-in r [:group :packs 0 :format])) "wrong profile")
     (prn {:published true :manifest (:cid m) :format (get-in r [:group :packs 0 :format])})))
 "read"
 (let [h (p/recover store) idx (:index (f/verify-file file)) wanted (byte-array 40)]
   (with-open [in (FileChannel/open (Paths/get carfile (make-array String 0)) (into-array OpenOption [StandardOpenOption/READ]))]
     (doseq [[offset size target] [[(+ (- (:offset (first idx)) 51) 1048556) 20 0] [(- (:offset (second idx)) 51) 20 20]]]
       (let [buf (ByteBuffer/wrap wanted target size)]
         (loop [pos offset] (when (.hasRemaining buf) (let [n (.read in buf pos)] (check! (pos? n) "short input") (recur (+ pos n))))))))
   (check! (Arrays/equals wanted (p/read-group-range h "large" (- 1048576 20) 40)) "range mismatch")
   (prn {:recovered true :cross-leaf true :stats (:stats (p/summary h))}))
 "corrupt"
 (let [h (p/recover store) ref (first (get-in (p/summary h) [:groups "large" :packs]))
       path (Paths/get (s/forest-file-path store (:stored-sha ref)) (make-array String 0)) b (Files/readAllBytes path)]
   (aset-byte b 200 (unchecked-byte (bit-xor 1 (aget b 200))))
   (Files/write path b (make-array OpenOption 0))
   (check! (try (p/recover store) false (catch Exception _ true)) "corruption accepted")
   (check! (try (p/read-group-range h "large" 0 40) false (catch Exception _ true)) "cached frame corruption accepted")
   (prn {:corruption :rejected :old-handle :rejected}))
 (throw (ex-info "unknown proof mode" {:mode mode})))
