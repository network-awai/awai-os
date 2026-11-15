(ns awai.fs.transfer-plan
  "P5 transfer and repair plans (AWAI-236).

  plan-transfer answers which node serves each requested entry: the first
  node, in sorted order, that holds the entry's pack. plan-repair answers
  which packs stay readable on the live nodes, which must be re-fetched
  because every holder died, and which have no known source at all. A pack
  that cannot be served is refused or listed, never silently skipped.

  Pure data in, pure data out. No bytes are allocated and no network is
  touched: callers move the bytes; this namespace only decides who serves
  what and what must be repaired."
  (:refer-clojure :exclude [])
  (:require [awai.fs.large-file :as lf]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn plan-transfer
  "Plan fetches for entries given pool, a {pack-index #{node}} map.
  Returns {:assignments {node [...] } :groups [...] :bytes n} where groups
  are per-node coalesced per-pack fetches. A pack with no node is refused."
  [entries pool]
  (let [by-node (reduce (fn [acc e]
                          (let [holders (get pool (:pack e))]
                            (when (or (nil? holders) (empty? holders))
                              (fail! :awai.fs.transfer/no-source
                                     "awai fs transfer: pack has no serving node"
                                     {:pack (:pack e)}))
                            (update acc (first (sort holders)) (fnil conj []) e)))
                        {} entries)
        groups (->> by-node
                    (mapcat (fn [[node es]]
                              (let [ordered (sort-by (juxt :pack :pack-offset) es)]
                                (map #(assoc % :node node)
                                     (lf/coalesce-fetches ordered)))))
                    vec)]
    {:assignments by-node
     :groups groups
     :bytes (reduce + 0 (map :length groups))}))

(defn plan-repair
  "Classify every pack of manifest against live-nodes given pool, a
  {pack-index #{node}} map. Returns {:ok [...] :refetch [...] :degraded
  [...]}, each a sorted vector of pack indexes: :ok packs stay readable on
  a live node, :refetch packs lost every holder, :degraded packs have no
  known source at all."
  [manifest live-nodes pool]
  (let [packs (sort (distinct (map :pack (:entries manifest))))]
    (reduce (fn [acc p]
              (let [holders (get pool p)]
                (cond
                  (seq (filter live-nodes (or holders #{})))
                  (update acc :ok conj p)

                  (seq holders)
                  (update acc :refetch conj p)

                  :else
                  (update acc :degraded conj p))))
            {:ok [] :refetch [] :degraded []}
            packs)))
