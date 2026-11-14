(ns otehon.forest-writer
  "Bounded hosted raw-file to Forest group writer. This is not Native I/O."
  (:require [awai.fs.car :as car] [otehon.pack-store :as pack]
            [otehon.forest :as forest] [otehon.ipld-forest :as ipld])
  (:import [java.nio ByteBuffer] [java.nio.channels FileChannel]
           [java.nio.file Files Paths OpenOption LinkOption StandardOpenOption CopyOption]
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
(defn- file-digest [path]
  (let [md (MessageDigest/getInstance "SHA-256") buf (byte-array 65536)]
    (with-open [in (Files/newInputStream (Paths/get path (make-array String 0))
                                        (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
      (loop [] (let [n (.read in buf)]
                 (when (pos? n) (.update md buf 0 n) (recur)))))
    (car/hex-encode (mapv #(bit-and 255 %) (.digest md)))))
(defn- write-new! [path data]
  (Files/write (Paths/get path (make-array String 0)) data
               (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE])))

(defn- read-generated-forest [path]
  (when-not (Files/isRegularFile path (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
    (fail! :invalid-forest "generated Forest file is not regular"))
  (with-open [channel (FileChannel/open path (into-array OpenOption [StandardOpenOption/READ LinkOption/NOFOLLOW_LINKS]))]
    (let [size (.size channel)]
      (when-not (<= 1 size forest/max-size) (fail! :invalid-forest "generated Forest file is not bounded"))
      (let [buffer (ByteBuffer/allocate (int size))]
        (while (.hasRemaining buffer)
          (when (<= (.read channel buffer) 0) (fail! :changed-payload "generated Forest file shortened")))
        (when-not (= size (.size channel)) (fail! :changed-payload "generated Forest file size changed"))
        (.array buffer)))))

(def ^:private unconditional (Object.))
(def ^:private max-ipld-block-bytes (* 850 1024))
(def ^:private max-ipld-input-bytes (* 32 1024 1024))
(def ^:private max-ipld-archive-bytes (* 900 1024))
(def ^:private max-ipld-blocks-per-archive 64)

(defn validate-ipld-block
  "Validate and copy one bounded canonical CID/byte pair."
  [{:keys [cid bytes] :as block}]
  (when-not (and (map? block) (= #{:cid :bytes} (set (keys block)))
                 (string? cid) (bytes? bytes) (<= 0 (alength ^bytes bytes) max-ipld-block-bytes))
    (fail! :invalid-ipld-block "invalid CID or bounded block bytes"))
  (let [owned (aclone ^bytes bytes)
        raw (car/base32-decode (if (and (seq cid) (= \b (first cid))) (subs cid 1)
                                  (fail! :invalid-ipld-block "expected base32 CIDv1")))
        {:keys [codec digest next-offset]} (car/parse-cid raw)]
    (when-not (and (= next-offset (count raw)) (= cid (car/cid-str raw))
                   (= raw (car/cid-bytes codec digest)) (= digest (otehon.forest-writer/digest owned)))
      (fail! :cid-mismatch "block CID does not match canonical bytes"))
    {:cid cid :cid-bytes raw :bytes owned}))

(defn- ipld-batches [blocks]
  (loop [remaining blocks current [] size 0 result []]
    (if-let [block (first remaining)]
      (let [n (+ 64 (alength ^bytes (:bytes block)))]
        (if (and (seq current) (or (= (count current) max-ipld-blocks-per-archive)
                                   (> (+ size n) max-ipld-archive-bytes)))
          (recur remaining [] 0 (conj result current))
          (recur (next remaining) (conj current block) (+ size n) result)))
      (cond-> result (seq current) (conj current)))))

(defn put-ipld-blocks!
  "Build bounded Forest archives from canonical CID/byte pairs and atomically
  publish one generic group. The entire <=32 MiB input is owned in memory;
  this is not a streaming or GiB writer. STAGING is new and retained. The
  seven-argument form requires the observed store generation under the writer
  lock; the six-argument form remains unconditional."
  ([directory name basis blocks staging tool]
   (put-ipld-blocks! directory name basis blocks staging tool unconditional))
  ([directory name basis blocks staging tool expected-generation]
  (when-not (or (identical? unconditional expected-generation)
                (and (integer? expected-generation) (<= 1 expected-generation 9007199254740991)))
    (fail! :invalid-generation "expected a positive bounded store generation"))
  (when-not (and (every? string? [directory name basis staging tool])
                 (vector? blocks) (<= 1 (count blocks) (* max-packs max-ipld-blocks-per-archive)))
    (fail! :invalid-argument "expected bounded blocks and string paths"))
  (when-not (contains? tool-digests (file-digest tool))
    (fail! :untrusted-forest-tool "Forest tool does not match a pinned digest"))
  ;; Check the aggregate bound before copying caller-owned arrays.
  (when-not (every? #(and (map? %) (bytes? (:bytes %))) blocks)
    (fail! :invalid-ipld-block "expected block byte arrays"))
  (when (> (reduce + 0 (map #(alength ^bytes (:bytes %)) blocks)) max-ipld-input-bytes)
    (fail! :too-large "IPLD input exceeds 32 MiB"))
  (let [owned (mapv validate-ipld-block blocks)
        cids (mapv :cid owned)
        batches (ipld-batches owned)]
    (when-not (= (count cids) (count (set cids))) (fail! :duplicate-cid "duplicate block CID"))
    (when-not (some #{basis} cids) (fail! :invalid-ipld-basis "basis block missing from input"))
    (when (> (count batches) max-packs) (fail! :too-large "IPLD input exceeds archive count"))
    (Files/createDirectory (Paths/get staging (make-array String 0))
      (into-array FileAttribute [(PosixFilePermissions/asFileAttribute
                                  (PosixFilePermissions/fromString "rwx------"))]))
    (let [staged-tool (str staging "/forest-tool")]
      (with-open [tool-in (Files/newInputStream (Paths/get tool (make-array String 0))
                                                (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
        (Files/copy tool-in (Paths/get staged-tool (make-array String 0)) (make-array CopyOption 0)))
      (when-not (contains? tool-digests (file-digest staged-tool))
        (fail! :untrusted-forest-tool "staged Forest tool does not match a pinned digest"))
      (Files/setPosixFilePermissions (Paths/get staged-tool (make-array String 0))
                                    (PosixFilePermissions/fromString "r-x------"))
      (let [archives
            (mapv (fn [i batch]
                    (let [root (:cid (first batch))
                          carbytes (car/carv1-encode {:roots [(:cid-bytes (first batch))]
                                    :blocks (mapv (fn [b] {:cid (:cid-bytes b)
                                                           :bytes (mapv #(bit-and 255 %) (:bytes b))}) batch)})
                          carpath (str staging "/" i ".car") forestpath (str staging "/" i ".forest")
                          _ (write-new! carpath (to-bytes carbytes))
                          proc (.start (doto (ProcessBuilder. ^java.util.List
                                               [staged-tool "snapshot" "compress" carpath "--output-path" forestpath "--frame-size" "1"])
                                         (.redirectErrorStream true)
                                         (.redirectOutput (java.io.File. (str staging "/" i ".log")))))]
                      (when-not (.waitFor proc 120 TimeUnit/SECONDS)
                        (.destroyForcibly proc) (fail! :forest-timeout "Forest compression timed out"))
                      (when-not (zero? (.exitValue proc)) (fail! :forest-failed "Forest compression failed"))
                      (let [path (Paths/get forestpath (make-array String 0))]
                        (let [bytes (read-generated-forest path)
                              parsed (car/carv1-decode (:carv1 (forest/open bytes)))
                              expected (mapv (fn [b] {:cid (:cid-bytes b) :bytes (mapv #(bit-and 255 %) (:bytes b))}) batch)
                              actual (mapv #(select-keys % [:cid :bytes]) (:blocks parsed))]
                          (when-not (and (= [(:cid-bytes (first batch))] (:roots parsed)) (= expected actual))
                            (fail! :forest-content-mismatch "generated archive differs from input blocks"))
                          {:root-cid root :bytes bytes}))))
                  (range) batches)
            group (if (identical? unconditional expected-generation)
                    (ipld/publish-group! directory name basis archives)
                    (ipld/publish-group! directory name basis archives expected-generation))]
        {:group group :archive-count (count archives) :block-count (count owned)})))))

(defn put-file!
  "Read a fixed-64KiB logical profile, generate bounded Forest Packs and publish
  a single root. STAGING must not exist and is retained for inspection. TOOL
  must match an explicit Forest release digest. The source is not deleted."
  [directory name source staging tool]
  (when-not (every? string? [directory name source staging tool])
    (fail! :invalid-argument "expected string paths and name"))
  (when-not (contains? tool-digests (file-digest tool))
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
          _ (when-not (contains? tool-digests (file-digest staged-tool))
              (fail! :untrusted-forest-tool "staged Forest tool does not match a pinned digest"))
          _ (Files/setPosixFilePermissions (Paths/get staged-tool (make-array String 0))
                                           (PosixFilePermissions/fromString "r-x------"))
          source-digest (MessageDigest/getInstance "SHA-256")
          result
          (with-open [in (Files/newInputStream src (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
            (loop [i 0 offset 0 chunks [] paths []]
              (let [batch (.readNBytes in pack-bytes)]
                (if (zero? (alength ^bytes batch))
                  {:chunks chunks :paths paths :size offset}
                  (do
                    (when (>= i max-packs) (fail! :too-large "input grew beyond the Pack limit"))
                    (.update source-digest ^bytes batch)
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
                     (= initial-time (Files/getLastModifiedTime src nofollow))
                     (= (car/hex-encode (mapv #(bit-and 255 %) (.digest source-digest)))
                        (file-digest source))
                     (= initial-size (Files/size src))
                     (= initial-time (Files/getLastModifiedTime src nofollow)))
        (fail! :source-changed "source file changed during import"))
      (let [manifest (car/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" (:size result)
                                        "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" leaf-size}
                                        "chunks" (:chunks result)})
            cid (car/cid-str (car/cid-bytes car/codec-dag-cbor (digest manifest)))
            committed (pack/import-logical-forest-files! directory name (:paths result) (to-bytes manifest) cid)]
        (assoc committed :manifest-cid cid :file-size (:size result) :pack-count (count (:paths result)))))))

(defn put-file-large!
  "Create a file with an explicit fixed 1 MiB logical profile and up to 64
  16-leaf Forest Packs. Keeps at most one Pack of raw byte arrays in memory.
  The source stays untouched; staging and interrupted objects are retained.
  Optional :expected-generation fences stale local writers at publication."
  ([directory name source staging tool]
   (put-file-large! directory name source staging tool {}))
  ([directory name source staging tool options]
  (when-not (and (map? options) (every? #{:expected-generation} (keys options))
                 (or (not (contains? options :expected-generation))
                     (and (integer? (:expected-generation options))
                          (<= 1 (:expected-generation options) 9007199254740991))))
    (fail! :invalid-generation "expected a positive bounded store generation"))
  (when-not (every? string? [directory name source staging tool])
    (fail! :invalid-argument "expected string paths and name"))
  (when-not (contains? tool-digests (file-digest tool))
    (fail! :untrusted-forest-tool "Forest tool does not match a pinned digest"))
  (let [src (Paths/get source (make-array String 0))
        nofollow (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])
        initial-size (Files/size src) initial-time (Files/getLastModifiedTime src nofollow)
        large-leaf (* 1024 1024) max-size (* max-packs 16 large-leaf)]
    (when-not (and (pos? initial-size) (<= initial-size max-size))
      (fail! :invalid-file-size "input exceeds 1 MiB profile bounds"))
    (Files/createDirectory (Paths/get staging (make-array String 0))
      (into-array FileAttribute [(PosixFilePermissions/asFileAttribute
                                  (PosixFilePermissions/fromString "rwx------"))]))
    (let [staged-tool (str staging "/forest-tool")
          _ (with-open [tool-in (Files/newInputStream (Paths/get tool (make-array String 0))
                                                      (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
              (Files/copy tool-in (Paths/get staged-tool (make-array String 0)) (make-array CopyOption 0)))
          _ (when-not (contains? tool-digests (file-digest staged-tool))
              (fail! :untrusted-forest-tool "staged Forest tool does not match a pinned digest"))
          _ (Files/setPosixFilePermissions (Paths/get staged-tool (make-array String 0))
                                           (PosixFilePermissions/fromString "r-x------"))
          source-digest (MessageDigest/getInstance "SHA-256")
          result (with-open [in (Files/newInputStream src (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
                   (loop [i 0 offset 0 chunks [] paths []]
                     (let [leaves (loop [j 0 out []]
                                    (if (= j 16) out
                                      (let [b (.readNBytes in large-leaf)]
                                        (if (zero? (alength ^bytes b)) out
                                          (do (.update source-digest ^bytes b)
                                              (recur (inc j) (conj out {:bytes b :digest (digest b)})))))))]
                       (if (empty? leaves) {:chunks chunks :paths paths :size offset}
                         (do
                           (when (>= i max-packs) (fail! :too-large "input grew beyond Pack limit"))
                           (let [cids (mapv #(car/cid-bytes car/codec-raw (:digest %)) leaves)
                                 root (car/pack-root-block cids digest)
                                 header (car/carv1-encode {:roots [(:cid root)] :blocks []})
                                 carpath (str staging "/" i ".car") forestpath (str staging "/" i ".forest.car.zst")
                                 _ (with-open [out (Files/newOutputStream (Paths/get carpath (make-array String 0))
                                                           (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
                                     (.write out (to-bytes header))
                                     (doseq [[leaf cid] (map vector leaves cids)]
                                       (.write out (to-bytes (car/encode-uvarint (+ (count cid) (alength ^bytes (:bytes leaf))))))
                                       (.write out (to-bytes cid))
                                       (.write out ^bytes (:bytes leaf)))
                                     (.write out (to-bytes (car/encode-uvarint (+ (count (:cid root)) (count (:bytes root))))))
                                     (.write out (to-bytes (:cid root)))
                                     (.write out (to-bytes (:bytes root))))
                                 process (.start (doto (ProcessBuilder. ^java.util.List
                                                    [staged-tool "snapshot" "compress" carpath "--output-path" forestpath "--frame-size" "1"])
                                            (.redirectErrorStream true)
                                            (.redirectOutput (java.io.File. (str staging "/" i ".log")))))]
                             (when-not (.waitFor process 120 TimeUnit/SECONDS)
                               (.destroyForcibly process) (fail! :forest-timeout "Forest compression timed out"))
                             (when-not (zero? (.exitValue process)) (fail! :forest-failed "Forest compression failed; see staging log"))
                             (let [[next-offset next-chunks]
                                   (reduce (fn [[pos out] [leaf cid]]
                                             (let [n (alength ^bytes (:bytes leaf))]
                                               [(+ pos n) (conj out {"cid" {:tag 42 :bytes cid} "offset" pos "length" n})]))
                                           [offset chunks] (map vector leaves cids))]
                               (recur (inc i) next-offset next-chunks (conj paths forestpath)))))))))]
      (when-not (and (= initial-size (:size result)) (= initial-size (Files/size src))
                     (= initial-time (Files/getLastModifiedTime src nofollow))
                     (= (car/hex-encode (mapv #(bit-and 255 %) (.digest source-digest))) (file-digest source))
                     (= initial-size (Files/size src)) (= initial-time (Files/getLastModifiedTime src nofollow)))
        (fail! :source-changed "source file changed during import"))
      (let [manifest (car/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" (:size result)
                                        "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" large-leaf}
                                        "chunks" (:chunks result)})
            cid (car/cid-str (car/cid-bytes car/codec-dag-cbor (digest manifest)))
            committed (pack/import-logical-forest-files! directory name (:paths result) (to-bytes manifest) cid (assoc options :file-backed? true))]
        (assoc committed :manifest-cid cid :file-size (:size result) :pack-count (count (:paths result))))))))
