(ns awai.fs.batch-plan
  "P4 batch fetch plans (AWAI-236).

  plan-batch takes several range requests and answers one verified fetch
  set: per-request chunk plans plus the union of chunks and the coalesced
  per-pack fetch groups. Coalescing runs per file, because pack numbers
  repeat across manifests and must never merge fetches from different
  files. Overlapping requests share chunks instead of double-fetching;
  unknown files and past-end ranges are refused with the query-plan
  reasons.

  Pure data in, pure data out. No bytes are allocated and no network is
  touched."
  (:refer-clojure :exclude [])
  (:require [awai.fs.large-file :as lf]
            [awai.fs.query-plan :as qp]))

(defn plan-batch
  "Plan [{:file :offset :length} ...] against a query-plan projection.
  Returns {:plans [...] :chunks [...] :groups [...] :bytes n} where :plans
  holds one query-plan/plan-range result per request, :chunks is the
  deduplicated union tagged with :file, :groups are the per-file coalesced
  fetches, and :bytes is their total length."
  [projection reqs]
  (let [plans (mapv (fn [{:keys [file offset length]}]
                      (assoc (qp/plan-range projection file offset length) :file file))
                    reqs)
        dedup (fn [es]
                (vals (reduce (fn [seen e]
                                (let [k (:index e)]
                                  (if (contains? seen k) seen (assoc seen k e))))
                              {} es)))
        per-file (->> (group-by :file plans)
                      (map (fn [[file file-plans]]
                             [file (dedup (mapcat :chunks file-plans))]))
                      vec)
        chunks (->> per-file
                    (mapcat (fn [[file es]] (map #(assoc % :file file) es)))
                    vec)
        groups (->> per-file
                    (mapcat (fn [[file es]]
                              (map #(assoc % :file file)
                                   (lf/coalesce-fetches es))))
                    vec)]
    {:plans (mapv #(dissoc % :file) plans)
     :chunks chunks
     :groups groups
     :bytes (reduce + 0 (map :length groups))}))
