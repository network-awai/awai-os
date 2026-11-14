(ns otehon.storage
  "Bounded local hosted-file store for Otehon. No network or native fallback.
  Immutable snapshot/WAL objects precede an atomic A/B root publication.
  SHA-256 binds bytes; it does not authenticate a writer or encrypt data."
  (:require [clojure.edn :as edn]
            [awai.fs.wal :as wal])
  (:import [java.nio ByteBuffer]
           [java.nio.channels FileChannel]
           [java.nio.file Files Path Paths LinkOption OpenOption StandardOpenOption
            CopyOption StandardCopyOption]
           [java.nio.file.attribute PosixFilePermissions FileAttribute]
           [java.security MessageDigest]
           [java.util UUID]))

(def ^:private max-bytes (* 1024 1024))
(def ^:dynamic *write-observer* nil)

(defn- fail! [type message]
  (throw (ex-info message {:type type})))

(defn- observe! [event role]
  (when *write-observer* (*write-observer* event role)))

(defn- path [root name] (.resolve ^Path root ^String name))
(defn- attrs [mode]
  (into-array FileAttribute [(PosixFilePermissions/asFileAttribute
                              (PosixFilePermissions/fromString mode))]))
(defn- exists? [p] (Files/exists p (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])))
(defn- sha [^bytes bytes]
  (apply str (map #(format "%02x" (bit-and 255 %))
                  (.digest (MessageDigest/getInstance "SHA-256") bytes))))
(defn- encode [value] (.getBytes (pr-str value) "UTF-8"))
(defn- parse [bytes]
  (with-open [r (java.io.PushbackReader. (java.io.StringReader. (String. ^bytes bytes "UTF-8")))]
    (let [opts {:eof ::eof :readers {} :default (fn [& _] (fail! :invalid-edn "unknown EDN tag"))}
          value (edn/read opts r)]
      (when (or (= ::eof value) (not= ::eof (edn/read opts r)))
        (fail! :invalid-edn "expected exactly one EDN value"))
      value)))

(defn- read-bytes [p]
  (with-open [channel (FileChannel/open p (into-array OpenOption
                                          [StandardOpenOption/READ LinkOption/NOFOLLOW_LINKS]))]
    (let [n (.size channel)]
      (when (> n max-bytes) (fail! :too-large "store record exceeds 1 MiB"))
      (let [buffer (ByteBuffer/allocate (int n))]
        (while (.hasRemaining buffer)
          (when (neg? (.read channel buffer)) (fail! :short-read "store record shortened")))
        (.array buffer)))))

(defn- sync-dir! [root]
  (with-open [channel (FileChannel/open root (into-array OpenOption [StandardOpenOption/READ]))]
    (.force channel true)))

(defn- write-record! [root name bytes role]
  (when (> (alength ^bytes bytes) max-bytes) (fail! :too-large "store record exceeds 1 MiB"))
  (let [tmp (path root (str ".pending-" (UUID/randomUUID)))
        target (path root name)
        half (quot (alength ^bytes bytes) 2)]
    ;; Incomplete temporary files are deliberately preserved for inspection.
    (with-open [out (FileChannel/open tmp
                                     #{StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE}
                                     (attrs "rw-------"))]
      (doseq [[start length event] [[0 half :half-written]
                                    [half (- (alength ^bytes bytes) half) :written]]]
        (let [buffer (ByteBuffer/wrap bytes start length)]
          (while (.hasRemaining buffer) (.write out buffer)))
        (observe! event role))
      (.force out true)
      (observe! :file-synced role))
    (Files/move tmp target (into-array CopyOption [StandardCopyOption/ATOMIC_MOVE
                                                  StandardCopyOption/REPLACE_EXISTING]))
    (observe! :renamed role)
    (sync-dir! root)
    (observe! :dir-synced role)))

(defn- object! [root value role]
  (let [bytes (encode {:format :awai.otehon-store/object-v1 :value value})
        digest (sha bytes)
        name (str digest ".edn")]
    (if (exists? (path root name))
      (do
        (when-not (= digest (sha (read-bytes (path root name))))
          (fail! :corrupt-object "existing immutable object is corrupt"))
        ;; A previous writer may have died after rename but before dir sync.
        ;; Reusing that orphan must finish publication before a new root.
        (sync-dir! root)
        (observe! :reused-dir-synced role))
      (write-record! root name bytes role))
    digest))

(defn- digest? [x] (and (string? x) (boolean (re-matches #"[0-9a-f]{64}" x))))
(defn- load-object [root digest]
  (when-not (digest? digest) (fail! :invalid-digest "invalid object reference"))
  (when-not (exists? (path root (str digest ".edn")))
    (fail! :missing-object "published root references a missing object"))
  (let [bytes (read-bytes (path root (str digest ".edn")))]
    (when-not (= digest (sha bytes)) (fail! :corrupt-object "immutable object digest mismatch"))
    (let [obj (parse bytes)]
      (when-not (and (= #{:format :value} (set (keys obj)))
                     (= :awai.otehon-store/object-v1 (:format obj)))
        (fail! :invalid-object "unsupported object format"))
      (:value obj))))

(defn- sequence? [x] (and (integer? x) (<= 0 x 9007199254740991)))
(defn- root-valid? [value]
  (and (map? value)
       (= #{:format :generation :checkpoint :tail :snapshot :log} (set (keys value)))
       (= :awai.otehon-store/root-v1 (:format value))
       (sequence? (:generation value)) (pos? (:generation value))
       (sequence? (:checkpoint value)) (sequence? (:tail value))
       (<= (:checkpoint value) (:tail value))
       (digest? (:snapshot value)) (digest? (:log value))))

;; Slot 0 begins with this durable marker before generation 1 is published.
;; Without it, a genuinely new store cannot be distinguished from a store
;; whose generation-2 root disappeared. It is replaced by generation 2.
(def ^:private initial-slot {:format :awai.otehon-store/initial-slot-v1})

(defn- load-slot [root i]
  (let [p (path root (str "root-" i ".edn"))]
    (if-not (exists? p)
      nil
      (try
        (let [envelope (parse (read-bytes p))]
          (if (= initial-slot envelope)
            (if (= i 0) {:initial? true} (fail! :invalid-root "initial slot in wrong location"))
            (let [{:keys [payload digest]} envelope
                  _ (when-not (and (map? envelope) (= #{:payload :digest} (set (keys envelope)))
                                    (string? payload) (digest? digest)
                                    (= digest (sha (.getBytes ^String payload "UTF-8"))))
                      (fail! :corrupt-root "root envelope digest mismatch"))
                  value (parse (.getBytes ^String payload "UTF-8"))]
              (when-not (and (root-valid? value) (= i (mod (:generation value) 2)))
                (fail! :invalid-root "invalid root or slot generation"))
              {:root value})))
        (catch Exception _ {:error :invalid-slot})))))

(defn- root-path [directory]
  (let [p (.normalize (.toAbsolutePath (Paths/get directory (make-array String 0))))]
    (when-not (and (Files/isDirectory p (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
                   (= p (.toRealPath p (make-array LinkOption 0))))
      (fail! :invalid-directory "store must be an existing real directory without symlinks"))
    p))

(defn write-car!
  "Publish bounded immutable CAR bytes before a metadata transaction. Call
  from transact!'s before-publish hook to share its writer lock. Orphans are
  retained; only committed metadata makes a CAR visible to Pack readers."
  [directory bytes]
  (when-not (and (bytes? bytes) (<= (alength ^bytes bytes) max-bytes))
    (fail! :too-large "CAR requires a byte array of at most 1 MiB"))
  (let [bytes (aclone ^bytes bytes)
        root (root-path directory)
        digest (sha bytes)
        name (str digest ".car")]
    (if (exists? (path root name))
      (do
        (when-not (= digest (sha (read-bytes (path root name))))
          (fail! :corrupt-car "existing immutable CAR is corrupt"))
        (sync-dir! root)
        (observe! :reused-dir-synced :pack))
      (write-record! root name bytes :pack))
    digest))

(defn read-car
  "Read an immutable CAR by its exact byte digest, with the same 1 MiB bound,
  no-symlink rule and corruption refusal as metadata objects."
  [directory digest]
  (when-not (digest? digest) (fail! :invalid-digest "invalid CAR reference"))
  (let [p (path (root-path directory) (str digest ".car"))]
    (when-not (exists? p) (fail! :missing-car "committed CAR is missing"))
    (let [bytes (read-bytes p)]
      (when-not (= digest (sha bytes)) (fail! :corrupt-car "CAR byte digest mismatch"))
      bytes)))

(defn write-zpack!
  "Opt-in physical representation; call only inside the metadata writer lock.
  Publish/force/rename/sync ordering is identical to CAR publication."
  [directory bytes]
  (when-not (and (bytes? bytes) (<= (alength ^bytes bytes) max-bytes))
    (fail! :too-large "segmented Pack exceeds 1 MiB"))
  (let [bytes (aclone ^bytes bytes) root (root-path directory)
        digest (sha bytes) name (str digest ".zpack")]
    (if (exists? (path root name))
      (do (when-not (= digest (sha (read-bytes (path root name))))
            (fail! :corrupt-zpack "existing segmented Pack is corrupt"))
          (sync-dir! root) (observe! :reused-dir-synced :zpack))
      (write-record! root name bytes :zpack))
    digest))

(defn read-zpack [directory digest]
  (when-not (digest? digest) (fail! :invalid-digest "invalid segmented Pack reference"))
  (let [p (path (root-path directory) (str digest ".zpack"))]
    (when-not (exists? p) (fail! :missing-zpack "committed segmented Pack is missing"))
    (let [bytes (read-bytes p)]
      (when-not (= digest (sha bytes)) (fail! :corrupt-zpack "segmented Pack digest mismatch"))
      bytes)))

(defn write-forest!
  "Publish immutable Forest bytes inside the metadata writer lock."
  [directory bytes]
  (when-not (and (bytes? bytes) (<= 1 (alength ^bytes bytes) max-bytes))
    (fail! :too-large "Forest archive exceeds 1 MiB"))
  (let [bytes (aclone ^bytes bytes) root (root-path directory)
        digest (sha bytes) name (str digest ".forest")]
    (if (exists? (path root name))
      (do (when-not (= digest (sha (read-bytes (path root name))))
            (fail! :corrupt-forest "existing Forest archive is corrupt"))
          (sync-dir! root) (observe! :reused-dir-synced :forest))
      (write-record! root name bytes :forest))
    digest))

(defn read-forest [directory digest]
  (when-not (digest? digest) (fail! :invalid-digest "invalid Forest reference"))
  (let [p (path (root-path directory) (str digest ".forest"))]
    (when-not (exists? p) (fail! :missing-forest "committed Forest archive is missing"))
    (let [bytes (read-bytes p)]
      (when-not (= digest (sha bytes)) (fail! :corrupt-forest "Forest digest mismatch"))
      bytes)))

(def ^:private max-forest-file-bytes (* 32 1024 1024))

(defn- stream-hash! [source output expected-size]
  (let [md (MessageDigest/getInstance "SHA-256") buffer (ByteBuffer/allocate 65536)]
    (loop [total 0 half-observed? false]
      (.clear buffer)
      (when (and output (not half-observed?))
        (.limit buffer (int (min 65536 (- (max 1 (quot expected-size 2)) total)))))
      (let [n (.read ^FileChannel source buffer)]
        (cond
          (neg? n)
          (do (when-not (= total expected-size)
                (fail! :changed-payload "Forest file length changed while reading"))
              (apply str (map #(format "%02x" (bit-and 255 %)) (.digest md))))
          (zero? n) (fail! :short-read "Forest file read made no progress")
          :else
          (let [next (+ total n)]
            (when (> next expected-size)
              (fail! :changed-payload "Forest file grew while reading"))
            (.flip buffer)
            (.update md (.asReadOnlyBuffer buffer))
            (when output
              (while (.hasRemaining buffer) (.write ^FileChannel output buffer)))
            (let [half-now? (and output (not half-observed?) (>= next (max 1 (quot expected-size 2))))]
              (when half-now? (observe! :half-written :forest))
              (recur next (or half-observed? half-now?)))))))))

(defn forest-source-digest
  "Hash a bounded regular file without following its final symlink."
  [source]
  (when-not (string? source) (fail! :invalid-forest-source "expected file path"))
  (let [p (Paths/get source (make-array String 0))]
    (when-not (Files/isRegularFile p (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
      (fail! :invalid-forest-source "Forest source must be a regular file"))
    (with-open [in (FileChannel/open p (into-array OpenOption [StandardOpenOption/READ LinkOption/NOFOLLOW_LINKS]))]
      (let [n (.size in)]
        (when-not (<= 1 n max-forest-file-bytes) (fail! :invalid-forest-source "Forest source size outside bound"))
        {:size n :sha (stream-hash! in nil n)}))))

(defn forest-file-path
  "Resolve a content-addressed Forest object under an existing real store."
  [directory digest]
  (when-not (digest? digest) (fail! :invalid-digest "invalid Forest reference"))
  (let [p (path (root-path directory) (str digest ".forest"))]
    (when-not (Files/isRegularFile p (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
      (fail! :missing-forest "Forest object is missing or not regular"))
    (str p)))

(defn write-forest-file!
  "Copy a bounded Forest file under its expected SHA-256 using a fixed buffer.
  Call inside the metadata writer lock. File sync, atomic rename and directory
  sync precede root publication; failed temporary files remain for inspection.
  This only verifies physical bytes, not Forest structure or block CIDs."
  [directory source expected-size expected-sha]
  (when-not (and (string? source) (digest? expected-sha)
                 (integer? expected-size) (<= 1 expected-size max-forest-file-bytes))
    (fail! :invalid-forest-source "invalid Forest source size or digest"))
  (let [root (root-path directory) target (path root (str expected-sha ".forest"))
        src (Paths/get source (make-array String 0))
        opts (into-array OpenOption [StandardOpenOption/READ LinkOption/NOFOLLOW_LINKS])]
    (when-not (Files/isRegularFile src (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
      (fail! :invalid-forest-source "Forest source must be a regular file"))
    (with-open [in (FileChannel/open src opts)]
      (when-not (= expected-size (.size in))
        (fail! :changed-payload "Forest source size differs"))
      (if (exists? target)
        (with-open [existing (FileChannel/open target opts)]
          (when-not (= expected-sha (stream-hash! in nil expected-size))
            (fail! :forest-source-changed "Forest source digest mismatch"))
          (when-not (and (= expected-size (.size existing))
                         (= expected-sha (stream-hash! existing nil expected-size)))
            (fail! :corrupt-forest "existing immutable Forest archive is corrupt"))
          (sync-dir! root)
          (observe! :reused-dir-synced :forest))
        (let [tmp (path root (str ".pending-" (UUID/randomUUID)))]
          (with-open [out (FileChannel/open tmp
                             #{StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE}
                             (attrs "rw-------"))]
            (when-not (= expected-sha (stream-hash! in out expected-size))
              (fail! :forest-source-changed "Forest source digest mismatch"))
            (observe! :written :forest)
            (.force out true)
            (observe! :file-synced :forest))
          (Files/move tmp target (into-array CopyOption [StandardCopyOption/ATOMIC_MOVE]))
          (observe! :renamed :forest)
          (sync-dir! root)
          (observe! :dir-synced :forest))))
    expected-sha))

(defn read-payload-segments
  "Positioned reads for an explicitly selected range-verification operation.
  Does not verify the whole-file digest; caller must verify every returned
  complete leaf/frame against its previously verified immutable snapshot."
  [directory digest extension expected-size spans]
  (when-not (and (digest? digest) (contains? #{"car" "zpack" "forest"} extension)
                 (integer? expected-size) (<= 0 expected-size (if (= extension "forest") max-forest-file-bytes max-bytes))
                 (vector? spans) (<= (count spans) 64)
                 (every? (fn [{:keys [offset length]}]
                           (and (integer? offset) (integer? length)
                                (<= 0 offset expected-size) (<= 0 length (- expected-size offset)))) spans)
                 (<= (reduce + 0 (map :length spans)) (if (= extension "forest") (* 2 max-bytes) max-bytes)))
    (fail! :invalid-range "invalid physical read bounds"))
  (let [p (path (root-path directory) (str digest "." extension))]
    (when-not (Files/isRegularFile p (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
      (fail! :missing-payload "range payload is not a regular file"))
    (with-open [channel (FileChannel/open p (into-array OpenOption [StandardOpenOption/READ LinkOption/NOFOLLOW_LINKS]))]
      (when-not (= expected-size (.size channel)) (fail! :changed-payload "range payload size changed"))
      (mapv (fn [{:keys [offset length]}]
              (let [b (ByteBuffer/allocate (int length))]
                (loop [pos offset]
                  (when (.hasRemaining b)
                    (let [n (.read channel b (long pos))]
                      (when (<= n 0) (fail! :short-read "range payload shortened"))
                      (recur (+ pos n)))))
                (.array b))) spans))))

(defn- state? [value]
  (and (map? value) (every? string? (keys value)) (every? string? (vals value))))
(defn- frame-valid? [{:keys [op payload]}]
  (and (map? payload) (string? (:key payload))
       (case op
         :put (and (= #{:key :value} (set (keys payload))) (string? (:value payload)))
         :delete (= #{:key} (set (keys payload)))
         false)))
(defn- apply-frame [state {:keys [op payload]}]
  (case op
    :put (assoc state (:key payload) (:value payload))
    :delete (dissoc state (:key payload))))

(defn- recover* [root]
  (let [slots (mapv #(load-slot root %) [0 1])
        candidates (keep :root slots)
        chosen (last (sort-by :generation candidates))]
    (when-not chosen (fail! :no-root "no valid committed root; store preserved"))
    ;; A valid newest root with missing/corrupt referenced data must refuse.
    ;; Do not silently roll back an already published commit to an older slot.
    (let [snapshot (load-object root (:snapshot chosen))
          log (load-object root (:log chosen))
          sb {:seq (:generation chosen)
              :slots (mapv (fn [{:keys [root]}]
                             (when root {:seq (:generation root) :committed true
                                         :root (select-keys root [:checkpoint :tail])})) slots)}]
      (when-not (and (map? snapshot) (state? (:state snapshot))
                     (map? log) (vector? (:frames log))
                     (every? frame-valid? (:frames log))
                     (= (:tail chosen) (:seq log)))
        (fail! :invalid-state "unsupported snapshot or WAL payload"))
      {:state (wal/recover log sb snapshot apply-frame)
       :root chosen :snapshot snapshot :log log
       :degraded? (boolean (or (some nil? slots) (some :error slots)
                               (and (some :initial? slots) (not= 1 (:generation chosen)))))})))

(defn read-store [directory]
  (select-keys (recover* (root-path directory)) [:state :root :degraded?]))

(defn- writable-state [root]
  (let [recovered (recover* root)]
    (when (:degraded? recovered)
      (fail! :degraded-store "invalid root slot requires review before further writes"))
    recovered))

(defn- with-writer [root action]
  (with-open [channel (FileChannel/open (path root ".writer.lock")
                                       #{StandardOpenOption/CREATE StandardOpenOption/WRITE
                                         LinkOption/NOFOLLOW_LINKS}
                                       (attrs "rw-------"))]
    (let [lock (try (.tryLock channel)
                    (catch Exception e
                      (if (= "java.nio.channels.OverlappingFileLockException" (.getName (class e)))
                        nil
                        (throw e))))]
      (when-not lock (fail! :writer-busy "another writer owns this store"))
      ;; Closing this channel releases its OS lock, including on exceptions.
      (action))))

(defn- publish! [root generation snapshot log]
  (when-not (and (sequence? generation) (pos? generation))
    (fail! :generation-exhausted "root generation exhausted"))
  (let [snapshot-ref (object! root snapshot :snapshot)
        log-ref (object! root log :wal)
        value {:format :awai.otehon-store/root-v1 :generation generation
               :checkpoint (:seq snapshot) :tail (:seq log)
               :snapshot snapshot-ref :log log-ref}
        payload (pr-str value)]
    (write-record! root (str "root-" (mod generation 2) ".edn")
                   (encode {:payload payload :digest (sha (.getBytes payload "UTF-8"))}) :root)
    {:generation generation :tail (:seq log)}))

(defn init! [directory]
  ;; createDirectory refuses any existing path, including partial stores.
  (let [p (.normalize (.toAbsolutePath (Paths/get directory (make-array String 0))))]
    (Files/createDirectory p (attrs "rwx------"))
    (sync-dir! (.getParent p))
    (with-writer (root-path directory)
      #(do (write-record! p "root-0.edn" (encode initial-slot) :initial-slot)
           (publish! p 1 {:seq 0 :state {}} (wal/empty-log))))))

(defn validate-write-witness!
  "Validate the host port shape, not witness independence or trust. CAS must
  atomically compare full root maps and return literal true only on success."
  [witness]
  (when-not (and (map? witness) (= #{:read! :compare-and-set!} (set (keys witness)))
                 (fn? (:read! witness)) (fn? (:compare-and-set! witness)))
    (fail! :invalid-witness "expected trusted read and conditional update ports"))
  witness)

(defn- transact* [directory op payload before-publish expected-generation witness after-publish]
  (when-not (frame-valid? {:op op :payload payload})
    (fail! :invalid-operation "expected put/delete with string key/value"))
  (when witness (validate-write-witness! witness))
  (let [root (root-path directory)]
    (with-writer root
      #(let [{:keys [snapshot log state] current :root} (writable-state root)]
         ;; Comparison and publication share the same OS writer lock. Check
         ;; before the hook so a stale caller cannot write immutable objects.
         (when (and (some? expected-generation)
                    (not= expected-generation (:generation current)))
           (throw (ex-info "store generation changed"
                           {:type :stale-generation :expected expected-generation
                            :actual (:generation current)})))
         (when (= 9007199254740991 (:seq log))
           (fail! :sequence-exhausted "WAL sequence exhausted"))
         (when (and witness (not= current ((:read! witness))))
           (fail! :witness-mismatch "current root differs from trusted witness"))
         (when before-publish (before-publish (str root) state))
         (when (and witness (not= current ((:read! witness))))
           (fail! :witness-changed "trusted witness changed before root publication"))
         (let [result (if witness
                        (try (publish! root (inc (:generation current)) snapshot (wal/append log op payload))
                             (catch Exception e
                               (throw (ex-info "root publication outcome requires review"
                                               {:type :witness-commit-uncertain} e))))
                        (publish! root (inc (:generation current)) snapshot (wal/append log op payload)))]
           (if-not witness result
             (try
               (let [{next-root :root next-state :state} (writable-state root)]
                 (when-not (= (:generation result) (:generation next-root))
                   (fail! :local-root-changed "published root changed during witness update"))
                 (when after-publish (after-publish (str root) next-state))
                 (observe! :before-cas :witness)
                 (when-not (true? ((:compare-and-set! witness) current next-root))
                   (fail! :witness-cas-refused "witness CAS refused"))
                 (observe! :after-cas :witness)
                 (when-not (= next-root ((:read! witness)))
                   (fail! :witness-readback-mismatch "witness did not confirm published root"))
                 result)
               (catch Exception e
                 (throw (ex-info "local root published; witness outcome requires review"
                                 {:type :witness-commit-uncertain} e))))))))))

(defn transact!
  "Commit metadata. Optional before-publish runs under the writer lock with
  [directory committed-state], before WAL/root publication; an exception
  leaves metadata unchanged. It is a trusted hosted adapter hook, not consent."
  ([directory op payload] (transact! directory op payload nil))
  ([directory op payload before-publish]
   (transact* directory op payload before-publish nil nil nil)))

(defn transact-if-generation!
  "Commit only if EXPECTED-GENERATION is still the committed store generation.
  The check and callback run under the same local OS file lock. This is not a
  distributed fencing or multi-node consensus guarantee."
  [directory expected-generation op payload before-publish]
  (when-not (and (sequence? expected-generation) (pos? expected-generation))
    (fail! :invalid-generation "expected a positive bounded store generation"))
  (transact* directory op payload before-publish expected-generation nil nil))

(defn transact-if-generation-witnessed!
  "Conditional local commit followed by trusted witness CAS/readback.

  The local root is durable before witness CAS. Once publication begins, an
  exception can leave either commit state; guarded reads must fail closed and
  the host must reconcile using independent evidence, never blindly retry.
  The optional trusted after-publish verifier runs under the same local lock
  before CAS, against the published state. It does not prevent later damage."
  ([directory expected-generation op payload before-publish witness]
   (transact-if-generation-witnessed! directory expected-generation op payload before-publish witness nil))
  ([directory expected-generation op payload before-publish witness after-publish]
  (when-not (and (sequence? expected-generation) (pos? expected-generation))
    (fail! :invalid-generation "expected a positive bounded store generation"))
  (validate-write-witness! witness)
  (when-not (or (nil? after-publish) (fn? after-publish))
    (fail! :invalid-operation "after-publish verifier must be a function"))
  (transact* directory op payload before-publish expected-generation witness after-publish)))

(defn compare-and-set-value!
  "Compare and publish a metadata value under the local writer lock. A
  mismatch changes no WAL/root. The optional trusted check runs under that
  lock only after a match and before publication. I/O failure may be ambiguous."
  ([directory key expected next] (compare-and-set-value! directory key expected next nil))
  ([directory key expected next before-publish]
   (when-not (and (string? key) (or (nil? expected) (string? expected)) (string? next)
                  (or (nil? before-publish) (fn? before-publish)))
     (fail! :invalid-operation "invalid CAS arguments"))
   (let [root (root-path directory)]
     (with-writer root
       #(let [{:keys [snapshot log state] current :root} (writable-state root)
              old (get state key)]
          (if (not= expected old)
            {:published? false :current old :version (:generation current)}
            (do
              (when (= 9007199254740991 (:seq log))
                (fail! :sequence-exhausted "WAL sequence exhausted"))
              (when before-publish (before-publish (str root) state))
              (let [published (publish! root (inc (:generation current)) snapshot
                                        (wal/append log :put {:key key :value next}))]
                {:published? true :current next :version (:generation published)}))))))))

(defn checkpoint!
  ([directory] (checkpoint! directory nil))
  ([directory before-publish]
   (let [root (root-path directory)]
     (with-writer root
       #(let [{:keys [state log] current :root} (writable-state root)
              n (:seq log)]
          (when before-publish (before-publish (str root) state))
          (publish! root (inc (:generation current)) {:seq n :state state}
                    {:seq n :checkpoint n :frames []}))))))

(defn -main [& args]
  (let [[command directory key value] args]
    (prn
      (case [command (count args)]
        ["init" 2] (init! directory)
        ["read" 2] (read-store directory)
        ["put" 4] (transact! directory :put {:key key :value value})
        ["delete" 3] (transact! directory :delete {:key key})
        ["checkpoint" 2] (checkpoint! directory)
        (fail! :usage "usage: otehon-storage init|read|checkpoint DIR; put DIR KEY VALUE; delete DIR KEY")))))
