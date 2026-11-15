;; Hosted generic file verifier: incompressible 1 MiB block and corruption.
(require '[awai.fs.car :as car] '[otehon.forest :as forest])
(import '[java.nio.file Files Paths OpenOption StandardOpenOption] '[java.security MessageDigest] '[java.util Arrays Random])
(defn ensure! [x message] (when-not x (throw (ex-info message {}))))
(defn refused? [f] (try (f) false (catch Exception _ true)))
(defn read-range [path offset length]
  (with-open [f (java.io.RandomAccessFile. path "r")]
    (.seek f offset) (let [b (byte-array length)] (.readFully f b) b)))
(let [[base tool] *command-line-args*]
  (ensure! (.mkdir (java.io.File. base)) "fresh output directory required")
  (let [payload (byte-array (* 1024 1024)) _ (.nextBytes (Random. 1457) payload)
        digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") payload))
        cid (car/cid-bytes car/codec-raw digest)
        bytes (byte-array (map unchecked-byte (car/carv1-encode {:roots [cid] :blocks [{:cid cid :bytes (mapv #(bit-and 255 %) payload)}]})))
        carpath (str base "/data.car") out (str base "/data.forest")]
    (Files/write (Paths/get carpath (make-array String 0)) bytes (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))
    (let [p (.start (doto (ProcessBuilder. ^java.util.List [tool "snapshot" "compress" carpath "--output-path" out "--frame-size" "1"])
                      (.redirectErrorStream true) (.redirectOutput (java.io.File. (str base "/forest.log")))))]
      (ensure! (.waitFor p 120 java.util.concurrent.TimeUnit/SECONDS) "compress timeout")
      (ensure! (zero? (.exitValue p)) "compress failed"))
    (let [h (forest/verify-generic-file out) frame (first (keys (:frame-sha h)))
          read! #(read-range out %1 %2)]
      (ensure! (> (:size h) (* 1024 1024)) "fixture compressed below old archive bound")
      (ensure! (= [cid] (:roots h)) "root mismatch")
      (ensure! (Arrays/equals payload (forest/get-block-from h cid read!)) "block mismatch")
      (ensure! (refused? #(forest/get-block-from h cid (fn [offset length]
                 (let [b (read! offset length)] (aset-byte b 0 (unchecked-byte (bit-xor 1 (aget b 0)))) b)))) "changed frame accepted")
      (let [bad (str base "/bad.forest") copy (Files/readAllBytes (Paths/get out (make-array String 0)))]
        (aset-byte copy (int (+ frame 3)) (unchecked-byte (bit-xor 1 (aget copy (int (+ frame 3))))))
        (Files/write (Paths/get bad (make-array String 0)) copy (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))
        (ensure! (refused? #(forest/verify-generic-file bad)) "corrupt archive accepted"))
      (prn {:block-bytes (alength payload) :forest-bytes (:size h) :cid (car/cid-str cid) :changed-frame :refused :corrupt-archive :refused :pass true}))))
(shutdown-agents)
