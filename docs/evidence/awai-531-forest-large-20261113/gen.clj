(require '[awai.fs.car :as car])
(import '[java.security MessageDigest] '[java.io FileOutputStream FileInputStream] '[java.util Random Arrays])
(def root ".agent-output/large-study/")
(defn array [v] (byte-array (map unchecked-byte v)))
(defn hash256 [b] (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b)))
(defn gen [kind]
 (let [rng (Random. 912331) b (byte-array 65536) input (str root kind ".bin") carfile (str root kind ".car")]
  (with-open [out (FileOutputStream. input)]
   (dotimes [i 256]
    (if (= kind "random") (.nextBytes rng b)
      (dotimes [j (alength b)] (aset-byte b j (unchecked-byte (mod (+ j (* i 17) (quot j 127)) 251)))))
    (.write out b)))
  (with-open [in (FileInputStream. input) out (FileOutputStream. carfile)]
   (let [first-block (byte-array 65536) _ (.readNBytes in first-block 0 65536)
         first-cid (car/cid-bytes car/codec-raw (hash256 first-block))]
    (.write out (array (car/carv1-encode {:roots [first-cid] :blocks []})))
    (loop [block first-block i 0]
     (let [cid (car/cid-bytes car/codec-raw (hash256 block))]
      (.write out (array (car/encode-uvarint (+ (count cid) (alength block)))))
      (.write out (array cid)) (.write out block))
     (when (< i 255)
      (let [block (.readNBytes in 65536)] (recur block (inc i)))))))
  (println kind "bytes" 16777216 "blocks" 256)))
(doseq [kind ["pattern" "random"]] (gen kind))
