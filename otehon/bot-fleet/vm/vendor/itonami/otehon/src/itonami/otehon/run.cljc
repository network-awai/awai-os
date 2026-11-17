(ns itonami.otehon.run
  "Running one cron job for real, planned without running it.

  Ported from src/itonami/agent/cron.cljk (build-prompt, output-doc,
  save-output!, record-run-state!) but pure: the script result, the prior
  outputs, the notepad section and the clock are caller inputs, and the
  inference turn itself stays the host's job (the host calls the murakumo
  rail the way the legacy executor does). What this returns is the data the
  host needs to finish the run the way the legacy route would:

  - :planned — the full prompt, inference target, toolsets, decisions and
    steps; the host runs the turn, then renders the output document.
  - :ok / :silent — a no_agent job resolved from the script alone, with the
    output document and the jobs.json record update already rendered.
  - :held / :refused — the same gates dry-run applies.

  Nothing is executed, called or written here: :side-effects :none. Monitor
  sources, delivery lanes and the executions ledger stay a later slice."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]
            [itonami.otehon.profile :as profile]
            [itonami.otehon.rail :as rail]
            [itonami.otehon.yakuwari :as yakuwari]
            [itonami.otehon.cron :as cron]
            [itonami.otehon.tick :as tick]))

(defn deliver-lanes
  "A job's deliver value as distinct lane names (port of delivery/normalize:
  nil or blank means [\"local\"])."
  [deliver]
  (let [parts (if (str/blank? (str deliver)) ["local"] (str/split (str deliver) #","))]
    (vec (distinct (remove str/blank? (map str/trim parts))))))

(defn apply-order
  "The order in which the host applies one finished run, with idempotency
  keys (JUN-1021, owner choice: order-only contract). Bodies stay host-side:
  the ledger append and the delivery lanes carry names and keys, not
  payloads. The key pins job+stamp+status, so re-applying the same finished
  run is a no-op for the host and a new stamp is a new run. These outputs
  are reference values for the native route (AWAI-60, AWAI-131), never its
  fallback."
  [{:keys [job-id stamp status output-path record deliver]}]
  (let [key (str job-id "/" stamp "/" status)]
    {:idempotency-key key
     :order [:write-output :apply-record :append-ledger :deliver]
     :steps [{:step :write-output :path output-path :key (str key "/output")}
             {:step :apply-record :record record :key (str key "/record")}
             {:step :append-ledger :job job-id :stamp stamp :key (str key "/ledger")}
             {:step :deliver :lanes (deliver-lanes deliver) :key (str key "/deliver")}]}))

(def silent-token "[SILENT]")
(def failure-token "[CRON_FAILURE]")

(defn- refuse [reason & [more]]
  (merge {:status :refused :reason reason} more))

(defn build-prompt
  "The prompt a run would send. `script` is nil (no script on the job) or
  {:ok? :output}: the host's script result. Blank script output and
  :wake? false (the last line's wakeAgent, parsed by the host) skip the
  turn the way the legacy route does."
  [job script {:keys [notepad linked monitor-context]}]
  (let [skills (let [raw (get job "skills")]
                 (cond (string? raw) [raw]
                       (seq raw) (vec raw)
                       (get job "skill") [(get job "skill")]
                       :else []))
        skills-hint (when (seq skills)
                      (str "\n\n## Required skills\nLoad and follow these skills before working: "
                           (str/join ", " skills) ". Use skill_view for each skill."))
        base (str (or notepad "")
                  (get job "prompt") (or skills-hint "")
                  (when linked (str "\n\n" linked))
                  (when monitor-context (str "\n\n" monitor-context)))]
    (if (some? (get job "script"))
      (cond
        (nil? script) [nil "script/pending"]
        (false? (:wake? script)) [nil "Script gate returned `wakeAgent=false`"]
        (and (:ok? script) (str/blank? (:output script))) [nil "script produced no output"]
        :else [(str (cron/cron-hint job)
                    "## " (if (:ok? script) "Script Output" "Script Error") "\n"
                    (if (:ok? script)
                      "The following data was collected by a pre-run script. Use it as context for your analysis."
                      "The data-collection script failed. Report this to the user.")
                    "\n\n```\n" (:output script) "\n```\n\n" base)
               nil])
      [(str (cron/cron-hint job) base) nil])))

(defn output-doc
  "The cron/output document, the legacy route's shape. `run-at` is the
  host's display time."
  [job {:keys [prompt response failed? status-line]} run-at]
  (str "# Cron Job: " (get job "name") (when failed? " (FAILED)") "\n\n"
       "**Job ID:** " (get job "id") "\n"
       "**Run Time:** " run-at "\n"
       "**Schedule:** " (or (get job "schedule_display") (get-in job ["schedule" "display"])) "\n"
       (when-not (str/blank? (str status-line)) (str status-line "\n"))
       "**Engine:** itonami-agent\n"
       "\n## Prompt\n\n" (or prompt "") "\n\n## Response\n\n"
       (if (str/blank? (str response)) "(No response generated)" response) "\n"))

(defn output-path
  "Where the host saves the output document. `stamp` is the host's
  YYYY-MM-DD_HH-MM-SS stamp."
  [job stamp]
  (str "cron/output/" (get job "id") "/" stamp ".md"))

(defn record-update
  "The jobs.json fields a finished run writes: the repeat count, whether
  the job is terminal, and the next fire time. The host applies them."
  [job now]
  (let [completed (inc (or (get-in job ["repeat" "completed"]) 0))
        times (get-in job ["repeat" "times"])
        kind (get-in job ["schedule" "kind"])]
    {:repeat-completed completed
     :terminal? (boolean (or (and (number? times) (pos? times) (>= completed times))
                             (= "once" kind)))
     :next (tick/next-run job now)}))

(defn run-plan
  "Plan one real run of `job-ref` without running it. `script` is the host's
  pre-run script result (nil when the host has not run it yet); `now` is
  {:iso :parts}; `stamp` and `run-at` are the host's file stamp and display
  time; :notepad/:linked/:monitor-context are the host-read context blocks."
  [prof job-ref {:keys [capabilities script now stamp run-at notepad linked monitor-context]}]
  (let [problems (profile/check prof)
        errs (profile/errors problems)
        {:keys [config jobs manifest yakuwari]} prof
        job (cron/find-job jobs job-ref)]
    (cond
      (not= "itonami" (:runtime prof))
      (refuse "rail/itonami-without-manifest" {:detail "a Hermes profile; itonami-agent runs itonami profiles only"})

      (seq errs) (refuse "profile/invalid" {:problems errs})

      (false? (:cron? manifest)) (refuse "profile/cron-disabled")

      (nil? job) (refuse "job/not-found" {:job job-ref})

      (not (cron/active? job)) (refuse "job/inactive" {:job (get job "id") :state (get job "state")})

      :else
      (let [target (rail/resolve-job config job)
            verdict (rail/inference-verdict (:inference manifest) target)
            decisions (mapv #(yakuwari/decide yakuwari (:authority manifest) %) capabilities)
            worst (cond (some #(= :blocked (:decision %)) decisions) :blocked
                        (some #(not= :autonomous (:decision %)) decisions) :held
                        :else nil)
            base {:profile (:name prof)
                  :job {:id (get job "id") :name (get job "name")
                        :schedule (cron/schedule-display job)
                        :script (get job "script")}
                  :inference (assoc target :verdict verdict)
                  :toolsets (cron/tool-sets-for config job)
                  :reasoning-effort (cron/effective-reasoning-effort config job)
                  :decisions decisions
                  :steps (cron/plan job)
                  :side-effects :none}]
        (cond
          (not= verdict "rail/ok") (merge base (refuse verdict))
          (= worst :blocked) (merge base (refuse "authority/blocked"))
          (= worst :held) (merge base {:status :held :reason "authority/needs-owner"})

          :else
          (let [[prompt skip] (build-prompt job script {:notepad notepad :linked linked
                                                        :monitor-context monitor-context})]
            (cond
              (= skip "script/pending")
              (merge base {:status :planned :reason "script/pending" :needs [:script]
                           :exec [{:id "script"
                                   :request (hio/script-request (get job "script")
                                                              {:workdir (get job "workdir")})}]})
              (some? skip)
              (let [doc (output-doc job {:prompt "" :response silent-token
                                         :status-line (str "**Status:** " skip)} run-at)]
                (merge base {:status :silent :reason skip
                             :output-doc doc
                             :output-path (output-path job stamp)
                             :record (record-update job now)
                             :exec []}))

              (true? (get job "no_agent"))
              (let [[ok? out] (if (some? (get job "script"))
                                [(:ok? script) (:output script)]
                                [true (get job "prompt")])
                    final (if ok? (if (str/blank? (str out)) silent-token out)
                              (str failure-token " " out))]
                (merge base {:status (if (and ok? (not= final silent-token)) :ok :silent)
                             :final final
                             :exit-reason (if ok? "completed" "script_error")
                             :output-doc (output-doc job {:prompt prompt :response final
                                                          :failed? (not ok?)} run-at)
                             :output-path (output-path job stamp)
                             :record (record-update job now)
                             :exec []}))

              :else
              (merge base {:status :planned :prompt prompt
                           :record-next (tick/next-run job now)
                           :exec [{:id "inference"
                                   :request (hio/inference-request
                                             {:target (assoc target :verdict verdict)
                                              :prompt prompt
                                              :toolsets (:toolsets base)
                                              :reasoning-effort (cron/effective-reasoning-effort config job)
                                              :decisions decisions})}]}))))))))
