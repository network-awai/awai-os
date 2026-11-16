;; Local hosted integration proof, not product writer or a Native fallback.
(require '[otehon.pack-store :as pack] '[otehon.storage :as store] '[awai.fs.car :as car])
(import '[java.nio.file Files Paths OpenOption] '[java.nio.file.attribute FileAttribute]
        '[java.security MessageDigest] '[java.io ByteArrayOutputStream] '[java.util Arrays])
(defn ensure! [x msg] (when-not x (throw (ex-info msg {}))))
(defn bytes [v] (byte-array (map unchecked-byte v)))
(defn digest [v] (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") (if (bytes? v) v (bytes v)))))
(defn write! [path data] (Files/write (Paths/get path (make-array String 0)) data (make-array OpenOption 0)))
(let [[dir tool] *command-line-args*
      _ (Files/createDirectory (Paths/get dir (make-array String 0)) (make-array FileAttribute 0))
      _ (ensure! (= "e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f"
                    (car/hex-encode (digest (Files/readAllBytes (Paths/get tool (make-array String 0)))))) "Forest tool SHA mismatch")
      data (bytes (map #(mod (+ (* % 19) (quot % 8191)) 256) (range (* 2 1024 1024))))
      input (str dir "/input.bin") _ (write! input data)
      result (with-open [in (Files/newInputStream (Paths/get input (make-array String 0)) (make-array OpenOption 0))]
               (loop [pack-index 0 offset 0 chunks [] paths []]
                 (let [batch (.readNBytes in (* 8 65536))]
                   (if (zero? (alength batch)) {:chunks chunks :paths paths :size offset}
                     (let [leaves (mapv (fn [part] (let [v (mapv #(bit-and 255 %) part)] {:bytes v :digest (digest v)})) (partition-all 65536 batch))
                           carbytes (:car (car/assemble-pack leaves digest))
                           end (first (car/decode-u64-le carbytes 43))
                           carpath (str dir "/" pack-index ".car") forestpath (str dir "/" pack-index ".forest.car.zst")
                           _ (write! carpath (bytes (subvec carbytes 51 end)))
                           p (.start (doto (ProcessBuilder. ^java.util.List [tool "snapshot" "compress" carpath "--output-path" forestpath "--frame-size" "1024"]) (.redirectErrorStream true)))
                           output (slurp (.getInputStream p)) _ (.waitFor p)
                           _ (ensure! (zero? (.exitValue p)) (str "Forest failed: " output))
                           next-chunks (loop [xs leaves pos offset out chunks]
                                         (if-let [leaf (first xs)]
                                           (let [n (count (:bytes leaf)) cid (car/cid-bytes car/codec-raw (:digest leaf))]
                                             (recur (rest xs) (+ pos n) (conj out {"cid" {:tag 42 :bytes cid} "offset" pos "length" n})))
                                           out))]
                       (recur (inc pack-index) (+ offset (alength batch)) next-chunks (conj paths forestpath)))))))
      manifest (car/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" (:size result)
                                  "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" 65536} "chunks" (:chunks result)})
      cid (car/cid-str (car/cid-bytes car/codec-dag-cbor (digest manifest)))
      target (str dir "/store") _ (store/init! target)
      _ (pack/import-logical-forest-files! target "file" (:paths result) (bytes manifest) cid)
      handle (pack/recover target) out (ByteArrayOutputStream.)]
  (doseq [offset (range 0 (:size result) 524288)]
    (.write out ^bytes (pack/read-group-range handle "file" offset (min 524288 (- (:size result) offset)))))
  (ensure! (Arrays/equals data (.toByteArray out)) "restored bytes differ")
  (ensure! (= "bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny" cid) "logical CID differs")
  (prn {:source-bytes (count data) :packs (count (:paths result)) :chunks (count (:chunks result)) :manifest-cid cid :bytes-equal true :pass true}))
