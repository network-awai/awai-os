(require '[otehon.storage :as s] '[otehon.pack-store :as p])
(import '[java.nio.file Files Paths OpenOption] '[java.util Arrays])
(def data (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range (* 2 1024 1024)))))
(dotimes [i 4]
 (let [d (str ".agent-output/crosspack/source-" i)
       start (* i 524288) part (Arrays/copyOfRange data start (+ start 524288))]
  (s/init! d) (p/put-data! d "file" part)
  (let [car (p/export-car (p/recover d) "file")]
   (Files/write (Paths/get (str ".agent-output/crosspack/part-" i ".car") (make-array String 0))
                (Arrays/copyOfRange car 51 (alength car)) (make-array OpenOption 0)))))
