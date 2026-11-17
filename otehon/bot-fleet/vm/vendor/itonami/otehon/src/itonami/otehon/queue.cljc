;; Delivery queue (Otehon port of src/itonami/agent/delivery_queue.cljk).
;;
;; SQLite-backed FIFO for agent handoffs: `<home>/cron/deliveries.db`, the
;; `deliveries` table, and the bounded `delivery_tombstones` table are the
;; legacy layout verbatim. A send is claimed at most once; a claimer that
;; dies mid-send is fenced `unknown` and never retried.
;;
;; Claim/finish answers are verified with a follow-up SELECT because the
;; hio writer returns no change count; the outcome is identical in the
;; single-writer oracle. Timestamps take an explicit trailing now-iso so
;; shared cases stay deterministic (production passes live time); integer
;; owner stamps take an explicit trailing now-ms plus pid for the same
;; reason.
(ns itonami.otehon.queue
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(def max-terminal-deliveries 1000)

(def terminal-statuses #{"delivered" "failed" "unknown" "suppressed"})

(def ledger-outcome
  "Queue terminal status -> ledger delivery_outcome. `unknown` surfaces as
  a failure: the user cannot be told the result arrived."
  {"delivered" "delivered" "suppressed" "suppressed" "failed" "failed" "unknown" "failed"})

(defn db-path [home] (str home "/cron/deliveries.db"))

(def schema-ddl
  (str "PRAGMA journal_mode=WAL;"
       "PRAGMA synchronous=FULL;"
       "CREATE TABLE IF NOT EXISTS deliveries ("
       "execution_id TEXT PRIMARY KEY,"
       "job_json TEXT NOT NULL,"
       "content TEXT NOT NULL,"
       "for_failure INTEGER NOT NULL DEFAULT 0,"
       "status TEXT NOT NULL CHECK(status IN "
       "('pending','delivering','delivered','failed','unknown','suppressed')),"
       "owner_process_id TEXT,"
       "owner_pid INTEGER,"
       "owner_started_at INTEGER,"
       "created_at TEXT NOT NULL,"
       "finished_at TEXT,"
       "error TEXT);"
       "CREATE TABLE IF NOT EXISTS delivery_tombstones ("
       "execution_id TEXT PRIMARY KEY,"
       "terminal_status TEXT NOT NULL CHECK(terminal_status IN "
       "('delivered','failed','unknown','suppressed')),"
       "finished_at TEXT);"))

(defn open-db [home]
  (let [db (db-path home)]
    (hio/sqlite-exec! db schema-ddl)
    db))

(def row-keys
  ["execution_id" "job_json" "content" "for_failure" "status"
   "owner_process_id" "owner_pid" "owner_started_at"
   "created_at" "finished_at" "error"])

(defn row->map [r]
  (when r
    (into {} (for [k row-keys] [k (get r k)]))))

(defn- prune-terminal! [db]
  (let [redact-sql (str "UPDATE deliveries SET job_json='{}', content=''"
                        " WHERE status IN ('delivered','failed','unknown','suppressed')"
                        " AND (job_json != '{}' OR content != '')")]
    (hio/sqlite-run! db redact-sql [])
    (let [nrow (first (hio/sqlite-rows db
                        (str "SELECT COUNT(*) AS n FROM deliveries"
                             " WHERE status IN ('delivered','failed','unknown','suppressed')") []))
          n (long (or (get nrow "n") 0))
          excess (- n max-terminal-deliveries)]
      (when (pos? excess)
        (hio/sqlite-run! db
          (str "INSERT OR IGNORE INTO delivery_tombstones"
               " (execution_id, terminal_status, finished_at)"
               " SELECT execution_id, status, finished_at FROM deliveries"
               " WHERE status IN ('delivered','failed','unknown','suppressed')"
               " ORDER BY julianday(finished_at), finished_at,"
               " julianday(created_at), created_at, execution_id LIMIT ?")
          [(long excess)])
        (hio/sqlite-run! db
          (str "DELETE FROM deliveries WHERE execution_id IN ("
               " SELECT execution_id FROM deliveries"
               " WHERE status IN ('delivered','failed','unknown','suppressed')"
               " ORDER BY julianday(finished_at), finished_at,"
               " julianday(created_at), created_at, execution_id LIMIT ?)")
          [(long excess)])))))

(defn enqueue!
  "Persist one idempotent delivery request before the send. A tombstoned
  execution id returns its terminal outcome instead of re-queuing."
  ([home execution-id job content for-failure?]
   (enqueue! home execution-id job content for-failure? (hio/now-micros-iso)))
  ([home execution-id job content for-failure? now-iso]
   (let [db (open-db home)
         id (str execution-id)
         t (first (hio/sqlite-rows db
                    "SELECT terminal_status, finished_at FROM delivery_tombstones WHERE execution_id=?"
                    [id]))]
     (if t
       {"execution_id" id "status" (str (get t "terminal_status")) "finished_at" (get t "finished_at")}
       (do
         (hio/sqlite-run! db
           (str "INSERT OR IGNORE INTO deliveries"
                " (execution_id, job_json, content, for_failure, status, created_at)"
                " VALUES (?, ?, ?, ?, 'pending', ?)")
           [id (hio/json-str-2 job) (str content) (if for-failure? 1 0) now-iso])
         (row->map (first (hio/sqlite-rows db "SELECT * FROM deliveries WHERE execution_id=?" [id]))))))))

(defn get-status
  "The queued row, the tombstone when pruned, or nil when unknown."
  [home execution-id]
  (let [db (open-db home)
        id (str execution-id)]
    (if-let [r (row->map (first (hio/sqlite-rows db "SELECT * FROM deliveries WHERE execution_id=?" [id])))]
      r
      (when-let [t (first (hio/sqlite-rows db
                            "SELECT execution_id, terminal_status, finished_at FROM delivery_tombstones WHERE execution_id=?"
                            [id]))]
        {"execution_id" (str (get t "execution_id"))
         "status" (str (get t "terminal_status"))
         "finished_at" (get t "finished_at")
         "error" nil}))))

(defn claim-row!
  "Claim one specific pending send for this process before touching the
  transport. False when the row is not pending."
  ([home execution-id] (claim-row! home execution-id (hio/now-ms) (hio/process-id)))
  ([home execution-id now-ms pid]
   (let [db (open-db home)
         token (hio/random-hex 16)]
     (hio/sqlite-run! db
       (str "UPDATE deliveries SET status='delivering',"
            "owner_process_id=?,owner_pid=?,owner_started_at=?"
            " WHERE execution_id=? AND status='pending'")
       [token (long pid) (long now-ms) (str execution-id)])
     (let [row (first (hio/sqlite-rows db "SELECT owner_process_id FROM deliveries WHERE execution_id=?" [(str execution-id)]))]
       (boolean (and row (= token (str (get row "owner_process_id")))))))))

(defn claim-next!
  "Atomically claim one pending send (the drain's entry point). Nil when
  the queue has no pending row."
  ([home] (claim-next! home (hio/now-ms) (hio/process-id)))
  ([home now-ms pid]
   (let [db (open-db home)
         r (first (hio/sqlite-rows db
                    (str "SELECT execution_id FROM deliveries WHERE status='pending'"
                         " ORDER BY julianday(created_at), created_at, execution_id LIMIT 1") []))]
     (when r
       (let [id (str (get r "execution_id"))]
         (when (claim-row! home id now-ms pid)
           (get-status home id)))))))

(defn finish!
  "Terminalize a claimed send. Fenced: never rewrites a terminal row.
  Redacts the payload and prunes terminal rows afterwards."
  ([home execution-id status error] (finish! home execution-id status error (hio/now-micros-iso)))
  ([home execution-id status error now-iso]
   (let [db (open-db home)
         pre (first (hio/sqlite-rows db "SELECT status FROM deliveries WHERE execution_id=?" [(str execution-id)]))]
     ;; the legacy UPDATE only matches pending/delivering rows: re-terminalizing
     ;; an already-terminal row answers false, while pruning still runs.
     (when (and pre (contains? #{"pending" "delivering"} (str (get pre "status"))))
       (hio/sqlite-run! db
         (str "UPDATE deliveries SET status=?,finished_at=?,error=?"
              " WHERE execution_id=? AND status IN ('pending','delivering')")
         [(str status) now-iso (when error (str error)) (str execution-id)]))
     (prune-terminal! db)
     (let [row (first (hio/sqlite-rows db "SELECT status FROM deliveries WHERE execution_id=?" [(str execution-id)]))]
       (boolean (and pre
                      (contains? #{"pending" "delivering"} (str (get pre "status")))
                      row (= (str status) (str (get row "status")))))))))

(defn- owner-alive? [owner-pid]
  (let [n (parse-long (str owner-pid))]
    (boolean (and n (pos? n) (hio/kill-probe-alive? n)))))

(defn recover-abandoned!
  "Rows claimed by a process that is gone are fenced `unknown` and never
  retried: losing a delivery is safer than duplicating a possibly
  completed send. Returns the recovered rows."
  ([home] (recover-abandoned! home (hio/now-micros-iso)))
  ([home now-iso]
   (let [db (open-db home)
         rows (mapv row->map
                (hio/sqlite-rows db "SELECT * FROM deliveries WHERE status='delivering'" []))
         dead (filterv #(not (owner-alive? (get % "owner_pid"))) rows)]
     (doseq [r dead]
       (hio/sqlite-run! db
         (str "UPDATE deliveries SET status='unknown',finished_at=?"
              " WHERE execution_id=? AND status='delivering'")
         [now-iso (get r "execution_id")]))
     (when (seq dead) (prune-terminal! db))
     (mapv #(assoc % "status" "unknown") dead))))
