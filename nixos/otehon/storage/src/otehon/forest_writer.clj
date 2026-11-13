(ns otehon.forest-writer
  "Bounded hosted raw-file to Forest group writer. This is not Native I/O."
  (:require [awai.fs.car :as car] [otehon.pack-store :as pack])
  (:import [java.nio.file Files Paths OpenOption LinkOption StandardOpenOption CopyOption]
           [java.nio.file.attribute FileAttribute PosixFilePermissions]
           [java.security MessageDigest]
           [java.util.concurrent TimeUnit]))

(def ^:private leaf-size 65536)
(def ^:private pack-bytes (* 14 leaf-size))
(def ^:private max-packs 64)
(def ^:private tool-digests
  ;; Pinned release 0.39.0+git.7f63144. Linux digest is observed, not
  ;; independently qualified; artifact provenance is recorded separately.
  #{"e5fb23076a46c055142b3dbf3efa1ad5a68532d14419ad9994785986719b205f"
    "7af03845db7324da80c5bc2848fe6897303b39cbac8bb701675e57ad82033ba0"})

(defn- fail! [type message] (throw (ex-info message {:type type})))
(defn- to-bytes [v] (byte-array (map unchecked-byte v)))
(defn- digest [v]
  (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256")
                                   (if (bytes? v) v (to-bytes v)))))
(defn- tool-digest [path]
  (let [md (MessageDigest/getInstance "SHA-256") buf (byte-array 65536)]
    (with-open [in (Files/newInputStream (Paths/get path (make-array String 0))
                                        (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
      (loop [] (let [n (.read in buf)]
                 (when (pos? n) (.update md buf 0 n) (recur)))))
    (car/hex-encode (mapv #(bit-and 255 %) (.digest md)))))
(defn- write-new! [path data]
  (Files/write (Paths/get path (make-array String 0)) data
               (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE])))

(defn put-file!
  "Read a fixed-64KiB logical profile, generate bounded Forest Packs and publish
  a single root. STAGING must not exist and is retained for inspection. TOOL
  must match an explicit Forest release digest. The source is not deleted."
  [directory name source staging tool]
  (when-not (every? string? [directory name source staging tool])
    (fail! :invalid-argument "expected string paths and name"))
  (when-not (contains? tool-digests (tool-digest tool))
    (fail! :untrusted-forest-tool "Forest tool does not match a pinned digest"))
  (let [src (Paths/get source (make-array String 0))
        nofollow (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])
        initial-size (Files/size src)
        initial-time (Files/getLastModifiedTime src nofollow)]
    (when-not (and (pos? initial-size) (<= initial-size (* max-packs pack-bytes)))
      (fail! :invalid-file-size "input is empty or exceeds the bounded writer profile"))
    (Files/createDirectory (Paths/get staging (make-array String 0))
      (into-array FileAttribute [(PosixFilePermissions/asFileAttribute
                                  (PosixFilePermissions/fromString "rwx------"))]))
    (let [staged-tool (str staging "/forest-tool")
          _ (with-open [tool-in (Files/newInputStream (Paths/get tool (make-array String 0))
                                                      (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
              (Files/copy tool-in (Paths/get staged-tool (make-array String 0)) (make-array CopyOption 0)))
          _ (when-not (contains? tool-digests (tool-digest staged-tool))
              (fail! :untrusted-forest-tool "staged Forest tool does not match a pinned digest"))
          _ (Files/setPosixFilePermissions (Paths/get staged-tool (make-array String 0))
                                           (PosixFilePermissions/fromString "r-x------"))
          result
          (with-open [in (Files/newInputStream src (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
            (loop [i 0 offset 0 chunks [] paths []]
              (let [batch (.readNBytes in pack-bytes)]
                (if (zero? (alength ^bytes batch))
                  {:chunks chunks :paths paths :size offset}
                  (do
                    (when (>= i max-packs) (fail! :too-large "input grew beyond the Pack limit"))
                    (let [leaves (mapv (fn [part] (let [v (mapv #(bit-and 255 %) part)]
                                                    {:bytes v :digest (digest v)}))
                                       (partition-all leaf-size batch))
                          carbytes (:car (car/assemble-pack leaves digest))
                          end (first (car/decode-u64-le carbytes 43))
                          carpath (str staging "/" i ".car") forestpath (str staging "/" i ".forest.car.zst")
                          logpath (str staging "/" i ".log")
                          _ (write-new! carpath (to-bytes (subvec carbytes 51 end)))
                          process (.start (doto (ProcessBuilder. ^java.util.List
                                                    [staged-tool "snapshot" "compress" carpath "--output-path" forestpath "--frame-size" "1024"])
                                            (.redirectErrorStream true)
                                            (.redirectOutput (java.io.File. logpath))))
                          finished (.waitFor process 120 TimeUnit/SECONDS)
                          _ (when-not finished (.destroyForcibly process) (fail! :forest-timeout "Forest compression timed out"))
                          _ (when-not (zero? (.exitValue process)) (fail! :forest-failed "Forest compression failed; see staging log"))
                          next-chunks (loop [xs leaves pos offset out chunks]
                                        (if-let [leaf (first xs)]
                                          (let [n (count (:bytes leaf)) cid (car/cid-bytes car/codec-raw (:digest leaf))]
                                            (recur (rest xs) (+ pos n)
                                                   (conj out {"cid" {:tag 42 :bytes cid} "offset" pos "length" n})))
                                          out))]
                      (recur (inc i) (+ offset (alength ^bytes batch)) next-chunks (conj paths forestpath))))))))]
      (when-not (and (= initial-size (:size result)) (= initial-size (Files/size src))
                     (= initial-time (Files/getLastModifiedTime src nofollow)))
        (fail! :source-changed "source file changed during import"))
      (let [manifest (car/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" (:size result)
                                        "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" leaf-size}
                                        "chunks" (:chunks result)})
            cid (car/cid-str (car/cid-bytes car/codec-dag-cbor (digest manifest)))
            committed (pack/import-logical-forest-files! directory name (:paths result) (to-bytes manifest) cid)]
        (assoc committed :manifest-cid cid :file-size (:size result) :pack-count (count (:paths result)))))))
