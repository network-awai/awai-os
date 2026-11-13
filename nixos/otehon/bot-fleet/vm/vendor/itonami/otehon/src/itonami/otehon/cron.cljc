(ns itonami.otehon.cron
  "Hermes cron/jobs.json semantics needed to plan one run, without running it.

  Ported from src/itonami/agent/cron.cljk (cron-hint, active?, the cron
  toolset rule, the reasoning-effort pin). Nothing here executes a script,
  calls inference or writes a file: dry-run returns the plan."
  (:require [clojure.string :as str]))

(defn cron-hint [job]
  (let [lane (or (get job "deliver") "local")]
    (str "[IMPORTANT: You are running as a scheduled cron job. "
         "DELIVERY: The configured lane is '" lane "'. Return your report "
         "as the final response; do NOT use send_message or try to deliver "
         "the output yourself. The scheduler stores local-lane output in the "
         "cron output record and sends non-local lanes through its configured "
         "delivery adapter. A missing adapter is recorded as delivery_failed. "
         "SILENT: If there is genuinely nothing new to report, respond "
         "with exactly \"[SILENT]\" (nothing else) to suppress delivery. "
         "[SILENT] is a literal ASCII control token — never translate or "
         "rephrase it, whatever language the rest of your answer uses. "
         "Never combine [SILENT] with content — either report your "
         "findings normally, or say [SILENT] and nothing more. "
         "FAILURE: If a delegated child fails and this cron run must be "
         "recorded as failed, put [CRON_FAILURE] on the first line by itself, "
         "then explain the child failure on following lines. "
         "RECURSION: This is a run of an EXISTING scheduled job — execute "
         "the task now. NEVER create or update a cron job because of "
         "recurring or future-schedule language in the task prompt below; "
         "treat phrasing like \"each Monday\" or \"every day at 9\" as "
         "context for this run, not as a request to schedule another job.]\n\n")))

(defn jobs-of
  "The job list of a parsed cron/jobs.json ({\"jobs\": [...]}; a bare list is
  read the same way)."
  [doc]
  (cond (map? doc) (vec (get doc "jobs" []))
        (sequential? doc) (vec doc)
        :else []))

(defn find-job [jobs id-or-name]
  (or (first (filter #(= id-or-name (get % "id")) jobs))
      (first (filter #(= id-or-name (get % "name")) jobs))))

(defn active? [job]
  (and (not (false? (get job "enabled")))
       (not (contains? #{"paused" "completed" "removed"} (get job "state")))))

(defn tool-sets-for
  "The selected cron toolsets after Hermes' cron-only deny rules: messaging
  and clarify need a user; cronjob is off unless cron.allow_agent_scheduling."
  [config job]
  (let [requested (if (some? (get job "enabled_toolsets"))
                    (get job "enabled_toolsets")
                    (or (seq (get-in config ["platform_toolsets" "cron"])) ["hermes-cron"]))
        agent-disabled (get-in config ["agent" "disabled_toolsets"])
        agent-disabled (if (string? agent-disabled) [agent-disabled] agent-disabled)
        disabled (into #{"messaging" "clarify"}
                       (concat (when-not (true? (get-in config ["cron" "allow_agent_scheduling"]))
                                 ["cronjob"])
                               (filter string? agent-disabled)))]
    (vec (remove #(contains? disabled %) requested))))

(defn execution-disabled
  "Port of tools/execution-disabled-toolsets: the profile denylist
  (agent.disabled_toolsets, a string or a seq) plus the platform \"cron\"
  denies (messaging, clarify, and cronjob unless cron.allow_agent_scheduling)."
  [config platform]
  (let [configured (get-in config ["agent" "disabled_toolsets"])
        configured (if (string? configured) [configured] configured)]
    (vec (distinct
          (concat (filter string? configured)
                  (when (= platform "cron")
                    (concat ["messaging" "clarify"]
                            (when-not (true? (get-in config ["cron" "allow_agent_scheduling"]))
                              ["cronjob"]))))))))

(defn select-toolsets
  "The native loop's toolset gating as data (JUN-1020, turn-gate extension).
  `requested` defaults to [\"hermes-cli\"] (a -t / toolsets opt overrides it);
  a profile denylist can never be re-added, so :denied always wins. `known`
  is the host-supplied tool catalog; names outside it (with the native
  mcp-<base> rule: mcp-foo counts when foo is known) land in :unknown, which
  the caller refuses. Without `known` no unknown detection runs."
  [{:keys [requested disabled known platform]}]
  (let [requested (vec (or (seq requested) ["hermes-cli"]))
        denied-set (set (or (seq disabled) []))
        denied (filterv #(contains? denied-set %) requested)
        known? (fn [n]
                 (or (contains? (set known) n)
                     (and (string? n) (str/starts-with? n "mcp-")
                          (contains? (set known) (subs n 4)))))
        unknown (if (some? known) (filterv #(not (known? %)) requested) [])
        selected (filterv #(and (not (contains? denied-set %))
                                (not (contains? (set unknown) %)))
                          requested)]
    {:requested requested :selected selected :denied denied :unknown unknown
     :platform platform}))

(def reasoning-efforts #{"none" "minimal" "low" "medium" "high" "xhigh" "max" "ultra"})

(defn effective-reasoning-effort [config job]
  (let [pinned (get job "reasoning_effort")]
    (if (contains? reasoning-efforts pinned)
      pinned
      (get-in config ["agent" "reasoning_effort"]))))

(defn- skills-of [job]
  (let [raw (get job "skills")]
    (cond (string? raw) [raw]
          (seq raw) (vec raw)
          (get job "skill") [(get job "skill")]
          :else [])))

(defn plan
  "The steps a run of `job` would take, in order. Each step is data; none
  is executed."
  [job]
  (let [script (get job "script")
        no-agent? (true? (get job "no_agent"))]
    (vec (concat
          (when script [{:step :run-script :script script :executed false}])
          (when-not no-agent?
            [{:step :build-prompt :hint-lane (or (get job "deliver") "local")
              :skills (skills-of job) :executed false}
             {:step :inference :executed false}])
          [{:step :save-output :dir (str "cron/output/" (get job "id")) :executed false}]))))

(defn prompt-preview
  "The head of the prompt the run would send (the hint plus the job prompt),
  cut to `n` characters; the script output is not known in a dry run."
  [job n]
  (let [p (str (cron-hint job) (get job "prompt"))]
    (if (> (count p) n) (subs p 0 n) p)))

(defn schedule-display [job]
  (or (get job "schedule_display") (get-in job ["schedule" "display"])
      (str/trim (str (get-in job ["schedule" "expr"])))))
