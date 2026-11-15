(ns awai.fs.tier
  "Tiered persistence planning: B2-backed durability, on-demand fetch,
  local-only eviction, GC, and repack.

  Pure planning only. Packs are the unit of transfer and durability; a
  sealed pack maps 1:1 to one B2 object, so every action below names an
  object key and byte ranges a worker can execute concurrently. Wire I/O,
  multipart choice, and auth stay in the node adapter — this namespace
  only decides what must move, what may be dropped, and what must be
  re-fetched.

  Deletion is split on purpose. `delete-local` drops bytes that remain
  re-fetchable from B2 (the Drive-style on-demand model). `delete-remote`
  drops the durable copy and is only ever proposed for packs with no live
  entry; retention holds are expressed by keeping entries in the live
  set, never by a second flag the planner could misread."
  (:require [awai.fs.large-file :as lf]
            [awai.fs.media-layout :as ml]))

(def ^:const default-repack-threshold
  "Packs livelier than this are left alone; sparser packs are repack
  candidates. 0.5 mirrors the Iceberg/Delta rewrite band."
  0.5)

(def ^:const physical-codecs
  "Physical (post-CID) pack codecs. Physical compression must decompress
  to the exact CID-verified bytes, so it never changes identity. Logical
  (pre-CID) compression changes CIDs and stays out of this planner."
  #{:none :zstd :snappy})

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn pack-object-key
  "B2 object key for sealed pack `i`."
  [i]
  (when (or (not (integer? i)) (neg? i))
    (fail! :awai.fs/invalid-pack-index "awai fs: pack index must be non-negative"
           {:pack i}))
  (str "packs/pack-" i ".car"))

(defn manifest-object-key
  "B2 object key for a named manifest snapshot."
  [snapshot-name]
  (when (or (not (string? snapshot-name)) (empty? snapshot-name))
    (fail! :awai.fs/invalid-snapshot "awai fs: snapshot name must be non-empty"
           {:snapshot snapshot-name}))
  (str "manifests/" snapshot-name ".json"))

(defn advance-next-pack
  "Next free pack index after sealing pack `n`. A non-integer `cur`
  (a corrupt :nextPack from an older writer) counts as 0, so one bad
  value can neither reuse a live index nor poison the next update."
  [cur n]
  (max (if (integer? cur) cur 0) n))

(defn ingest-plan
  "Split fresh `chunks` (each with :index :offset :length :sha) against the
  volume chunk index `known` (sha -> {:pack :pack-offset :length}).

  Returns {:reuse :fresh}: :reuse entries keep their file coordinates and
  carry the sealed pack assignment they point at; :fresh chunks still need
  `pack-plan`. A known sha whose pack is gone from `live-packs` (GC'd
  after its last referrer went away) counts as fresh, so a read never
  points at deleted bytes. Identical bytes never seal a second pack."
  [known live-packs chunks]
  (let [live (set live-packs)]
    (reduce (fn [acc c]
              (let [hit (get known (:sha c))]
                (if (and hit (contains? live (:pack hit)))
                  (update acc :reuse conj {:index (:index c)
                                           :offset (:offset c)
                                           :length (:length c)
                                           :sha (:sha c)
                                           :pack (:pack hit)
                                           :pack-offset (:pack-offset hit)})
                  (update acc :fresh conj c))))
            {:reuse [] :fresh []}
            chunks)))

(defn upload-plan
  "Upload actions for everything the remote object set lacks: one manifest
  snapshot plus one action per missing sealed pack. Per-pack actions are
  independent — workers run them concurrently."
  [manifest remote-objects snapshot-name]
  (let [remote (set remote-objects)
        packs (:packs manifest)
        missing (into []
                      (comp (filter (fn [p]
                                      (not (contains? remote
                                                      (pack-object-key
                                                       (:pack-index p))))))
                            (map (fn [p]
                                   {:action :upload
                                    :kind :pack
                                    :pack (:pack-index p)
                                    :object (pack-object-key (:pack-index p))
                                    :bytes (:bytes p)})))
                      packs)]
    {:snapshot snapshot-name
     :manifest {:action :upload
                :kind :manifest
                :object (manifest-object-key snapshot-name)
                :entries (:chunk-count manifest)
                :packs (:pack-count manifest)}
     :packs missing}))

(defn demand-plan
  "On-demand fetch for the byte range [offset, offset+length): entries the
  hot cache already holds become :read-cache actions, the rest become
  :fetch-remote actions naming the B2 object and pack range. Nothing
  outside the range is touched.

  Refuses when the range leaves the file (same rule as range reads) and
  fails closed when a needed pack has no remote object."
  [index cache offset length remote-objects]
  (let [remote (set remote-objects)
        reads (lf/range-chunks-indexed index offset length)]
    {:offset offset
     :length length
     :actions
     (mapv (fn [e]
             (let [chunk-key [:chunk (:index e)]]
               (cond-> (if (contains? (:store cache) chunk-key)
                 {:action :read-cache
                  :chunk (:index e)
                  :offset (:offset e)
                  :read-offset (:read-offset e)
                  :read-length (:read-length e)}
                 (let [object (pack-object-key (:pack e))]
                   (when-not (contains? remote object)
                     (fail! :awai.fs/not-durable
                            "awai fs: pack has no remote copy to fetch"
                            {:pack (:pack e) :object object}))
                   {:action :fetch-remote
                    :chunk (:index e)
                    :pack (:pack e)
                    :object object
                    :offset (:offset e)
                    :pack-offset (:pack-offset e)
                    :length (:length e)
                    :range (lf/range-header (:pack-offset e) (:length e))
                    :read-offset (:read-offset e)
                    :read-length (:read-length e)}))
                 (:sha e) (assoc :sha (:sha e)))))
           reads)}))

(defn gc-plan
  "Deletion proposal for `manifest` given the live entry indexes (current
  view plus retained snapshots), the locally present pack indexes, and
  the remotely present object keys.

  :delete-local — packs that are dead locally but re-fetchable from B2.
  :delete-remote — dead packs whose durable copy may go. A live pack is
  never proposed; an entry kept in the live set (snapshot, pin,
  retention) protects its whole pack."
  [manifest live-entry-indexes local-packs remote-objects]
  (let [live (set live-entry-indexes)
        local (set local-packs)
        remote (set remote-objects)
        by-pack (group-by :pack (:entries manifest))
        pack-live? (fn [i] (boolean (some live (mapv :index (get by-pack i [])))))
        all-packs (into #{} (concat (keys by-pack) local))]
    {:delete-local (into []
                         (filter (fn [i]
                                   (and (contains? local i)
                                        (not (pack-live? i))
                                        (contains? remote (pack-object-key i)))))
                         (sort all-packs))
     :delete-remote (into []
                          (filter (fn [i]
                                    (and (contains? remote (pack-object-key i))
                                         (not (pack-live? i)))))
                          (sort all-packs))}))

(defn evict-plan
  "Drive-style local-only eviction: packs whose bytes also live on the
  remote may drop their local copy; the manifest keeps every entry, so
  a later fetch restores the bytes. `keep-packs` (hot, pinned, or
  mid-upload packs) are never proposed. Dead packs belong to gc-plan;
  this plan covers live-but-cold bytes and reports what stays."
  [manifest remote-objects keep-packs]
  (let [remote (set remote-objects)
        keep (set keep-packs)
        evictable (into []
                        (filter (fn [p]
                                  (and (contains? remote
                                                  (pack-object-key
                                                   (:pack-index p)))
                                       (not (contains? keep (:pack-index p))))))
                        (sort-by :pack-index (:packs manifest)))]
    {:evict-local (mapv :pack-index evictable)
     :kept (mapv :pack-index
                 (remove (fn [p]
                           (contains? (set (mapv :pack-index evictable))
                                      (:pack-index p)))
                         (sort-by :pack-index (:packs manifest))))}))

(defn remap-manifest
  "Rewrite a manifest's pack assignment from `new-packs`, dropping
  `dropped-pack-indexes`. File coordinates never move; only :pack and
  :pack-offset change. Every *live* entry of a dropped pack must be
  remapped — otherwise fail instead of stranding it. Dead entries of
  dropped packs are left stale for the next snapshot/GC pass."
  [manifest new-packs dropped-pack-indexes live-entry-indexes]
  (let [dropped (set dropped-pack-indexes)
        live (set live-entry-indexes)
        placement (into {}
                        (mapcat (fn [p]
                                  (map (fn [e]
                                         [(:index e)
                                          {:pack (:pack-index p)
                                           :pack-offset (:pack-offset e)}])
                                       (:entries p))))
                        new-packs)
        kept-old (into []
                       (remove (fn [p] (contains? dropped (:pack-index p))))
                       (:packs manifest))
        entries (mapv (fn [e]
                        (if-let [to (get placement (:index e))]
                          (merge e to)
                          (do
                            (when (and (contains? dropped (:pack e))
                                       (contains? live (:index e)))
                              (fail! :awai.fs/orphaned-entry
                                     "awai fs: dropped pack entry was not remapped"
                                     {:index (:index e) :pack (:pack e)}))
                            e)))
                      (:entries manifest))]
    (assoc manifest
           :packs (into kept-old new-packs)
           :pack-count (+ (count kept-old) (count new-packs))
           :entries entries)))

(defn repack-plan
  "Repack sparse packs: packs whose live-byte utilization falls below
  :threshold (default 0.5) have their live entries regrouped by
  `pack-plan`; fully dead packs are GC, not repack, and are listed
  under :gc. Returns the new packs, the per-old-pack move map, the
  remapped manifest (index rebuild is one `offset-index` away), and
  the recorded physical :codec (:none by default). :pack-base overrides
  the fresh pack numbering (defaults to one past the manifest's max),
  for volumes that number packs globally."
  ([manifest live-entry-indexes]
   (repack-plan manifest live-entry-indexes nil))
  ([manifest live-entry-indexes {:keys [pack-target threshold codec pack-base force?]
                                 :or {threshold default-repack-threshold
                                      codec :none}}]
   (when-not (contains? physical-codecs codec)
     (fail! :awai.fs/invalid-codec "awai fs: unknown physical pack codec"
            {:codec codec}))
   (let [live (set live-entry-indexes)
         by-pack (group-by :pack (:entries manifest))
         stats (mapv (fn [p]
                       (let [es (get by-pack (:pack-index p) [])
                             live-es (filterv #(contains? live (:index %)) es)
                             live-bytes (reduce + 0 (mapv :length live-es))]
                         {:pack (:pack-index p)
                          :bytes (:bytes p)
                          :live-bytes live-bytes
                          :utilization (if (pos? (:bytes p))
                                         (/ (double live-bytes) (:bytes p))
                                         0.0)
                          :live-entries live-es}))
                     (:packs manifest))
         dead (mapv :pack (filter #(zero? (:live-bytes %)) stats))
         candidates (filterv (fn [s]
                               (and (pos? (:live-bytes s))
                                    (or force? (< (:utilization s) threshold))))
                             stats)
         regrouped (lf/pack-plan
                    (into [] (mapcat :live-entries)
                          (sort-by :pack candidates))
                    {:pack-target (or pack-target (:pack-target manifest))})
         base (or pack-base
                    (inc (reduce max -1 (mapv :pack-index (:packs manifest)))))
         new-packs (mapv (fn [offset p]
                           (let [fresh (+ base offset)]
                             (-> p
                                 (assoc :pack-index fresh :codec codec)
                                 (update :entries
                                         (fn [es]
                                           (mapv #(assoc % :pack fresh)
                                                 es))))))
                         (range) (:packs regrouped))]
     {:threshold threshold
      :codec codec
      :gc dead
      :candidates (mapv :pack candidates)
      :new-packs new-packs
      :moved (into {} (map (fn [s] [(:pack s)
                                   (mapv :index (:live-entries s))])
                           candidates))
      :manifest (remap-manifest manifest new-packs (mapv :pack candidates) live)})))

(defn repack-plan-for-class
  "Repack sparse packs with the pack-target of media `class`
  (`media-layout/layout-for-class`). Caller `opts` (:threshold, :codec)
  still apply; the media pack-target always wins so a caller cannot
  silently re-seal HDD packs at NVMe sizes. Unknown classes are refused
  by the layout policy instead of guessing."
  ([manifest live-entry-indexes class]
   (repack-plan-for-class manifest live-entry-indexes class nil))
  ([manifest live-entry-indexes class opts]
   (repack-plan manifest live-entry-indexes
                (assoc opts :pack-target
                       (:pack-target (ml/physical-layout-for-class class))))))
