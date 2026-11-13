(ns otehon.ipld-forest
  "Bounded generic IPLD Forest archives over the Otehon WAL/root store.
  Recovery verifies the complete archive; subsequent CID reads use the
  verified snapshot index and revalidate the selected frame and block."
  (:require [clojure.edn :as edn]
            [awai.fs.car :as car]
            [otehon.forest :as forest]
            [otehon.segmented :as segmented]
            [otehon.storage :as store]))

(def ^:private prefix "awai.ipld-forest/")
(defn- fail! [type msg] (throw (ex-info msg {:type type})))
(defn- key-for [name]
  (when-not (and (string? name) (<= 1 (count name) 1024))
    (fail! :invalid-name "archive name must be a nonempty bounded string"))
  (str prefix name))
(defn- cid-bytes [s]
  (when-not (string? s) (fail! :invalid-cid "expected CID string"))
  (car/parse-cid-str s)
  (let [v (car/base32-decode (subs s 1))]
    (when-not (= s (car/cid-str v)) (fail! :invalid-cid "noncanonical CID"))
    v))
(defn- parse-ref [text]
  (with-open [r (java.io.PushbackReader. (java.io.StringReader. text))]
    (let [opts {:eof ::eof :readers {} :default (fn [& _] (fail! :invalid-ipld-forest-ref "unsupported tag"))}
          ref (edn/read opts r)]
      (when-not (and (= ::eof (edn/read opts r)) (map? ref)
                     (= #{:format :archive-sha :archive-size :root-cid} (set (keys ref)))
                     (= :awai.otehon-store/ipld-forest-v1 (:format ref))
                     (string? (:archive-sha ref)) (re-matches #"[0-9a-f]{64}" (:archive-sha ref))
                     (integer? (:archive-size ref)) (<= 64 (:archive-size ref) forest/max-size)
                     (string? (:root-cid ref)))
        (fail! :invalid-ipld-forest-ref "invalid archive reference"))
      (cid-bytes (:root-cid ref))
      ref)))
(defn- verified [bytes root]
  (let [h (forest/open bytes)
        roots (:roots (car/carv1-decode (:carv1 h)))
        root-bytes (cid-bytes root)]
    (when-not (and (= [root-bytes] roots) (forest/get-block h root-bytes))
      (fail! :invalid-ipld-root "CAR root must be present and match declared root"))
    h))

(defn publish!
  "Verify a bounded generic Forest archive and atomically publish its name.
  The archive is persisted and synced under the writer lock before root/WAL."
  [directory name root bytes]
  (key-for name)
  (when-not (bytes? bytes) (fail! :invalid-bytes "expected archive bytes"))
  (let [bytes (aclone ^bytes bytes)
        _ (verified bytes root)
        ref {:format :awai.otehon-store/ipld-forest-v1
             :archive-sha (segmented/sha bytes) :archive-size (alength ^bytes bytes)
             :root-cid root}]
    (store/transact! directory :put {:key (key-for name) :value (pr-str ref)}
                     (fn [dir _]
                       (when-not (= (:archive-sha ref) (store/write-forest! dir bytes))
                         (fail! :changed-payload "archive digest changed"))))
    ref))

(defn recover
  "Open one published snapshot, validating its complete archive and root.
  The handle is immutable and retains no archive-wide byte buffer."
  [directory name]
  (let [{:keys [state root degraded?]} (store/read-store directory)
        value (get state (key-for name))]
    (when-not value (fail! :ipld-forest-not-found "archive is not published"))
    (let [ref (parse-ref value) bytes (store/read-forest directory (:archive-sha ref))]
      (when-not (= (:archive-size ref) (alength ^bytes bytes))
        (fail! :corrupt-forest "archive size differs from published reference"))
      {:directory directory :basis root :degraded? degraded? :ref ref
       :forest (dissoc (verified bytes (:root-cid ref)) :bytes :carv1)})))

(defn get-block
  "Read and verify the selected CID via positioned frame reads. A nil result
  is absence in the fully verified snapshot, not a fresh full-archive scrub."
  [handle cid]
  (let [ref (:ref handle)]
    (forest/get-block-from (:forest handle) (cid-bytes cid)
      (fn [offset length]
        (first (store/read-payload-segments (:directory handle) (:archive-sha ref)
                                           "forest" (:archive-size ref)
                                           [{:offset offset :length length}]))))))

(def ^:private group-prefix "awai.ipld-forest-group/")
(def ^:private max-group-archives 64)
(defn- group-key [name]
  (key-for name)
  (str group-prefix name))
(defn- checked-group [group]
  (when-not (and (map? group) (= #{:format :basis-cid :archives} (set (keys group)))
                 (= :awai.otehon-store/ipld-forest-group-v1 (:format group))
                 (string? (:basis-cid group)) (vector? (:archives group))
                 (<= 1 (count (:archives group)) max-group-archives))
    (fail! :invalid-ipld-forest-group "invalid archive group"))
  (cid-bytes (:basis-cid group))
  (doseq [ref (:archives group)] (parse-ref (pr-str ref)))
  (when-not (= (count (:archives group)) (count (set (map :archive-sha (:archives group)))))
    (fail! :invalid-ipld-forest-group "duplicate archive"))
  group)
(defn- parse-group [text]
  (with-open [r (java.io.PushbackReader. (java.io.StringReader. text))]
    (let [opts {:eof ::eof :readers {} :default (fn [& _] (fail! :invalid-ipld-forest-group "unsupported tag"))}
          group (edn/read opts r)]
      (when-not (= ::eof (edn/read opts r)) (fail! :invalid-ipld-forest-group "trailing group data"))
      (checked-group group))))
(defn- group-has-cid? [opened cid]
  (let [needle (cid-bytes cid)] (boolean (some #(forest/get-block % needle) opened))))

(defn publish-group!
  "Publish an ordered, bounded set of generic Forest archives under one WAL
  transaction. Each entry is {:root-cid string :bytes byte-array}. All bytes,
  roots and the declared basis are verified before any catalog publication."
  [directory name basis archives]
  (group-key name)
  (when-not (and (vector? archives) (<= 1 (count archives) max-group-archives))
    (fail! :invalid-ipld-forest-group "expected 1..64 archives"))
  (let [owned (mapv (fn [{:keys [root-cid bytes] :as entry}]
                      (when-not (and (map? entry) (= #{:root-cid :bytes} (set (keys entry))) (bytes? bytes))
                        (fail! :invalid-ipld-forest-group "invalid archive input"))
                      {:root-cid root-cid :bytes (aclone ^bytes bytes)}) archives)
        opened (mapv #(verified (:bytes %) (:root-cid %)) owned)
        refs (mapv (fn [{:keys [root-cid bytes]}]
                     {:format :awai.otehon-store/ipld-forest-v1 :archive-sha (segmented/sha bytes)
                      :archive-size (alength ^bytes bytes) :root-cid root-cid}) owned)
        group (checked-group {:format :awai.otehon-store/ipld-forest-group-v1
                              :basis-cid basis :archives refs})]
    (when-not (group-has-cid? opened basis)
      (fail! :invalid-ipld-basis "basis block is absent from archive group"))
    (store/transact! directory :put {:key (group-key name) :value (pr-str group)}
                     (fn [dir _]
                       (doseq [[entry ref] (map vector owned refs)]
                         (when-not (= (:archive-sha ref) (store/write-forest! dir (:bytes entry)))
                           (fail! :changed-payload "archive digest changed")))))
    group))

(defn recover-group
  "Fully verify every referenced archive and basis in a committed group."
  [directory name]
  (let [{:keys [state root degraded?]} (store/read-store directory)
        text (get state (group-key name))]
    (when-not text (fail! :ipld-forest-not-found "archive group is not published"))
    (let [group (parse-group text)
          opened (mapv (fn [ref]
                         (let [bytes (store/read-forest directory (:archive-sha ref))]
                           (when-not (= (:archive-size ref) (alength ^bytes bytes))
                             (fail! :corrupt-forest "archive size differs from group"))
                           (verified bytes (:root-cid ref)))) (:archives group))]
      (when-not (group-has-cid? opened (:basis-cid group))
        (fail! :invalid-ipld-basis "basis block is absent from archive group"))
      {:directory directory :basis root :degraded? degraded? :group group
       :archives (mapv (fn [ref h] {:directory directory :ref ref
                                     :forest (dissoc h :bytes :carv1)}) (:archives group) opened)})))

(defn get-group-block
  "Find CID via the group's verified snapshot indexes and revalidate its frame."
  [handle cid]
  (some #(get-block % cid) (:archives handle)))
