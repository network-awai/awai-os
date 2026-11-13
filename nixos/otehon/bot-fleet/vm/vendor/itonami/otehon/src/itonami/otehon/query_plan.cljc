(ns itonami.otehon.query-plan
  "Which layer answers one sqlite query over awai fs, decided pure.

  The disk is layered bytes -> pack -> index -> SQL (AWAI-161 2026-11-07):
  bytes is the encrypted IPLD block store (tag-42 CID, rehashed on read),
  pack is CARv2 addressed by range, index is the Prolly/range tree plus
  the arrangement covering indexes plus the Datomic log/index, SQL is the
  sqlite file on top. A query is pruned at the lowest layer that can
  refuse it, and a full scan is refused rather than run.

  This namespace never takes a visibility predicate (visible?): like
  ayatori.remote and kotobase.query.bridge, materialization is shared
  and visibility is applied after, so one plan stays sound for every
  caller and authority is never memoised.

  Tables and indexes below are the itonami sqlite shapes verbatim:
  cron_notepad (job_id,key), deliveries (execution_id, pending order,
  tombstones), executions (id, job/claimed, status/claimed, occurrence),
  cron_incidents (id, job, state). The ORDER BY shapes are the legacy
  SQL strings (julianday ordering included): an order that does not
  match the named index refuses instead of sorting silently."
  (:require [clojure.string :as str]))

(def tables
  "Table -> primary key cols and known indexes. An index entry names the
  column order the legacy SQL relies on; :where names the fixed filter
  the index assumes (pending, or completed for occurrence)."
  {"cron_notepad" {:pk ["job_id" "key"]
                   :indexes []}
   "deliveries" {:pk ["execution_id"]
                 :indexes [{:name "pending-created"
                            :cols ["status" "created_at" "execution_id"]
                            :where {"status" "pending"}}]}
   "executions" {:pk ["id"]
                 :indexes [{:name "job-claimed"
                            :cols ["job_id" "claimed_at" "id"]}
                           {:name "status-claimed"
                            :cols ["status" "claimed_at" "id"]}
                           {:name "occurrence"
                            :cols ["job_id" "scheduled_instant"]
                            :where {"status" "completed"}}]}
   "cron_incidents" {:pk ["id"]
                     :indexes [{:name "job" :cols ["job_id"]}
                               {:name "state" :cols ["state"]}]}})

(defn- where-map [q]
  (let [w (get q "where")]
    (if (map? w) w {})))

(defn- order-vec [q]
  (let [o (get q "order")]
    (if (sequential? o) (vec (map str o)) [])))

(defn- range-map [q]
  (let [r (get q "range")]
    (when (map? r) r)))

(defn- pk-covered?
  "True when the where map names every PK col."
  [pk where]
  (and (seq pk) (every? #(contains? where %) pk)))

(defn- prefix?
  "True when cols starts with prefix (order matters, legacy SQL order)."
  [cols prefix]
  (and (<= (count prefix) (count cols))
       (= (vec (take (count prefix) cols)) (vec prefix))))

(defn- index-match
  "First known index whose fixed :where agrees with the query where and
  whose :cols start with the query order (or the where cols when the
  query names no order). Nil when none matches."
  [indexes where order]
  (let [keys (vec (sort (keys where)))
        probe (if (seq order) order keys)]
    (first (filter (fn [idx]
                     (let [fixed (get idx :where {})]
                       (and (every? (fn [[k v]] (= (str (get where k)) (str v))) fixed)
                            (prefix? (vec (:cols idx)) (vec probe)))))
                   indexes))))

(defn plan
  "Decide the answering layer for one query descriptor. The descriptor
  uses string keys so shared cases stay runner-identical:
  {\"table\" t, \"where\" {col val}, \"order\" [col...],
   \"range\" {\"col\" c \"op\" op} or nil, \"limit\" n or nil}.

  Layers: point (PK equality, no scan), index-scan (a named covering
  index carries the where/order), range-prune (a declared range on an
  indexed col, Ayatori remote style), refused (full scan, unknown table
  or index, or an order the index cannot carry)."
  [q]
  (let [t (str (get q "table" ""))
        spec (get tables t)
        where (where-map q)
        order (order-vec q)
        r (range-map q)]
    (cond
      (nil? spec) {"layer" "refused" "reason" "unknown-table" "table" t}
      (pk-covered? (get spec :pk []) where)
      {"layer" "point" "reason" "pk" "table" t}
      (and (map? r) (str (get r "col")) (not= (str (get r "col")) ""))
      (let [col (str (get r "col"))
            indexed? (some (fn [idx] (boolean (some #(= % col) (vec (:cols idx)))))
                             (get spec :indexes []))]
        (if indexed?
          {"layer" "range-prune" "reason" "declared-range" "table" t "col" col}
          {"layer" "refused" "reason" "range-without-index" "table" t "col" col}))
      :else
      (let [hit (index-match (get spec :indexes []) where order)]
        (if hit
          {"layer" "index-scan" "reason" "covering-index"
           "table" t "index" (str (:name hit))}
          {"layer" "refused" "reason" "full-scan" "table" t})))))
