(ns otehon.atomic-forest-stream
  "Bounded hosted staging of generic CID blocks for one local group/ref root."
  (:require [awai.fs.car :as car] [otehon.forest :as forest]
            [otehon.forest-writer :as writer] [otehon.ipld-forest :as catalog]
            [otehon.storage :as store])
  (:import [java.nio ByteBuffer] [java.nio.channels FileChannel]
           [java.nio.file Files Paths OpenOption LinkOption StandardOpenOption CopyOption]
           [java.nio.file.attribute FileAttribute PosixFilePermissions]
           [java.security MessageDigest] [java.util Arrays HexFormat]
           [java.util.concurrent TimeUnit]))

(def ^:private max-total (+ (* 1024 1024 1024) (* 16 1024 1024)))
(def ^:private max-pending (* 17 1024 1024))
(def ^:private max-archive-blocks 32)
(def ^:private max-archives 64)
(def ^:private max-puts 4096)
(defn- fail! [type message] (throw (ex-info message {:type type})))
(defn- bytes-of [xs] (byte-array (map unchecked-byte xs)))
(defn- frame-read [path offset length]
  (when-not (and (integer? offset) (integer? length) (<= 0 offset) (<= 1 length (* 2 1024 1024)))
    (fail! :invalid-forest "invalid frame extent"))
  (with-open [f (FileChannel/open (Paths/get path (make-array String 0))
                                  (into-array OpenOption [StandardOpenOption/READ LinkOption/NOFOLLOW_LINKS]))]
    (let [b (ByteBuffer/allocate (int length))]
      (loop [p offset]
        (when (.hasRemaining b)
          (let [n (.read f b (long p))]
            (when (<= n 0) (fail! :short-read "staged Forest frame shortened"))
            (recur (+ p n)))))
      (.array b))))
(defn- group-name [cids]
  (let [md (MessageDigest/getInstance "SHA-256")]
    (str "kotobase-blocks/" (.formatHex (HexFormat/of) (.digest md (.getBytes (pr-str cids) "UTF-8"))))))
(defn publish!
  "Build bounded provisional blocks, stage Forest files, then publish one group
  and ref. GET-EXISTING! and VERIFY! are trusted host callbacks. The builder
  returns exactly {:target CID :value x}; only a successful conditional root
  update returns x. Input is bounded to 1 GiB + 16 MiB, 4096 put calls, 64
  archives and 32 blocks / 17 MiB per archive. Staging files remain on failure.
  This is local, not witnessed; no concurrent GC, fencing or external-store
  atomicity is provided. The caller must check the full semantic closure."
  [directory staging tool ref-name expected get-existing! build! verify!]
  (when-not (and (every? string? [directory staging tool ref-name]) (seq ref-name)
                 (or (nil? expected) (string? expected))
                 (fn? get-existing!) (fn? build!) (fn? verify!))
    (fail! :invalid-atomic-stream "invalid stream arguments"))
  (when expected (catalog/cid-bytes expected))
  (writer/verify-pinned-tool! tool)
  (let [{:keys [root degraded?]} (store/read-store directory)]
    (when degraded? (fail! :degraded-store "cannot stream into a degraded store"))
    (Files/createDirectory (Paths/get staging (make-array String 0))
      (into-array FileAttribute [(PosixFilePermissions/asFileAttribute (PosixFilePermissions/fromString "rwx------"))]))
    (let [staged-tool (str staging "/forest-tool")
          _ (with-open [in (Files/newInputStream (Paths/get tool (make-array String 0))
                                                (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
              (Files/copy in (Paths/get staged-tool (make-array String 0)) (make-array CopyOption 0)))
          _ (writer/verify-pinned-tool! staged-tool)
          _ (Files/setPosixFilePermissions (Paths/get staged-tool (make-array String 0)) (PosixFilePermissions/fromString "r-x------"))
          gate (Object.) state (atom {:phase :open :puts 0 :total 0 :pending [] :pending-bytes 0 :seen #{} :cids [] :archives []})
          require-open! #(when-not (= :open (:phase @state)) (fail! :transaction-closed "atomic stream is closed"))
          flush! (fn []
                   (let [{:keys [pending archives]} @state]
                     (when (seq pending)
                       (when (>= (count archives) max-archives) (fail! :too-large "archive count exceeds bound"))
                       (let [i (count archives) carpath (str staging "/" i ".car") path (str staging "/" i ".forest")
                             root-cid (:cid (first pending)) root-bytes (:cid-bytes (first pending))
                             header (bytes-of (car/carv1-encode {:roots [root-bytes] :blocks []}))]
                         (with-open [out (Files/newOutputStream (Paths/get carpath (make-array String 0))
                                           (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
                           (.write out ^bytes header)
                           (doseq [{:keys [cid-bytes bytes]} pending]
                             (.write out ^bytes (bytes-of (car/encode-uvarint (+ (count cid-bytes) (alength ^bytes bytes)))))
                             (.write out ^bytes (bytes-of cid-bytes))
                             (.write out ^bytes bytes)))
                         (let [p (.start (doto (ProcessBuilder. ^java.util.List [staged-tool "snapshot" "compress" carpath "--output-path" path "--frame-size" "1"])
                                           (.redirectErrorStream true) (.redirectOutput (java.io.File. (str staging "/" i ".log")))))]
                           (when-not (.waitFor p 120 TimeUnit/SECONDS) (.destroyForcibly p) (fail! :forest-timeout "Forest compression timed out"))
                           (when-not (zero? (.exitValue p)) (fail! :forest-failed "Forest compression failed")))
                         (let [h (forest/verify-generic-file path)]
                           (when-not (and (= [root-bytes] (:roots h)) (= (mapv :cid-bytes pending) (:cids h)))
                             (fail! :forest-content-mismatch "staged archive differs from input"))
                           (swap! state #(-> % (assoc :pending [] :pending-bytes 0)
                                             (update :archives conj {:path path :root-cid root-cid :handle h}))))))))
          get-staged (fn [cid]
                       (some (fn [{:keys [path handle]}]
                               (when (some #{(catalog/cid-bytes cid)} (:cids handle))
                                 (forest/get-block-from handle (catalog/cid-bytes cid) #(frame-read path %1 %2))))
                             (:archives @state)))
          get-checked-existing (fn [cid]
                                 (if-some [bytes (get-existing! cid)]
                                   (:bytes (writer/validate-ipld-block {:cid cid :bytes bytes}))
                                   nil))
          ports {:put! (fn [cid bytes]
                         (locking gate
                           (require-open!)
                           (try
                             (let [block (writer/validate-ipld-block {:cid cid :bytes bytes}) n (alength ^bytes (:bytes block))
                                   {:keys [puts total seen pending pending-bytes]} @state]
                               (when (or (>= puts max-puts) (> (+ total n) max-total)) (fail! :too-large "atomic stream exceeds bounds"))
                               (when (and (not (contains? seen cid)) (seq pending)
                                          (or (>= (count pending) max-archive-blocks) (> (+ pending-bytes n) max-pending))) (flush!))
                               (swap! state (fn [s] (cond-> (-> s (update :puts inc) (update :total + n))
                                                      (not (contains? seen cid)) (-> (update :pending conj block) (update :pending-bytes + n)
                                                                                    (update :seen conj cid) (update :cids conj cid)))))
                               cid)
                             (catch Exception e (swap! state assoc :phase :failed) (throw e)))))
                 :get-fn (fn [cid]
                           (locking gate
                             (require-open!)
                             (try (catalog/cid-bytes cid)
                                  (if-let [b (some #(when (= cid (:cid %)) %) (:pending @state))]
                                    (aclone ^bytes (:bytes b))
                                    (or (get-staged cid) (get-checked-existing cid)))
                                  (catch Exception e (swap! state assoc :phase :failed) (throw e)))))}]
      (locking gate
        (try
          (let [result (build! ports)]
            (require-open!)
            (when-not (and (map? result) (= #{:target :value} (set (keys result))))
              (fail! :invalid-builder-result "builder must return target and value"))
            (catalog/cid-bytes (:target result))
            (flush!)
            (let [{:keys [archives cids]} @state]
              (when (empty? archives) (fail! :invalid-atomic-stream "empty stream"))
              (swap! state assoc :phase :publishing)
              (let [ack (catalog/publish-file-group-and-ref! directory (group-name cids) (first cids)
                          (mapv #(select-keys % [:path :root-cid]) archives) (:generation root)
                          ref-name expected (:target result)
                          (fn [candidate cid]
                            (verify! (fn [requested] (or (candidate requested) (get-checked-existing requested))) cid)))]
                (when-not (:published? ack) (fail! :stale-ref "ref changed before publication"))
                (:value result))))
          (finally (swap! state assoc :phase :closed :pending [] :pending-bytes 0)))))))
