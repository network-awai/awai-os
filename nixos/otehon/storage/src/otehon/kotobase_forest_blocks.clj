(ns otehon.kotobase-forest-blocks
  "Bounded hosted Kotobase immutable-block port over Forest archive groups."
  (:require [clojure.string :as str] [kotobase.storage.core :as contract]
            [otehon.storage :as store] [otehon.ipld-forest :as catalog]
            [otehon.forest-writer :as writer] [otehon.kotobase-ref :as refs]
            [otehon.root-witness :as witness] [otehon.pack-store :as pack])
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
(defn- verify-root-value! [verify-root! dir state]
  (when-not (true? (verify-root! dir state)) (fail! :closure-rejected "root verifier refused")))
(defn- guarded-snapshot [dir witness-port verify-root!]
  (:snapshot (witness/open-verified! dir witness-port
               #(let [s (snapshot dir)]
                  (verify-root-value! verify-root! dir (:state s))
                  {:basis (:root s) :snapshot s}))))
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
(defn- put-batch!
  ([dir staging-root tool blocks] (put-batch! dir staging-root tool blocks nil nil))
  ([dir staging-root tool blocks witness-port verify-root!]
  (let [name (batch-name blocks)]
    (loop [attempt 0]
      (let [{:keys [state root]} (if witness-port (guarded-snapshot dir witness-port verify-root!) (snapshot dir))
            group-key (str "awai.ipld-forest-group/" name)]
        (if (contains? state group-key)
          (if witness-port
            (:verified (witness/open-verified! dir witness-port
                         #(let [s (snapshot dir) h (catalog/recover-group dir name)]
                            (when-not (= (:root s) (:basis h)) (fail! :catalog-changed "root changed during batch check"))
                            (verify-root-value! verify-root! dir (:state s))
                            (verify-batch h blocks) {:basis (:basis h) :verified true})))
            (verify-batch (catalog/recover-group dir name) blocks))
          (let [stage (stage-path staging-root)
                result (try
                         (if witness-port
                           (writer/put-ipld-blocks! dir name (:cid (first blocks)) blocks stage tool (:generation root) witness-port verify-root!)
                           (writer/put-ipld-blocks! dir name (:cid (first blocks)) blocks stage tool (:generation root)))
                         :published
                         (catch Exception e
                           (if (contains? #{:writer-busy :stale-generation} (:type (ex-data e))) :retry (throw e))))]
            (if (= :published result)
              true
              (if (< attempt 15) (do (Thread/sleep 10) (recur (inc attempt)))
                (fail! :writer-busy "conditional Forest publish did not converge"))))))))))
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
(defn- fetch-state [dir cache state cids]
  (let [wanted (set cids)]
    (loop [names (seq (group-names state)) missing wanted found {}]
      (if (or (empty? missing) (nil? names)) found
        (let [h (snapshot-group dir cache state (first names))
              hits (into {} (keep (fn [cid] (when-let [bytes (catalog/get-group-block h cid)] [cid bytes]))) missing)]
          (recur (next names) (reduce disj missing (keys hits)) (merge found hits)))))))
(defn- validate-cids! [cids]
  (when-not (and (vector? cids) (<= (count cids) max-batch-count))
    (fail! :invalid-cid "expected bounded CID vector"))
  (doseq [cid cids] (catalog/cid-bytes cid)))
(defn- fetch [dir cache cids]
  (validate-cids! cids)
  (fetch-state dir cache (:state (snapshot dir)) cids))
(defn- witnessed-fetch [dir cache cids witness-port verify-root!]
  (validate-cids! cids)
  (:blocks (witness/open-verified! dir witness-port
             #(let [s (snapshot dir)]
                (verify-root-value! verify-root! dir (:state s))
                {:basis (:root s) :blocks (fetch-state dir cache (:state s) cids)}))))
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
(defn open-witnessed-block-store
  "Explicit witnessed block port only. No ref CAS or query authorization is
  provided. The host must supply a trusted independent prepared witness and
  ensure every writer of this store follows the same protocol. A supplied
  verifier is a trust boundary and must validate every root namespace."
  ([dir staging-root tool witness-port]
   (open-witnessed-block-store dir staging-root tool witness-port pack/verify-supported-catalog!))
  ([dir staging-root tool witness-port verify-root!]
  (store/validate-write-witness! witness-port)
  (when-not (and (:status! witness-port) (fn? verify-root!)) (fail! :invalid-witness "prepared witness and root verifier required"))
  (let [cache (atom {})]
    (reify
      contract/IBlockStore
      (-put-blocks! [_ blocks]
        (let [{:keys [ordered unique]} (checked-blocks blocks)]
          (if (seq unique) (put-batch! dir staging-root tool unique witness-port verify-root!)
              (guarded-snapshot dir witness-port verify-root!))
          (mapv :cid ordered)))
      (-get-blocks [_ cids] (witnessed-fetch dir cache cids witness-port verify-root!))
      contract/IBackendCapabilities
      (-capabilities [_] #{:immutable-blocks :cid-addressed-read :packed-blocks :range-read :batch-get :batch-put})))))
(defn- compose-backend [dir staging-root tool verify-closure!]
  (let [blocks (open-block-store dir staging-root tool)
        get-block #(contract/get-block blocks %)
        verify! (fn [cid]
                  (when-not (get-block cid)
                    (fail! :missing-ref-target "ref target block is not published"))
                  (when (and verify-closure! (not (true? (verify-closure! get-block cid))))
                    (fail! :closure-rejected "closure verifier did not approve")))]
    (contract/compose {:blocks blocks :refs (refs/open-ref-store dir verify!)})))

(defn open-backend
  "Compose local Forest block and ref ports. The three-argument form checks
  only the target block. The four-argument form additionally requires a trusted
  closure verifier `(fn [get-block root-cid])` returning literal true. It runs
  under the local writer lock before ref publication; exceptions reject. The
  caller owns the verifier's codec, bounds and security semantics."
  ([dir staging-root tool] (compose-backend dir staging-root tool nil))
  ([dir staging-root tool verify-closure!]
   (when-not (fn? verify-closure!)
     (fail! :invalid-closure-verifier "closure verifier must be a function"))
   (compose-backend dir staging-root tool verify-closure!)))

(defn open-transaction
  "Create a bounded, synchronous write overlay for a Prolly operation.

  :put! and :get-fn are volatile execution ports, not IBlockStore durability
  acknowledgements. :publish! first persists the whole checked batch, then
  performs backend ref CAS; its four-argument form invokes a caller-supplied
  semantic verifier `(fn [get-block next-cid])` after persistence and before
  CAS, requiring literal true. It is not atomic with concurrent GC.
  :abort! discards only the in-memory overlay.
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
     :publish! (fn publish!
                 ([name expected next] (publish! name expected next (fn [_ _] true)))
                 ([name expected next verify!]
                 (locking guard
                   (require-open!)
                   (swap! state assoc :phase :publishing)
                   (try
                     (let [_ (when-not (fn? verify!) (fail! :invalid-closure-verifier "semantic verifier must be a function"))
                           m (:blocks @state) batch (mapv m (sort (keys m)))
                           expected-cids (mapv :cid batch)
                           acknowledged (contract/-put-blocks! backend batch)]
                       (when-not (= expected-cids acknowledged)
                         (fail! :invalid-block-ack "block provider returned unexpected acknowledgement"))
                       (when-not (true? (verify! #(contract/get-block backend %) next))
                         (fail! :closure-rejected "semantic verifier refused publication"))
                       (let [result (contract/-compare-and-set-ref! backend name expected next)]
                         (when-not (and (map? result) (boolean? (:published? result))
                                        (if (:published? result) (= next (:current result)) true))
                           (fail! :invalid-ref-ack "ref provider returned invalid acknowledgement"))
                         (reset! state {:phase :finished :bytes 0 :blocks {}})
                         result))
                     (catch Exception e
                       (reset! state {:phase :failed :bytes 0 :blocks {}})
                       (throw e))))))
     :abort! (fn []
               (locking guard
                 (require-open!)
                 (reset! state {:phase :aborted :bytes 0 :blocks {}})
                 true))}))

(defn publish-scoped!
  "Run a synchronous, trusted builder with a private volatile backend.

  BUILD! returns exactly {:target CID :value value}. Its block acknowledgements
  are provisional and must not be exposed as durable. Internal CAS is refused.
  VERIFY! runs on persisted blocks before the ref CAS and must return true.
  Only after a successful CAS does this function return :value. A stale CAS,
  builder failure or verifier failure throws; immutable orphans can remain.
  The scoped backend becomes unusable on exit. The caller must ensure BUILD!
  has no externally visible side effects and does not treat provisional
  acknowledgements as durability. This is not atomic with concurrent GC."
  [backend ref-name expected build! verify!]
  (when-not (and (fn? build!) (fn? verify!))
    (fail! :invalid-builder "builder and semantic verifier must be functions"))
  (let [tx (open-transaction backend) gate (Object.) active (atom true)
        require-active! #(when-not @active (fail! :transaction-closed "scoped transaction is closed"))
        scoped (reify
                 contract/IBlockStore
                 (-put-blocks! [_ items]
                   (locking gate (require-active!)
                     (when-not (and (vector? items) (<= (count items) max-batch-count))
                       (fail! :invalid-ipld-block "expected bounded block vector"))
                     (mapv (fn [{:keys [cid bytes] :as item}]
                             (when-not (= #{:cid :bytes} (set (keys item)))
                               (fail! :invalid-ipld-block "invalid block record"))
                             ((:put! tx) cid bytes)) items)))
                 (-get-blocks [_ cids]
                   (locking gate (require-active!)
                     (validate-cids! cids)
                     (into {} (keep (fn [cid] (when-let [v ((:get-fn tx) cid)] [cid v]))) cids)))
                 contract/IRefStore
                 (-read-ref [_ name] (locking gate (require-active!) (contract/-read-ref backend name)))
                 (-compare-and-set-ref! [_ _ _ _] (fail! :staged-cas-forbidden "staged ref CAS is forbidden"))
                 contract/IBackendCapabilities
                 (-capabilities [_] #{:immutable-blocks :cid-addressed-read :conditional-ref :single-writer-ref}))]
    (locking gate
      (try
        (let [result (build! scoped)]
          (when-not (and (map? result) (= #{:target :value} (set (keys result))))
            (fail! :invalid-builder-result "builder must return target and value"))
          (validate-cids! [(:target result)])
          (let [ack ((:publish! tx) ref-name expected (:target result) verify!)]
            (when-not (:published? ack) (fail! :stale-ref "ref changed before publication"))
            (:value result)))
        (catch Exception e
          (try ((:abort! tx)) (catch Exception _ nil))
          (throw e))
        (finally (reset! active false))))))

(defn- witnessed-root-verifier [verify-closure!]
  (when-not (fn? verify-closure!) (fail! :invalid-closure-verifier "trusted closure verifier required"))
  (fn [dir state]
    (let [cache (atom {})
          get-block (fn [cid] (validate-cids! [cid]) (get (fetch-state dir cache state [cid]) cid))]
      (pack/verify-supported-catalog!
        dir state
        (fn [_ _ name cid]
          (when-not (and (string? name) (<= 1 (count name) 1024))
            (fail! :invalid-ref-name "invalid witnessed ref name"))
          (validate-cids! [cid])
          (when-not (get-block cid) (fail! :missing-ref-target "witnessed ref target is missing"))
          (when-not (true? (verify-closure! get-block cid))
            (fail! :closure-rejected "witnessed ref closure was not approved"))
          true)))))

(defn open-witnessed-backend
  "Explicit hosted block/ref backend. VERIFY-CLOSURE! is a trusted, bounded
  `(fn [get-block cid])` validator and must return true for every ref. It does
  not supply signature, authority, fencing or database anti-rollback trust."
  [dir staging-root tool witness-port verify-closure!]
  (let [verify-root! (witnessed-root-verifier verify-closure!)
        blocks (open-witnessed-block-store dir staging-root tool witness-port verify-root!)
        refs (refs/open-witnessed-ref-store dir witness-port verify-root!)]
    (contract/compose {:blocks blocks :refs refs})))

(defn reconcile-witnessed-backend!
  "Reconcile only after the mandatory trusted closure verifier approves all
  refs as well as the complete supported Pack/IPLD catalog."
  [dir witness-port verify-closure!]
  (store/reconcile-witnessed! dir witness-port (witnessed-root-verifier verify-closure!)))
