(ns otehon.cli
  (:require [awai.fs.car :as car]
            [otehon.storage :as store]
            [otehon.forest-writer :as forest-writer]
            [otehon.pack-store :as pack])
  (:import [java.nio ByteBuffer]
           [java.nio.channels FileChannel]
           [java.nio.file Files Paths OpenOption StandardOpenOption LinkOption]
           [java.security MessageDigest]
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

(def ^:dynamic *export-observer* nil)

(defn- observe-export! [event]
  (when *export-observer* (*export-observer* event)))

(defn- sync-dir! [dir]
  (with-open [channel (FileChannel/open dir (into-array OpenOption [StandardOpenOption/READ]))]
    (.force channel true)))

(defn- export-group! [handle name filename]
  ;; Keep a failed staging file for inspection. Hard-link publication is
  ;; exclusive: an existing destination is never overwritten, even in a race.
  (let [size (pack/group-size handle name)
        dest (.normalize (.toAbsolutePath (Paths/get filename (make-array String 0))))
        parent (.getParent dest)
        _ (when (Files/exists dest (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
            (throw (java.nio.file.FileAlreadyExistsException. (str dest))))
        tmp (Files/createTempFile parent ".awai-export-" ".pending"
              (into-array FileAttribute [(PosixFilePermissions/asFileAttribute
                                            (PosixFilePermissions/fromString "rw-------"))]))
        md (MessageDigest/getInstance "SHA-256")]
    (with-open [out (FileChannel/open tmp (into-array OpenOption [StandardOpenOption/WRITE LinkOption/NOFOLLOW_LINKS]))]
      (loop [offset 0]
        (when (< offset size)
          (let [n (min pack/max-car-bytes (- size offset))
                data (pack/read-group-range handle name offset n)
                buf (ByteBuffer/wrap ^bytes data)]
            (when-not (= n (alength ^bytes data))
              (throw (ex-info "short verified group read" {:type :short-read})))
            (.update md ^bytes data)
            (while (.hasRemaining buf) (.write out buf))
            (recur (+ offset n)))))
      (.force out true))
    (observe-export! :file-synced)
    (Files/createLink dest tmp)
    (observe-export! :linked)
    (sync-dir! parent)
    (observe-export! :link-dir-synced)
    (Files/delete tmp)
    (observe-export! :staging-unlinked)
    (sync-dir! parent)
    (observe-export! :unlink-dir-synced)
    {:bytes size :sha256 (car/hex-encode (mapv #(bit-and 255 %) (.digest md)))}))

(defn- parse-generation! [text]
  (when-not (and (string? text) (re-matches #"[1-9][0-9]{0,15}" text))
    (throw (ex-info "invalid expected generation" {:type :invalid-generation})))
  (let [n (Long/parseLong text)]
    (when (> n 9007199254740991)
      (throw (ex-info "invalid expected generation" {:type :invalid-generation})))
    n))

(defn- observed-generation! [directory]
  (let [{:keys [root degraded?]} (store/read-store directory)]
    (when degraded? (throw (ex-info "cannot use degraded store" {:type :degraded-store})))
    (or (:generation root) (throw (ex-info "store generation unavailable" {:type :invalid-generation})))))

(defn- put-large! [directory name filename staging tool expected-generation]
  (select-keys (forest-writer/put-file-large! directory name filename staging tool
                                             {:expected-generation expected-generation})
               [:generation :tail :manifest-cid :file-size :pack-count]))

(defn -main [& args]
  (let [[command directory name filename] args]
    (case [command (count args)]
      ["pack-put" 4] (prn (pack/put-data! directory name (input-bytes filename)))
      ["pack-put-zstd3" 4] (prn (pack/put-data-zstd3! directory name (input-bytes filename)))
      ["car-import" 4] (prn (pack/import-car! directory name (input-bytes filename)))
      ["car-import-zstd3" 4] (prn (pack/import-car-zstd3! directory name (input-bytes filename)))
      ["forest-import" 4] (prn (pack/import-forest! directory name (input-bytes filename)))
      ["forest-import-direct" 4] (prn (pack/import-forest-direct! directory name (input-bytes filename)))
      ["forest-file-put" 6]
      (prn (select-keys (forest-writer/put-file! directory name filename (nth args 4) (nth args 5))
                        [:generation :tail :manifest-cid :file-size :pack-count]))
      ["forest-file-put-large" 6]
      (prn (put-large! directory name filename (nth args 4) (nth args 5)
                       (observed-generation! directory)))
      ["forest-file-put-large" 7]
      (prn (put-large! directory name filename (nth args 4) (nth args 5)
                       (parse-generation! (nth args 6))))
      ["forest-export" 4] (prn (output! filename (pack/export-forest (pack/recover directory) name)))
      ["forest-group-export" 4] (prn (export-group! (pack/recover directory) name filename))
      ["forest-get-block" 5]
      (let [cid-text (nth args 4)
            _ (car/parse-cid-str cid-text)
            cid (car/base32-decode (subs cid-text 1))
            bytes (pack/read-forest-block (pack/recover directory) name cid)]
        (when-not bytes (throw (ex-info "CID is absent" {:type :missing-block})))
        (prn (output! filename bytes)))
      ["pack-range-verified" 6]
      (prn (output! filename (pack/read-range-verified-leaves (pack/recover directory) name
                                (Long/parseLong (nth args 4)) (Long/parseLong (nth args 5)))))
      ["forest-group-range" 6]
      (prn (output! filename (pack/read-group-range (pack/recover directory) name
                                (Long/parseLong (nth args 4)) (Long/parseLong (nth args 5)))))
      ["pack-get" 4] (prn (output! filename (pack/read-data (pack/recover directory) name)))
      ["car-export" 4] (prn (output! filename (pack/export-car (pack/recover directory) name)))
      ["pack-recover" 2] (prn (pack/summary (pack/recover directory)))
      ["pack-checkpoint" 2] (prn (pack/checkpoint! directory))
      (if (and (= command "logical-forest-import") (<= 6 (count args) 69))
        (let [generation (observed-generation! directory)]
          (prn (pack/import-logical-forest-files! directory name (vec (drop 5 args))
                                                 (input-bytes filename) (nth args 4)
                                                 {:expected-generation generation})))
        (apply store/-main args)))))
