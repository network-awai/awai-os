(ns otehon.cli
  (:require [otehon.storage :as store]
            [otehon.pack-store :as pack])
  (:import [java.nio ByteBuffer]
           [java.nio.channels FileChannel]
           [java.nio.file Paths OpenOption StandardOpenOption LinkOption]
           [java.nio.file.attribute FileAttribute PosixFilePermissions]))

(defn- input-bytes [filename]
  (with-open [in (FileChannel/open (Paths/get filename (make-array String 0))
                                   (into-array OpenOption [StandardOpenOption/READ LinkOption/NOFOLLOW_LINKS]))]
    (when (> (.size in) pack/max-car-bytes)
      (throw (ex-info "input exceeds 1 MiB" {:type :too-large})))
    (let [buffer (ByteBuffer/allocate (int (.size in)))]
      (while (.hasRemaining buffer)
        (when (neg? (.read in buffer)) (throw (ex-info "input shortened" {:type :short-read}))))
      (.array buffer))))

(defn- output! [filename bytes]
  ;; Explicit exports create new files only; never overwrite user evidence.
  (with-open [out (FileChannel/open (Paths/get filename (make-array String 0))
                                    #{StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE}
                                    (into-array FileAttribute
                                      [(PosixFilePermissions/asFileAttribute
                                         (PosixFilePermissions/fromString "rw-------"))]))]
    (let [buffer (ByteBuffer/wrap ^bytes bytes)]
      (while (.hasRemaining buffer) (.write out buffer)))
    (.force out true))
  {:bytes (alength ^bytes bytes)})

(defn -main [& args]
  (let [[command directory name filename] args]
    (case [command (count args)]
      ["pack-put" 4] (prn (pack/put-data! directory name (input-bytes filename)))
      ["pack-put-zstd3" 4] (prn (pack/put-data-zstd3! directory name (input-bytes filename)))
      ["car-import" 4] (prn (pack/import-car! directory name (input-bytes filename)))
      ["car-import-zstd3" 4] (prn (pack/import-car-zstd3! directory name (input-bytes filename)))
      ["pack-range-verified" 6]
      (prn (output! filename (pack/read-range-verified-leaves (pack/recover directory) name
                                (Long/parseLong (nth args 4)) (Long/parseLong (nth args 5)))))
      ["pack-get" 4] (prn (output! filename (pack/read-data (pack/recover directory) name)))
      ["car-export" 4] (prn (output! filename (pack/export-car (pack/recover directory) name)))
      ["pack-recover" 2] (prn (pack/summary (pack/recover directory)))
      ["pack-checkpoint" 2] (prn (pack/checkpoint! directory))
      (apply store/-main args))))
