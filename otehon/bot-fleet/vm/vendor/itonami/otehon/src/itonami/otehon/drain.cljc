;; Live-rail drain (Otehon port of the delivery half of
;; src/itonami/agent/cron.cljk: delivery-lane, deliver-output,
;; settle-queued-delivery!, deliver-row!, drain-queued!, the tick
;; abandoned-send sweep, output-doc, save-output!, record-run-state! and
;; the run-job post-turn finish).
;;
;; The legacy runs these as promise chains with live adapters and an
;; agent loop. The port runs the identical state transitions
;; synchronously: adapters are injected fns (production passes the
;; platform adapters; shared cases pass stubs), and finish-run! takes
;; the loop's result map instead of running the loop. Queue and ledger
;; rows, jobs.json, output docs and audit jsonl end up byte-equal for
;; deterministic inputs; only the concurrency (sequential here) and the
;; live transport differ.
;;
;; Timestamps take an explicit trailing now-iso (started/finished share
;; one stamp per run, as in the legacy), so shared cases stay
;; deterministic; production passes live time.
(ns itonami.otehon.drain
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]
            [itonami.otehon.cron :as cron]
            [itonami.otehon.delivery :as delivery]
            [itonami.otehon.queue :as queue]
            [itonami.otehon.ledger :as ledger]))

;; ---- jobs.json read/modify/write under the legacy lock ----

(defn- jobs-file [home] (str home "/cron/jobs.json"))

(defn- read-jobs-doc [home]
  (try
    (let [p (jobs-file home)]
      (if (hio/file? p)
        (let [v (hio/parse-json (hio/slurp-utf8 p))]
          (if (map? v) v {}))
        {}))
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ {})))

(defn job-row
  "The jobs.json row for a job id, or nil."
  [home id]
  (first (filter #(= (str id) (str (get % "id"))) (cron/jobs-of (read-jobs-doc home)))))

(defn update-job!
  "Read/modify/write cron/jobs.json preserving top-level extension
  fields and stamping updated_at — the legacy write-jobs-unlocked!
  contract. Answers the updated row, or nil when the job is absent."
  ([home id f] (update-job! home id f (hio/now-micros-iso)))
  ([home id f now-iso]
   (let [lock (str home "/cron/.itonami-jobs.lock")]
     (when-not (hio/acquire-lock! lock)
       (throw (ex-info "cron jobs are being updated by another process" {:lock lock})))
     (try
       (let [doc (read-jobs-doc home)
             jobs (cron/jobs-of doc)
             updated (mapv #(if (= (str id) (str (get % "id"))) (f %) %) jobs)]
         (hio/mkdirs! (str home "/cron"))
         (hio/replace-file! (jobs-file home)
           (hio/json-str (assoc doc "jobs" updated "updated_at" now-iso)))
         (first (filter #(= (str id) (str (get % "id"))) updated)))
       (finally (hio/release-lock! lock))))))

;; ---- lane resolution ----

(defn delivery-lane [job failed?]
  (let [failure (get job "failure_deliver")
        raw (if (and failed? (some? failure) (not (str/blank? (str failure))))
              failure
              (get job "deliver"))]
    (delivery/normalize-deliver-value raw)))

(defn send-targets [lane]
  (remove #(= "local" (str/lower-case (str %))) (delivery/lanes lane)))

(defn- call-adapter [send-fn job lane content failed?]
  (try
    (let [result (send-fn job lane content {:for-failure failed?})]
      (cond
        (and (map? result) (:error result)) (str (:error result))
        (false? result) "delivery adapter returned false"
        :else nil))
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
      (str "delivery adapter failed: " (or (ex-message e) (str e))))))

;; ---- deliver one execution ----

(defn deliver-output
  "Durable handoff before the transport: enqueue, claim, send through
  each lane target, finish terminal. Answers nil when everything
  delivered, else the joined error string. `for-lane` resolves a lane
  name to an adapter fn (production passes the platform adapters)."
  ([home execution-id job content failed? delivery-fn config for-lane]
   (deliver-output home execution-id job content failed? delivery-fn config for-lane (hio/now-micros-iso)))
  ([home execution-id job content failed? delivery-fn config for-lane now-iso]
   (let [targets (send-targets (delivery-lane job failed?))]
     (if (empty? targets)
       nil
       (do
         (queue/enqueue! home execution-id job content failed? now-iso)
         (queue/claim-row! home execution-id)
         (let [errs (mapv (fn [l]
                            (let [f (or (delivery/adapter-for (str l))
                                        (when for-lane (for-lane (str l) config))
                                        delivery-fn)]
                              (if-not (fn? f)
                                (str "delivery requested for '" l "' but no Kotoba delivery adapter is configured")
                                (call-adapter f job l content failed?))))
                      targets)
               joined (str/join "; " (remove str/blank? errs))]
           (queue/finish! home execution-id
             (if (str/blank? joined) "delivered" "failed")
             (when-not (str/blank? joined) joined)
             now-iso)
           (when-not (str/blank? joined) joined)))))))

;; ---- settle + drain ----

(defn settle-queued-delivery!
  "Write a queued delivery's terminal outcome back onto the run that
  queued it. Fenced on the execution id and idempotent, verbatim.
  The trailing now-iso stamps jobs.json (production passes live time)."
  ([home execution-id job-id delivery-error queue-status]
   (settle-queued-delivery! home execution-id job-id delivery-error queue-status (hio/now-micros-iso)))
  ([home execution-id job-id delivery-error queue-status now-iso]
   (let [latest (first (ledger/rows home (str job-id)))]
     (when (and latest (= (str execution-id) (str (get latest "id"))))
       (update-job! home (str job-id)
         (fn [job]
           (assoc job "last_status" (if delivery-error "delivery_failed" "ok")
                  "last_delivery_error" delivery-error))
         now-iso)
       (ledger/set-delivery-outcome!
        home execution-id (get queue/ledger-outcome (str queue-status) "failed"))
       true))))

(defn deliver-row!
  "Send one queued row through its lane's adapter and settle it.
  Answers the terminal queue status."
  ([prof row for-lane] (deliver-row! prof row for-lane (hio/now-micros-iso)))
  ([prof row for-lane now-iso]
   (let [home (:home prof)
         job (try (hio/parse-json (str (get row "job_json")))
                  (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ {}))
         content (str (get row "content"))
         failed? (= 1 (parse-long (str (get row "for_failure" "0"))))
         execution-id (str (get row "execution_id"))
         lane (delivery-lane job failed?)
         targets (send-targets lane)
         errs (mapv (fn [l]
                      ;; no delivery-fn fallback here, verbatim: queued rows
                      ;; resolve registry or lane adapters only
                      (let [f (or (delivery/adapter-for (str l))
                                  (when for-lane (for-lane (str l) (:config prof))))]
                        (if (fn? f)
                          (call-adapter f job l content failed?)
                          (str "delivery requested for '" l "' but no Kotoba delivery adapter is configured"))))
                targets)
         joined (str/join "; " (remove str/blank? errs))
         status (if (str/blank? joined) "delivered" "failed")
         error (when-not (str/blank? joined) joined)]
     (queue/finish! home execution-id status error now-iso)
     (settle-queued-delivery! home execution-id (str (get job "id")) error status now-iso)
     status)))

(defn drain-queued!
  "Claim every pending queued send at most once, deliver it through its
  lane's adapter, and settle the run's record. Answers the number of
  rows drained. Sequential where the legacy fans out — the terminal rows
  are identical."
  ([prof for-lane] (drain-queued! prof for-lane (hio/now-micros-iso)))
  ([prof for-lane now-iso]
   (let [home (:home prof)]
     (loop [n 0]
       (if-let [row (queue/claim-next! home)]
         (do (deliver-row! prof row for-lane now-iso)
             (recur (inc n)))
         n)))))

;; ---- tick abandoned-send sweep ----

(defn tick-abandoned!
  "Fence restart recovery for queued sends: rows claimed by a process
  that is gone read `unknown` and surface as incidents; they are never
  retried. Answers the number of rows recovered."
  ([home] (tick-abandoned! home (hio/now-micros-iso)))
  ([home now-iso]
   (let [abandoned (queue/recover-abandoned! home now-iso)]
     (doseq [r abandoned]
       (let [job-id (str (get (try (hio/parse-json (str (get r "job_json")))
                                   (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ {}))
                              "id"))]
         (ledger/upsert-incident! home job-id
           (str "delivery outcome unknown (owner died mid-send): " (get r "execution_id")) nil now-iso)
         (settle-queued-delivery! home (get r "execution_id") job-id
           "delivery outcome unknown (owner died mid-send)" "unknown" now-iso)))
     (count abandoned))))

;; ---- output docs ----

(defn- stamp-from-iso
  "YYYY-MM-DD_HH-MM-SS from an ISO timestamp — the legacy stamp shape,
  pure so filenames stay deterministic in cases."
  [iso]
  (let [s (subs (str iso) 0 19)]
    (str (subs s 0 10) "_" (str/replace (subs s 11) ":" "-"))))

(defn- human-time-from-iso
  "YYYY-MM-DD HH:MM:SS from an ISO timestamp — the legacy human-time shape."
  [iso]
  (str/replace (subs (str iso) 0 19) "T" " "))

(defn output-doc [job {:keys [prompt response failed? status-line]} at-iso]
  (str "# Cron Job: " (get job "name") (when failed? " (FAILED)") "\n\n"
       "**Job ID:** " (get job "id") "\n"
       "**Run Time:** " (human-time-from-iso at-iso) "\n"
       "**Schedule:** " (or (get job "schedule_display") (get-in job ["schedule" "display"])) "\n"
       (when-not (str/blank? status-line) (str status-line "\n"))
       "**Engine:** itonami-agent\n"
       "\n## Prompt\n\n" (or prompt "") "\n\n## Response\n\n"
       (if (str/blank? response) "(No response generated)" response) "\n"))

(defn save-output!
  "Persist the run's output doc (0600) and prune past 50. Answers the path."
  [home job doc at-iso]
  (let [dir (str home "/cron/output/" (get job "id"))
        f (str dir "/" (stamp-from-iso at-iso) ".md")]
    (hio/mkdirs! dir)
    (hio/write-text! f doc)
    (hio/set-mode! f 384)
    (doseq [old (drop 50 (reverse (sort (filter #(str/ends-with? % ".md")
                                                (hio/read-dir-names dir)))))]
      (hio/delete-file! (str dir "/" old)))
    f))

;; ---- run finish wiring ----

(defn record-run-state!
  "The jobs.json fields a finished run writes. Verbatim."
  ([home job started-iso failed? error delivery-error]
   (record-run-state! home job started-iso failed? error delivery-error (hio/now-micros-iso)))
  ([home job started-iso failed? error delivery-error now-iso]
   (update-job! home (get job "id")
     (fn [current]
       (let [completed (inc (or (get-in current ["repeat" "completed"]) 0))
             times (get-in current ["repeat" "times"])
             kind (get-in current ["schedule" "kind"])
             next-at (get current "next_run_at")
             terminal? (or (and (number? times) (pos? times) (>= completed times))
                           (and (= "once" kind) (nil? next-at)))
             recurring? (contains? #{"cron" "interval"} kind)
             next-error? (and recurring? (nil? next-at))
             current (-> current
                         ;; the legacy writes the micros ISO here, not human time
                         (assoc "last_run_at" started-iso
                                "last_status" (cond failed? "error" delivery-error "delivery_failed" :else "ok")
                                "last_error" (or error (when next-error? "Failed to compute next run for recurring schedule."))
                                "last_delivery_error" delivery-error
                                "failure_streak" (if failed? (inc (or (get current "failure_streak") 0)) 0))
                         (assoc-in ["repeat" "completed"] completed))]
         (cond-> current
           terminal? (assoc "state" "completed" "enabled" false "next_run_at" nil)
           (and next-error? (not terminal?)) (assoc "state" "error"))))
     now-iso)))

(defn finish-run!
  "The run-job post-turn section: build the output doc, deliver it down
  the job's lane, record jobs.json state, append the usage/runs audit
  lines, and answer the run summary. `result` is the loop's return
  (injected in cases); the live agent loop stays host-side."
  ([home job result started-iso finished-iso delivery-fn config for-lane]
   (let [final (get result :final)
         failed? (or (not= "completed" (get result :exit-reason))
                     (some-> final str str/trim (str/starts-with? "[CRON_FAILURE]")))
         silent? (= "[SILENT]" (some-> final str str/trim))
         err (when failed? (or (get-in result [:error :error]) (get result :exit-reason)))
         doc (output-doc job {:prompt (get result :prompt)
                              :response (if failed?
                                          (str (or final "") (when err (str "\n\n## Error\n\n```\n" err "\n```")))
                                          final)
                              :failed? failed?
                              :status-line (str/join "\n" (remove nil? [(when (get result :peer) (str "**Peer:** " (get result :peer)))
                                                                       (when (seq (get result :placement))
                                                                         (str "**Placement:** " (str/join " → " (map #(str (get % "step") ":" (get % "exit_reason")) (get result :placement)))))]))}
                      started-iso)
         f (save-output! home job doc started-iso)
         delivery-content (or final err "")
         delivery-error (if silent? nil (deliver-output home (get result :execution-id) job delivery-content failed? delivery-fn config for-lane finished-iso))]
     (record-run-state! home job started-iso failed? err delivery-error)
     (hio/append-text! (str home "/cron/usage_audit.jsonl")
       (str (hio/json-str {"ts" finished-iso "job_id" (get job "id") "fire_id" (hio/random-hex 8)
                           "prompt_tokens" (get-in result [:usage "prompt_tokens"]) "completion_tokens" (get-in result [:usage "completion_tokens"])
                           "total_tokens" (get-in result [:usage "total_tokens"]) "response_silent" silent?
                           "deliver_target" (delivery-lane job failed?) "delivery_error" delivery-error "model" (get result :model)
                           "duration_ms" (let [a (hio/parse-iso-ms started-iso) b (hio/parse-iso-ms finished-iso)]
                                           (if (and a b) (- b a) 0))
                           "error" err "engine" "itonami-agent"}) "\n"))
     (hio/append-text! (str home "/cron/itonami-runs.jsonl")
       (str (hio/json-str {"ts" finished-iso "job_id" (get job "id") "execution_id" (get result :execution-id) "manual" (boolean (get result :manual?))
                           "status" (cond failed? "error" delivery-error "delivery_failed" silent? "silent" :else "ok")
                           "exit_reason" (get result :exit-reason) "turns" (get result :turns) "provider" (get result :provider) "model" (get result :model)
                           "peer" (get result :peer) "receipt" (get result :receipt) "placement" (get result :placement)
                           "attempts" (mapv #(select-keys % [:provider :model :status :error]) (get result :attempts))
                           "output" f}) "\n"))
     {:status (cond failed? "error" delivery-error "delivery_failed" silent? "silent" :else "ok")
      :delivery-error delivery-error :output-file f :result result})))
