(ns otehon.kotobase-forest-blocks
  "Bounded hosted Kotobase immutable-block port over Forest archive groups."
  (:require [clojure.string :as str] [kotobase.storage.core :as contract]
            [otehon.storage :as store] [otehon.ipld-forest :as catalog]
            [otehon.forest-writer :as writer] [otehon.kotobase-ref :as refs])
  (:import [java.nio.file Files Paths LinkOption] [java.nio.file.attribute FileAttribute PosixFilePermissions]
           [java.security MessageDigest] [java.util Arrays HexFormat]))

(def ^:private name-prefix "kotobase-blocks/")
(def ^:private state-prefix (str "awai.ipld-forest-group/" name-prefix))
(def ^:private max-block-bytes (* 850 1024))
(def ^:private max-batch-bytes (* 32 1024 1024))
(def ^:private max-batch-count (* 64 64))
(defn- fail! [type message] (throw (ex-info message {:type type})))
(defn- owned-bytes [x]
  (cond
    (bytes? x) (do (when (> (alength ^bytes x) max-block-bytes) (fail! :too-large "block too large")) (aclone ^bytes x))
    (vector? x) (do (when (or (> (count x) max-block-bytes)
                              (not (every? #(and (integer? %) (<= 0 % 255)) x)))
                      (fail! :invalid-ipld-block "invalid bounded byte vector"))
                    (byte-array (map unchecked-byte x)))
    :else (fail! :invalid-ipld-block "expected bytes or byte vector")))
(defn- checked-blocks [blocks]
  (when-not (and (vector? blocks) (<= (count blocks) max-batch-count))
    (fail! :invalid-ipld-block "expected bounded block vector"))
  ;; Check aggregate sizes before cloning any caller buffers.
  (let [sizes (mapv (fn [x]
                      (when-not (and (map? x) (= #{:cid :bytes} (set (keys x))))
                        (fail! :invalid-ipld-block "invalid block record"))
                      (let [v (:bytes x) n (cond (bytes? v) (alength ^bytes v)
                                                (vector? v) (count v)
                                                :else (fail! :invalid-ipld-block "expected bytes or byte vector"))]
                        (when (> n max-block-bytes) (fail! :too-large "block too large")) n)) blocks)
        _ (when (> (reduce + 0 sizes) max-batch-bytes) (fail! :too-large "batch exceeds 32 MiB"))
        xs (mapv (fn [x] (select-keys (writer/validate-ipld-block (update x :bytes owned-bytes)) [:cid :bytes])) blocks)]
    (let [by-cid (reduce (fn [m {:keys [cid bytes] :as b}]
                           (if-let [old (get m cid)]
                             (if (Arrays/equals ^bytes (:bytes old) ^bytes bytes) m
                               (fail! :cid-collision "duplicate CID with differing bytes"))
                             (assoc m cid b))) {} xs)]
      {:ordered xs :unique (mapv by-cid (sort (keys by-cid)))})))
(defn- batch-name [blocks]
  (let [bytes (.getBytes (pr-str (mapv :cid blocks)) "UTF-8")
        hash (.digest (MessageDigest/getInstance "SHA-256") bytes)]
    (str name-prefix (.formatHex (HexFormat/of) hash))))
(defn- snapshot [dir]
  (let [s (store/read-store dir)]
    (when (:degraded? s) (fail! :degraded-store "cannot use a degraded store"))
    s))
(defn- group-names [state]
  (->> (keys state) (filter #(str/starts-with? % state-prefix))
       (map #(subs % (count "awai.ipld-forest-group/"))) sort vec))
(defn- verify-batch [handle blocks]
  (doseq [{:keys [cid bytes]} blocks]
    (let [got (catalog/get-group-block handle cid)]
      (when-not (and got (Arrays/equals ^bytes bytes ^bytes got))
        (fail! :cid-collision "published batch differs from caller bytes"))))
  true)
(defn- stage-path [root]
  (let [p (.normalize (.toAbsolutePath (Paths/get root (make-array String 0))))]
    (when-not (and (Files/isDirectory p (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
                   (= p (.toRealPath p (make-array LinkOption 0))))
      (fail! :invalid-staging-root "staging root must be a real existing directory"))
    (str (.resolve (Files/createTempDirectory p "kotobase-batch-"
                       (into-array FileAttribute [(PosixFilePermissions/asFileAttribute
                                                   (PosixFilePermissions/fromString "rwx------"))])) "stage"))))
(defn- put-batch! [dir staging-root tool blocks]
  (let [name (batch-name blocks)]
    (loop [attempt 0]
      (let [{:keys [state root]} (snapshot dir)
            group-key (str "awai.ipld-forest-group/" name)]
        (if (contains? state group-key)
          (verify-batch (catalog/recover-group dir name) blocks)
          (let [stage (stage-path staging-root)
                result (try
                         (writer/put-ipld-blocks! dir name (:cid (first blocks)) blocks stage tool (:generation root))
                         :published
                         (catch Exception e
                           (if (contains? #{:writer-busy :stale-generation} (:type (ex-data e))) :retry (throw e))))]
            (if (= :published result)
              true
              (if (< attempt 15) (do (Thread/sleep 10) (recur (inc attempt)))
                (fail! :writer-busy "conditional Forest publish did not converge")))))))))
(defn- snapshot-group [dir cache state name]
  (let [text (get state (str "awai.ipld-forest-group/" name))
        cached (get @cache name)]
    (if (= text (:text cached))
      (:handle cached)
      (let [h (catalog/recover-group dir name)]
        ;; The group may have changed between the metadata snapshot and open.
        ;; Never cache or return a handle for a different catalog version.
        (when-not (= text (pr-str (:group h)))
          (fail! :catalog-changed "group changed during open"))
        (swap! cache (fn [m]
                       (let [m (assoc m name {:text text :handle h})]
                         (if (> (count m) 64)
                           (dissoc m (first (sort (remove #{name} (keys m)))))
                           m))))
        h))))
(defn- fetch [dir cache cids]
  (when-not (and (vector? cids) (<= (count cids) max-batch-count))
    (fail! :invalid-cid "expected bounded CID vector"))
  (doseq [cid cids] (catalog/cid-bytes cid))
  (let [{:keys [state]} (snapshot dir) wanted (set cids)]
    (loop [names (seq (group-names state)) missing wanted found {}]
      (if (or (empty? missing) (nil? names)) found
        (let [h (snapshot-group dir cache state (first names))
              hits (into {} (keep (fn [cid] (when-let [bytes (catalog/get-group-block h cid)] [cid bytes]))) missing)]
          (recur (next names) (reduce disj missing (keys hits)) (merge found hits)))))))
(defn open-block-store
  "Persist each bounded batch as an immutable Forest group; staging is retained.
  Lookup scans batch groups; a bounded cache retains at most 64 verified group
  handles keyed by the committed catalog. No GC or distributed fencing exists."
  [dir staging-root tool]
  (let [cache (atom {})]
   (reify
    contract/IBlockStore
    (-put-blocks! [_ blocks]
      (let [{:keys [ordered unique]} (checked-blocks blocks)]
        (when (seq unique) (put-batch! dir staging-root tool unique))
        (mapv :cid ordered)))
    (-get-blocks [_ cids] (fetch dir cache cids))
    contract/IBackendCapabilities
    (-capabilities [_] #{:immutable-blocks :cid-addressed-read :packed-blocks :range-read :batch-get :batch-put}))))
(defn open-backend
  "Compose the local Forest block and ref ports. Ref CAS verifies its target
  exists under the same writer lock; it does not validate the target's closure."
  [dir staging-root tool]
  (let [blocks (open-block-store dir staging-root tool)
        verify! (fn [cid] (when-not (contract/get-block blocks cid)
                            (fail! :missing-ref-target "ref target block is not published")))]
    (contract/compose {:blocks blocks :refs (refs/open-ref-store dir verify!)})))

(defn open-transaction
  "Create a bounded, synchronous write overlay for a Prolly operation.

  :put! and :get-fn are volatile execution ports, not IBlockStore durability
  acknowledgements. :publish! first persists the whole checked batch, then
  performs backend ref CAS; :abort! discards only the in-memory overlay.
  A failed or stale publish is terminal and can leave immutable orphan data.
  Only a successful :publish! confirms that the ref advanced."
  [backend]
  (contract/validate-backend! backend)
  (let [guard (Object.) state (atom {:phase :open :bytes 0 :blocks {}})
        require-open! (fn [] (when-not (= :open (:phase @state))
                               (fail! :transaction-closed "transaction is not open")))]
    {:put! (fn [cid bytes]
             (locking guard
               (require-open!)
               (try
                 (let [b (first (:unique (checked-blocks [{:cid cid :bytes bytes}])))
                       n (alength ^bytes (:bytes b)) old (get-in @state [:blocks cid])]
                   (if old
                     (when-not (Arrays/equals ^bytes (:bytes old) ^bytes (:bytes b))
                       (fail! :cid-collision "duplicate CID differs"))
                     (do
                       (when (or (>= (count (:blocks @state)) max-batch-count)
                                 (> (+ (:bytes @state) n) max-batch-bytes))
                         (fail! :too-large "transaction buffer exceeds bound"))
                       (swap! state #(-> % (update :bytes + n) (assoc-in [:blocks cid] b)))))
                   cid)
                 (catch Exception e
                   (reset! state {:phase :failed :bytes 0 :blocks {}})
                   (throw e)))))
     :get-fn (fn [cid]
               (locking guard
                 (require-open!)
                 (try
                   (if-let [b (get-in @state [:blocks cid])]
                     (aclone ^bytes (:bytes b))
                     (contract/get-block backend cid))
                   (catch Exception e
                     (reset! state {:phase :failed :bytes 0 :blocks {}})
                     (throw e)))))
     :publish! (fn [name expected next]
                 (locking guard
                   (require-open!)
                   (swap! state assoc :phase :publishing)
                   (try
                     (let [m (:blocks @state) batch (mapv m (sort (keys m)))
                           expected-cids (mapv :cid batch)
                           acknowledged (contract/-put-blocks! backend batch)]
                       (when-not (= expected-cids acknowledged)
                         (fail! :invalid-block-ack "block provider returned unexpected acknowledgement"))
                       (let [result (contract/-compare-and-set-ref! backend name expected next)]
                         (when-not (and (map? result) (boolean? (:published? result))
                                        (if (:published? result) (= next (:current result)) true))
                           (fail! :invalid-ref-ack "ref provider returned invalid acknowledgement"))
                         (reset! state {:phase :finished :bytes 0 :blocks {}})
                         result))
                     (catch Exception e
                       (reset! state {:phase :failed :bytes 0 :blocks {}})
                       (throw e)))))
     :abort! (fn []
               (locking guard
                 (require-open!)
                 (reset! state {:phase :aborted :bytes 0 :blocks {}})
                 true))}))
