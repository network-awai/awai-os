;; Execution ledger (Otehon port of src/itonami/agent/execution_ledger.cljk).
;;
;; executions.db tracks cron job claims across processes: `<home>/cron/`
;; holds `executions.db` with the `executions` and `cron_incidents` tables,
;; the legacy DDL verbatim. A claim is fenced (one live row per job), a
;; restart reaps rows whose owner is gone, and incidents deduplicate
;; failures by job and normalized error hash.
;;
;; Fencing answers are verified with a follow-up SELECT because the hio
;; writer returns no change count; the outcome is identical in the
;; single-writer oracle. The legacy BEGIN IMMEDIATE transaction around
;; claim/recover is not reproduced (one process writes in the oracle);
;; concurrent multi-process fencing is best-effort (see COMPAT.md).
;; Timestamps take an explicit trailing now-iso (handoff stamps a trailing
;; now-sec) so shared cases stay deterministic; production passes live time.
(ns itonami.otehon.ledger
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(def db-filename "executions.db")

(defn db-path [home] (str home "/cron/" db-filename))

;; A random owner token per process: a row owned by another token is
;; abandoned when its owner is gone.
(def process-id (hio/random-hex 16))

(def max-terminal-executions 1000)

(def handoff-adoption-grace-seconds
  "Restart recovery leaves a claimed row alone while an external worker is
  inside the adoption window."
  30)

(def default-failure-repeat-alert-hours 6.0)

(def ^:private base-ddl
  (str "PRAGMA journal_mode=WAL;"
       "PRAGMA synchronous=FULL;"
       "CREATE TABLE IF NOT EXISTS executions ("
       "id TEXT PRIMARY KEY,"
       "job_id TEXT NOT NULL,"
       "source TEXT NOT NULL,"
       "process_id TEXT NOT NULL,"
       "pid INTEGER NOT NULL,"
       "process_started_at INTEGER,"
       "status TEXT NOT NULL CHECK(status IN ('claimed','running','completed','failed','unknown')),"
       "handoff_pending INTEGER NOT NULL DEFAULT 0,"
       "handoff_started_at REAL,"
       "claimed_at TEXT NOT NULL,"
       "started_at TEXT,"
       "finished_at TEXT,"
       "error TEXT,"
       "delivery_outcome TEXT,"
       "scheduled_instant TEXT"
       ");"
       "CREATE INDEX IF NOT EXISTS idx_executions_job_claimed ON executions(job_id, claimed_at DESC, id DESC);"
       "CREATE INDEX IF NOT EXISTS idx_executions_status_claimed ON executions(status, claimed_at DESC, id DESC);"
       "CREATE INDEX IF NOT EXISTS idx_executions_occurrence ON executions(job_id, scheduled_instant) WHERE status='completed';"
       "CREATE TABLE IF NOT EXISTS cron_incidents ("
       "id TEXT PRIMARY KEY,"
       "job_id TEXT NOT NULL,"
       "error_sig TEXT NOT NULL,"
       "state TEXT NOT NULL,"
       "failure_type TEXT NOT NULL DEFAULT 'unknown',"
       "first_seen_at TEXT NOT NULL,"
       "last_seen_at TEXT NOT NULL,"
       "acked_at TEXT,"
       "alerted_at TEXT,"
       "closed_at TEXT,"
       "error TEXT NOT NULL,"
       "output_file TEXT"
       ");"
       "CREATE INDEX IF NOT EXISTS idx_cron_incidents_job ON cron_incidents(job_id);"
       "CREATE INDEX IF NOT EXISTS idx_cron_incidents_state ON cron_incidents(state);"))

(def ^:private incident-patch-ddl
  "ALTER TABLE cron_incidents ADD COLUMN alerted_at TEXT")

(defn open-db [home]
  (let [db (db-path home)]
    (hio/mkdirs! (hio/dirname db))
    (hio/sqlite-exec! db base-ddl)
    (let [cols (set (map #(get % "name")
                         (hio/sqlite-rows db "PRAGMA table_info(cron_incidents)" [])))]
      (doseq [[col ddl] [["handoff_pending" "ALTER TABLE executions ADD COLUMN handoff_pending INTEGER NOT NULL DEFAULT 0"]
                         ["handoff_started_at" "ALTER TABLE executions ADD COLUMN handoff_started_at REAL"]
                         ["delivery_outcome" "ALTER TABLE executions ADD COLUMN delivery_outcome TEXT"]
                         ["scheduled_instant" "ALTER TABLE executions ADD COLUMN scheduled_instant TEXT"]]]
        (when-not (contains? (set (map #(get % "name")
                                       (hio/sqlite-rows db "PRAGMA table_info(executions)" []))) col)
          (hio/sqlite-exec! db ddl)))
      (when-not (contains? cols "alerted_at")
        (try (hio/sqlite-exec! db incident-patch-ddl)
             (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))))
    db))

;; ---- process incarnation fingerprint ----

(defn- host-os []
  #?(:lpy (.-platform (python/__import__ "sys"))
     :clj (str (System/getProperty "os.name"))
     :cljs (.-platform js/process)))

(defn- linux? []
  (let [os (str/lower-case (str (host-os)))]
    (or (str/starts-with? os "linux") (= os "linux"))))

(defn- proc-stat-field
  "The start-time tick after the comm field of /proc/<pid>/stat, or nil."
  [pid]
  (try
    (let [text (hio/slurp-utf8 (str "/proc/" pid "/stat"))
          end (str/last-index-of text ") ")]
      (when (and end (>= end 0))
        (let [fields (str/split (subs text (+ end 2)) #"\s+")]
          (when (> (count fields) 19)
            (parse-long (nth fields 19))))))
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))

(defn- ps-start-centiseconds
  "macOS process start as centiseconds via ps, or nil when unprovable."
  [pid]
  (try
    (let [r (hio/spawn-sync! ["ps" "-p" (str pid) "-o" "lstart="] {:timeout-ms 2000})]
      (when (zero? (:exit r))
        (let [s (str/trim (str (:stdout r)))]
          (when-not (str/blank? s)
            #?(:lpy (let [dt (python/__import__ "datetime")]
                      (int (* 100 (.timestamp (.strptime (.-datetime dt) s "%a %b %d %H:%M:%S %Y")))))
               :clj (let [fmt (java.time.format.DateTimeFormatter/ofPattern "EEE MMM dd HH:mm:ss yyyy" java.util.Locale/ENGLISH)
                          ldt (java.time.LocalDateTime/parse s fmt)
                          ms (.toEpochMilli (.toInstant (.atZone ldt (java.time.ZoneId/systemDefault))))]
                      (Math/round (/ ms 10)))
               :cljs (let [t (.parse js/Date s)]
                       (when-not (js/isNaN t) (js/Math.round (/ t 10)))))))))
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))

(defn process-start-time
  "A process-incarnation fingerprint, or nil when the host cannot prove
  it: Linux /proc ticks, macOS ps start time. Compared loosely — only an
  incarnation change (not clock skew) marks an owner gone."
  [pid]
  (try
    (if (linux?)
      (proc-stat-field pid)
      (ps-start-centiseconds pid))
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))

(defn- owner-gone? [row]
  (let [owner-pid (get row "pid")
        recorded (get row "process_started_at")
        current (when (some? owner-pid)
                  (when (hio/kill-probe-alive? owner-pid)
                    (process-start-time owner-pid)))
        abs-diff (fn [x] (if (neg? x) (- x) x))]
    (and (not= process-id (str (get row "process_id")))
         (or (not (and (some? owner-pid) (hio/kill-probe-alive? owner-pid)))
             (and (number? recorded) (number? current)
                  (> (abs-diff (- current recorded)) 200))))))

(defn- recover-interrupted!
  "Fence restart recovery: rows owned by another, gone process become
  `unknown` — unless an external worker is inside the adoption window."
  [db now-iso]
  (let [rows (hio/sqlite-rows db
               "SELECT id,process_id,pid,process_started_at,handoff_pending,handoff_started_at FROM executions WHERE status IN ('claimed','running')"
               [])
        now-sec (/ (double (hio/now-ms)) 1000)]
    (doseq [row rows
            :let [pending (get row "handoff_pending")
                  started (get row "handoff_started_at")]]
      (when (and (owner-gone? row)
                 (not (and (number? pending) (pos? pending)
                           (number? started)
                           (< (- now-sec started) handoff-adoption-grace-seconds))))
        (hio/sqlite-run! db
          (str "UPDATE executions SET status='unknown',finished_at=?,error=?,"
               "handoff_pending=0,handoff_started_at=NULL "
               "WHERE id=? AND status IN ('claimed','running')")
          [now-iso "scheduler restarted before a terminal result; execution outcome is unknown"
           (str (get row "id"))])))))

;; ---- claims ----

(defn claim!
  "Persist a claimed attempt before executing its script or agent turn.
  Answers the execution id; throws when the job already has one live."
  ([home job source] (claim! home job source (hio/now-micros-iso)))
  ([home job source now-iso]
   (let [db (open-db home)
         id (hio/random-hex 16)
         job-id (str (get job "id"))]
     (recover-interrupted! db now-iso)
     (let [active (first (hio/sqlite-rows db
                           "SELECT id FROM executions WHERE job_id=? AND status IN ('claimed','running') LIMIT 1"
                           [job-id]))]
       (when active
         (throw (ex-info "Cron job already has an active execution"
                         {:job-id job-id :execution-id (str (get active "id"))}))))
     (hio/sqlite-run! db
       (str "INSERT INTO executions"
            "(id,job_id,source,process_id,pid,process_started_at,status,claimed_at)"
            " VALUES (?,?,?,?,?,?,'claimed',?)")
       [id job-id (str source) process-id (long (hio/process-id))
        (process-start-time (hio/process-id)) now-iso])
     id)))

(defn mark-handoff-pending!
  "Fence restart recovery while an external worker adopts this claim.
  Owner-fenced: only the process that claimed the attempt may hand it off."
  ([home id] (mark-handoff-pending! home id (/ (double (hio/now-ms)) 1000)))
  ([home id now-sec]
   (let [db (open-db home)]
     (hio/sqlite-run! db
       (str "UPDATE executions SET handoff_pending=1,handoff_started_at=?"
            " WHERE id=? AND status='claimed' AND process_id=? AND pid=?")
       [(double now-sec) (str id) process-id (long (hio/process-id))])
     (let [row (first (hio/sqlite-rows db "SELECT handoff_pending FROM executions WHERE id=?" [(str id)]))]
       (boolean (and row (= 1 (long (or (get row "handoff_pending") 0)))))))))

(defn adopt-claimed!
  "Atomically transfer a pending claim into this worker process and start
  it running. The single claimed -> running adoption gate."
  ([home id] (adopt-claimed! home id (hio/now-micros-iso)))
  ([home id now-iso]
   (let [db (open-db home)
         pre (first (hio/sqlite-rows db "SELECT status,handoff_pending FROM executions WHERE id=?" [(str id)]))]
     (if-not (and pre (= "claimed" (str (get pre "status"))) (= 1 (long (or (get pre "handoff_pending") 0))))
       false
       (do
         (hio/sqlite-run! db
           (str "UPDATE executions SET process_id=?,pid=?,process_started_at=?,status='running',started_at=?,"
                "handoff_pending=0,handoff_started_at=NULL "
                "WHERE id=? AND status='claimed' AND handoff_pending=1")
           [process-id (long (hio/process-id)) (process-start-time (hio/process-id)) now-iso (str id)])
         (let [row (first (hio/sqlite-rows db "SELECT status,handoff_pending FROM executions WHERE id=?" [(str id)]))]
           (boolean (and row (= "running" (str (get row "status")))
                         (= 0 (long (or (get row "handoff_pending") 1)))))))))))

(defn mark-running!
  "Transition an owned claimed attempt to running exactly once."
  ([home id] (mark-running! home id (hio/now-micros-iso)))
  ([home id now-iso]
   (let [db (open-db home)
         self (long (hio/process-id))
         pre (first (hio/sqlite-rows db "SELECT status,process_id,pid FROM executions WHERE id=?" [(str id)]))]
     (if-not (and pre (= "claimed" (str (get pre "status")))
                    (= process-id (str (get pre "process_id")))
                    (= self (long (or (get pre "pid") -1))))
       false
       (do
         (hio/sqlite-run! db
           (str "UPDATE executions SET status='running',started_at=? "
                "WHERE id=? AND status='claimed' AND process_id=? AND pid=?")
           [now-iso (str id) process-id self])
         (let [row (first (hio/sqlite-rows db "SELECT status FROM executions WHERE id=?" [(str id)]))]
           (boolean (and row (= "running" (str (get row "status")))))))))))

(defn finish!
  "Write an owned terminal result once. Error details stay out of the
  table (provider or script errors may hold secrets); terminal rows past
  the bound are dropped, newest first."
  ([home id success? delivery-outcome]
   (finish! home id success? delivery-outcome (hio/now-micros-iso)))
  ([home id success? delivery-outcome now-iso]
   (let [db (open-db home)
         status (if success? "completed" "failed")
         self (long (hio/process-id))
         pre (first (hio/sqlite-rows db "SELECT status,process_id,pid FROM executions WHERE id=?" [(str id)]))]
     (if-not (and pre (contains? #{"claimed" "running"} (str (get pre "status")))
                  (= process-id (str (get pre "process_id")))
                  (= self (long (or (get pre "pid") -1))))
       false
       (do
         (hio/sqlite-run! db
           (str "UPDATE executions SET status=?,finished_at=?,error=?,handoff_pending=0,handoff_started_at=NULL,"
                "delivery_outcome=? WHERE id=? AND status IN ('claimed','running') AND process_id=? AND pid=?")
           [status now-iso (when-not success? "execution failed")
            (str delivery-outcome) (str id) process-id self])
         (hio/sqlite-run! db
           (str "DELETE FROM executions WHERE id IN ("
                " SELECT id FROM executions WHERE status IN ('completed','failed','unknown')"
                " ORDER BY finished_at DESC,claimed_at DESC,id DESC LIMIT -1 OFFSET ?)")
           [(long max-terminal-executions)])
         (let [row (first (hio/sqlite-rows db "SELECT status FROM executions WHERE id=?" [(str id)]))]
           (boolean (and row (= status (str (get row "status")))))))))))

(defn set-delivery-outcome!
  "Settle a queued delivery's outcome onto its execution row. Fenced on
  the execution id: idempotent, never rewrites another run."
  [home id delivery-outcome]
  (let [db (open-db home)]
    (hio/sqlite-run! db "UPDATE executions SET delivery_outcome=? WHERE id=?"
      [(str delivery-outcome) (str id)])
    (let [row (first (hio/sqlite-rows db "SELECT delivery_outcome FROM executions WHERE id=?" [(str id)]))]
      (boolean (and row (= (str delivery-outcome) (str (get row "delivery_outcome"))))))))

(def row-keys
  ["id" "job_id" "source" "process_id" "pid" "process_started_at"
   "status" "handoff_pending" "handoff_started_at" "claimed_at"
   "started_at" "finished_at" "error" "delivery_outcome" "scheduled_instant"])

(defn get-execution
  "One execution row by id, or nil."
  [home id]
  (let [row (first (hio/sqlite-rows (db-path home)
                     "SELECT * FROM executions WHERE id=?" [(str id)]))]
    (when row (into {} (for [k row-keys] [k (get row k)])))))

(defn rows
  "Read-only helper used by cron status and tests."
  [home job-id]
  (let [db (open-db home)]
    (mapv (fn [r] (into {} (for [k row-keys] [k (get r k)])))
      (if job-id
        (hio/sqlite-rows db "SELECT * FROM executions WHERE job_id=? ORDER BY claimed_at DESC,id DESC" [(str job-id)])
        (hio/sqlite-rows db "SELECT * FROM executions ORDER BY claimed_at DESC,id DESC" [])))))

;; ---- failure incidents ----

(defn- failure-type [error]
  (let [s (str/lower-case (str error))]
    (cond
      (or (str/includes? s "429") (str/includes? s "rate limit") (str/includes? s "quota")) "rate_limit"
      (or (str/includes? s "timeout") (str/includes? s "timed out")) "timeout"
      (or (str/includes? s "401") (str/includes? s "unauthorized") (str/includes? s "authentication")) "auth"
      (or (str/includes? s "delivery") (str/includes? s "deliver")) "delivery"
      (or (str/includes? s "config") (str/includes? s "validation")) "config"
      (or (str/includes? s "script") (str/includes? s "no_agent")) "script"
      (or (str/includes? s "agent") (str/includes? s "model")
          (str/includes? s "provider") (str/includes? s "inference")) "agent"
      :else "unknown")))

(defn upsert-incident!
  "Deduplicate a failure by job and normalized error hash. Raw error text
  is never persisted: it may include credentials from a provider or script."
  ([home job-id error output-file] (upsert-incident! home job-id error output-file (hio/now-micros-iso)))
  ([home job-id error output-file now-iso]
   (let [db (open-db home)
         jid (str job-id)
         normalized (-> (str error) str/trim str/lower-case (str/replace #"\s+" " "))
         error-sig (subs (hio/sha256-utf8 (str jid (subs normalized 0 (min 200 (count normalized))))) 0 12)
         id (str (subs jid 0 (min 6 (count jid))) "_" error-sig)
         kind (failure-type error)]
     (let [prior (first (hio/sqlite-rows db "SELECT state FROM cron_incidents WHERE id=?" [id]))
           prior-state (when prior (str (get prior "state")))
           state (if (= "resolved" prior-state) "detected" (or prior-state "detected"))]
       (hio/sqlite-run! db
         (str "INSERT INTO cron_incidents"
              "(id,job_id,error_sig,state,failure_type,first_seen_at,last_seen_at,error,output_file)"
              " VALUES (?,?,?,?,?,?,?,?,?)"
              " ON CONFLICT(id) DO UPDATE SET state=excluded.state,failure_type=excluded.failure_type,"
              "last_seen_at=excluded.last_seen_at,error=excluded.error,output_file=excluded.output_file,"
              "alerted_at=CASE WHEN cron_incidents.state='resolved' THEN NULL ELSE cron_incidents.alerted_at END,"
              "closed_at=CASE WHEN cron_incidents.state='resolved' THEN NULL ELSE cron_incidents.closed_at END")
         [id jid error-sig state kind now-iso now-iso "execution failed" (when output-file (str output-file))])
       {:id id :error-signature error-sig :failure-type kind}))))

(def incident-keys
  ["id" "job_id" "error_sig" "state" "failure_type" "first_seen_at"
   "last_seen_at" "alerted_at" "acked_at" "closed_at"])

(defn get-incident [home incident-id]
  (let [row (first (hio/sqlite-rows (db-path home)
                     "SELECT * FROM cron_incidents WHERE id=?" [(str incident-id)]))]
    (when row
      (into {} (for [k incident-keys] [k (get row k)])))))

(defn ack-incident!
  "Close one incident signature until the error changes."
  ([home incident-id] (ack-incident! home incident-id (hio/now-micros-iso)))
  ([home incident-id now-iso]
   (let [db (open-db home)
         pre (first (hio/sqlite-rows db "SELECT state FROM cron_incidents WHERE id=?" [(str incident-id)]))]
     (if-not (and pre (not= "closed" (str (get pre "state"))))
       false
       (do
         (hio/sqlite-run! db
           "UPDATE cron_incidents SET state='closed',acked_at=?,closed_at=? WHERE id=? AND state!='closed'"
           [now-iso now-iso (str incident-id)])
         (let [row (first (hio/sqlite-rows db "SELECT state FROM cron_incidents WHERE id=?" [(str incident-id)]))]
           (boolean (and row (= "closed" (str (get row "state")))))))))))

(defn mark-incident-alerted!
  "Record that the configured failure-delivery lane completed for an incident."
  ([home incident-id] (mark-incident-alerted! home incident-id (hio/now-micros-iso)))
  ([home incident-id now-iso]
   (let [db (open-db home)]
     (hio/sqlite-run! db
       "UPDATE cron_incidents SET state='alerted',alerted_at=? WHERE id=? AND state IN ('detected','alerted')"
       [now-iso (str incident-id)])
     (let [row (first (hio/sqlite-rows db "SELECT state FROM cron_incidents WHERE id=?" [(str incident-id)]))]
       (boolean (and row (= "alerted" (str (get row "state")))))))))

(defn incidents [home]
  (let [db (open-db home)
        fields ["id" "job_id" "error_sig" "state" "failure_type" "first_seen_at"
                "last_seen_at" "acked_at" "alerted_at" "closed_at" "error" "output_file"]]
    (mapv (fn [row] (into {} (map (fn [f] [f (get row f)]) fields)))
      (hio/sqlite-rows db "SELECT * FROM cron_incidents ORDER BY last_seen_at DESC,id DESC" []))))

(defn resolve-incidents!
  "Mark detected/alerted failures resolved after a later successful run."
  ([home job-id] (resolve-incidents! home job-id (hio/now-micros-iso)))
  ([home job-id now-iso]
   (let [db (open-db home)]
     (hio/sqlite-run! db
       "UPDATE cron_incidents SET state='resolved',closed_at=? WHERE job_id=? AND state IN ('detected','alerted')"
       [now-iso (str job-id)])
     true)))

(defn- repeat-alert-hours [config]
  (let [cfg (get-in config ["cron" "failure_repeat_alert_hours"])
        v (cond (number? cfg) cfg
                (string? cfg) (try (parse-double cfg)
                                   (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))
                :else nil)]
    (if (number? v) v default-failure-repeat-alert-hours)))

(defn- repeat-alert-withheld? [incident config]
  (let [hours (repeat-alert-hours config)]
    (if (<= hours 0)
      false
      (let [alerted-at (get incident "alerted_at")]
        (if (str/blank? (str alerted-at))
          false
          (if-let [last (hio/parse-iso-ms (str alerted-at))]
            (< (- (hio/now-ms) last) (* hours 3600000))
            false))))))

(defn upsert-incident-for-failure!
  "Record the durable failure incident and answer whether the per-run ping
  is withheld — the signature's incident is already `closed` (operator
  ack) or `alerted` inside the repeat-alert cooldown."
  ([home job config error output-file]
   (upsert-incident-for-failure! home job config error output-file (hio/now-micros-iso)))
  ([home job config error output-file now-iso]
   (let [{:keys [id]} (upsert-incident! home (get job "id") error output-file now-iso)
         incident (get-incident home id)
         state (get incident "state")
         withheld (or (= "closed" state)
                      (and (= "alerted" state) (repeat-alert-withheld? incident config)))]
     {:withheld withheld :incident-id id})))
