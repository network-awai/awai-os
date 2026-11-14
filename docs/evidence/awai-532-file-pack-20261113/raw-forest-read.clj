(require '[otehon.pack-store :as p])
(import '[java.nio.file Files Paths] '[java.io ByteArrayOutputStream] '[java.util Arrays])
(let [dir (first *command-line-args*)
      input (Files/readAllBytes (Paths/get (str dir "/input.bin") (make-array String 0)))
      h (p/recover (str dir "/store")) out (ByteArrayOutputStream.)]
  (doseq [offset (range 0 (alength input) 524288)]
    (.write out (p/read-group-range h "file" offset (min 524288 (- (alength input) offset)))))
  (when-not (Arrays/equals input (.toByteArray out)) (throw (ex-info "bytes differ" {})))
  (prn {:separate-process true :bytes (alength input) :equal true :pass true}))
