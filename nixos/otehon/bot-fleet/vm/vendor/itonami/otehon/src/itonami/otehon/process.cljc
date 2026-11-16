;; Notify-seam port of src/itonami/agent/process.cljk (JUN-1036 S5c):
;; the completion/warning notification surface the watcher loop and the
;; quiet linger path consume. Registries stay module atoms verbatim;
;; drains and consumed-checks take optional explicit state so shared
;; cases stay deterministic without touching global state.
(ns itonami.otehon.process
  (:require [clojure.string :as str]))

(def sessions
  "Live process sessions by id (the registry `get-session` polls)."
  (atom {}))

(def completion-consumed
  "Session ids whose completion the agent already saw via wait/log."
  (atom #{}))

(def completion-queue
  "Pending completion/watch/heartbeat events for drains."
  (atom []))

(def poll-observed
  "Session ids seen by a read-only poll observation."
  (atom #{}))

(def active-subagents
  "Live child subagents by subagent id, for attribution."
  (atom {}))

(def recent-subagents
  "Recently-finished child subagent stubs, for attribution."
  (atom {}))

(defn get-session
  "The registry lookup the watcher loop polls."
  [session-id]
  (get @sessions session-id))

(defn get-subagent-attribution
  " `{subagent_id goal delegation_id}` for a live or recent child, else nil."
  [task-id]
  (when (and (string? task-id) (not= "" task-id))
    (when-let [record (or (get @active-subagents task-id)
                         (some (fn [[id stub]] (when (= id task-id) stub))
                               @recent-subagents))]
      {"subagent_id" task-id
       "goal" (get record "goal")
       "delegation_id" (get record "delegation_id")})))

(defn is-completion-consumed?
  "The agent already has this result this turn (consumed via wait/log)."
  ([session-id] (is-completion-consumed? @completion-consumed session-id))
  ([consumed session-id] (contains? consumed session-id)))

(defn- child-notification?
  "Raw child process noise (`sub-…` owner) vs a delegation deliverable."
  [evt]
  (str/starts-with? (str (or (get evt "owner_task_id") (get evt "task_id") "")) "sub-"))

(def ^:private reason-status
  {"lost" "marked lost because the process backend disappeared"
   "failed_start" "failed to start"})

(defn- completion-status
  [evt]
  (let [reason (or (get evt "completion_reason") "exited")]
    (cond
      (= reason "killed") (str "terminated by " (or (get evt "termination_source") "Hermes"))
      (contains? reason-status reason) (get reason-status reason)
      (= 0 (get evt "exit_code" "?")) "completed normally"
      :else "exited")))

(defn short-command
  "The command collapsed onto one line, `...` past 80 chars."
  [command]
  (let [cmd (str/join " " (remove str/blank? (str/split (str (or command "")) #"\s+")))]
    (if (> (count cmd) 80)
      (str (subs cmd 0 77) "...")
      cmd)))

(defn process-completion-display-text
  "The compact UI title for one or more process completions."
  [events]
  (if (not= 1 (count events))
    (str (count events) " Background Processes Finished")
    (let [evt (first events)
          reason (or (get evt "completion_reason") "exited")
          exit-code (get evt "exit_code" "?")
          clean? (and (number? exit-code) (zero? exit-code))
          outcome (cond
                    (= reason "killed") "Terminated"
                    (contains? reason-status reason) (if (= reason "lost") "Lost" "Failed to Start")
                    :else (if clean? "Finished" "Failed"))
          cmd (short-command (get evt "command"))
          detail (if (and (not= reason "killed")
                          (not (contains? reason-status reason))
                          (not clean?))
                   (str " (exit " (if (nil? exit-code) "None" exit-code) ")")
                   "")]
      (if (and cmd (not= cmd ""))
        (str "Background Process " outcome detail ": " cmd)
        (str "Background Process " outcome detail)))))

(defn- delegation-attribution-line
  "The delegation attribution, generic when the registry aged out."
  ([evt] (delegation-attribution-line evt get-subagent-attribution))
  ([evt attribution-fn]
   (let [raw-owner (str (or (get evt "owner_task_id") (get evt "task_id") ""))]
     (when (child-notification? evt)
       (if-let [info (attribution-fn raw-owner)]
         (let [goal (str/trim (str (or (get info "goal") "")))
               goal (if (> (count goal) 120) (str (subs goal 0 117) "...") goal)
               deleg (get info "delegation_id")]
           (str "Started by subagent " raw-owner
                (when (and (some? deleg) (not= deleg "")) (str " of delegation " deleg))
                "."
                (when-not (= goal "") (str " Task: \"" goal "\""))))
         (str "Started by subagent " raw-owner " (delegate_task)."))))))

(defn format-age
  "Human-friendly elapsed string ('18m', '2h3m', '45s')."
  [seconds]
  (let [s (try (let [;; the cljs `double` will not even coerce a string
                     ;; (nbb answers the input); force a NaN-or-number
                     ;; like the legacy Math.trunc does
                     f #?(:cljs (js/Number (str seconds)) :default (double seconds))
                     f (max 0.0 f)
                     ;; NaN is self-equiv in CLJS (= ##NaN ##NaN), so the
                     ;; classic (not= f f) probe misses it there — check
                     ;; explicitly like the legacy (Number.isNaN).
                     nan? #?(:lpy (let [m (python/__import__ "math")] (boolean (.isnan m f)))
                              :clj (Double/isNaN f)
                              :cljs (js/Number.isNaN f))]
                 (when-not nan? (long f)))
               (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))]
    (cond
      (nil? s) "?"
      (< s 60) (str s "s")
      :else (let [m (quot s 60) r (rem s 60)]
              (if (< m 60)
                (str m "m" (when (pos? r) (str r "s")))
                (let [hh (quot m 60) mm (rem m 60)]
                  (str hh "h" (when (pos? mm) (str mm "m")))))))))

(defn heartbeat-output-text
  "A tick's output as the agent reads it — the cut marker, then the tail."
  [evt]
  (let [omitted (int (or (get evt "omitted") 0))
        output (str (or (get evt "output") ""))]
    (if (pos? omitted)
      (str "...(" omitted " earlier characters omitted)\n" output)
      output)))

(defn format-completion-notification
  "The agent-facing notice for one completion/watch/heartbeat event."
  [evt]
  (let [evt-type (get evt "type" "completion")]
    (if (contains? #{"watch_disabled" "watch_overflow_tripped" "watch_overflow_released"} evt-type)
      (str "[IMPORTANT: " (get evt "message" "") "]")
      (let [sid (get evt "session_id" "unknown")
            cmd (get evt "command" "unknown")
            attribution (if (get evt "handoff_note")
                          (str "Handed off to you by a subagent before it finished. Purpose: "
                               (get evt "handoff_note"))
                          (delegation-attribution-line evt))
            attribution (if attribution (str attribution "\n") "")]
        (cond
          (= "heartbeat" evt-type)
          (str "[Background process " sid " heartbeat #" (get evt "seq" "?")
               " — still running after " (format-age (or (get evt "elapsed") 0))
               " (next in " (get evt "interval" "?") "s when there is new output; you will also be told when it exits).\n"
               attribution "Command: " cmd "\nOutput since last heartbeat:\n"
               (heartbeat-output-text evt) "]")

          (= "watch_match" evt-type)
          (let [sup (or (get evt "suppressed") 0)]
            (str "[IMPORTANT: Background process " sid " matched watch pattern \""
                 (get evt "pattern" "?") "\".\n"
                 attribution "Command: " cmd "\nMatched output:\n" (get evt "output" "")
                 (when (pos? sup) (str "\n(" sup " earlier matches were suppressed by rate limit)"))
                 "]"))

          :else
          (let [exit (get evt "exit_code" "?")
                out (get evt "output" "")
                signal (if (contains? #{-15 143 "-15" "143"} exit) ", SIGTERM" "")
                out (cond
                      (and attribution (string? out) (> (count out) 600))
                      (str "...(output trimmed — subagent-owned process; see the "
                           "delegation's live transcript for full output)\n"
                           (subs out (- (count out) 600)))

                      (get evt "output_cut")
                      (str "...(first " (get evt "output_cut") " characters cut — process(action=\"log\", "
                           "session_id=\"" sid "\") has the full output)\n" out)

                      :else out)]
            (str "[IMPORTANT: Background process " sid " " (completion-status evt)
                 " (exit code " exit signal ").\n"
                 attribution "Command: " cmd "\nOutput:\n" out "]")))))))

(defn notification-batch-text
  "Consecutive completions enter the conversation as one batch."
  ([pairs] (notification-batch-text pairs @completion-consumed))
  ([pairs consumed]
   (let [live (vec (for [[evt text] pairs
                         :when (not (contains? consumed (get evt "session_id" "")))]
                     text))]
     (cond
       (empty? live) nil
       (= 1 (count live)) (first live)
       :else (str/join "\n\n"
                       (cons (str "[IMPORTANT: " (count live) " background processes completed. "
                                  "Treat these results as one batch and give one consolidated response; "
                                  "preserve failures and actionable results.]")
                             live))))))

(defn drain-notifications!
  "Pop pending events, returning `[event text]` pairs."
  [{:keys [session-key skip-poll-observed? surface-child? queue consumed poll-observed]
    :or {skip-poll-observed? true surface-child? false}}]
  (let [key (str (or session-key ""))
        q (or queue @completion-queue)
        consumed-set (or consumed @completion-consumed)
        poll-set (or poll-observed @poll-observed)
        kept (atom [])
        out (atom [])]
    (doseq [evt q]
      (let [evt-key (str (or (get evt "session_key") ""))]
        (cond
          (and (not (str/blank? evt-key)) (not (str/blank? key)) (not= evt-key key))
          (swap! kept conj evt)

          (and (= "completion" (get evt "type" "completion"))
               (or (contains? consumed-set (get evt "session_id"))
                   (and skip-poll-observed? (contains? poll-set (get evt "session_id")))))
          nil

          (and (child-notification? evt) (not surface-child?))
          nil

          :else (swap! out conj [evt (format-completion-notification evt)]))))
    (when (nil? queue) (reset! completion-queue @kept))
    @out))

(defn group-process-notifications
  "Group consecutive completions only; watches, heartbeats and delegations
  are barriers."
  [notifications]
  (let [groups (atom [])
        batch (atom [])]
    (doseq [[evt text] notifications]
      (if (= "completion" (get evt "type" "completion"))
        (swap! batch conj [evt text])
        (do (when (seq @batch)
              (swap! groups conj @batch)
              (reset! batch []))
            (swap! groups conj [[evt text]]))))
    (when (seq @batch) (swap! groups conj @batch))
    @groups))

(defn pending-notification-messages
  "This run's owned process notices: one message per group."
  [opts]
  (vec (keep (fn [group]
               (let [evt (first (first group))]
                 (if (= "completion" (get evt "type" "completion"))
                   (notification-batch-text group (or (:consumed opts) @completion-consumed))
                   (second (first group)))))
             (group-process-notifications (drain-notifications! opts)))))

(defn pending-notification-text
  "The pending messages joined with a blank line."
  [opts]
  (let [msgs (pending-notification-messages opts)]
    (when (seq msgs) (str/join "\n\n" msgs))))

(def oneshot-completion-wait-seconds-default
  "Fallback for `terminal.oneshot_completion_wait_seconds`."
  600.0)

(defn oneshot-completion-wait-seconds
  "Non-negative linger seconds from config, else the 600 s default."
  [config]
  (let [raw (get-in (or config {}) ["terminal" "oneshot_completion_wait_seconds"])
        v (cond
            (nil? raw) oneshot-completion-wait-seconds-default
            (number? raw) (double raw)
            (boolean? raw) (if raw 1.0 0.0)
            (string? raw) (let [s (str/trim (str raw))]
                            (cond
                              (re-matches #"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?" s)
                              (double (#?(:lpy python/float :clj Double/parseDouble :cljs js/Number) s))
                              (contains? #{"inf" "+inf" "-inf" "infinity" "+infinity" "-infinity"}
                                         (str/lower-case s))
                              (if (str/starts-with? s "-")
                                #?(:lpy (python/float "-inf") :clj Double/NEGATIVE_INFINITY :cljs js/-Infinity)
                                #?(:lpy (python/float "inf") :clj Double/POSITIVE_INFINITY :cljs js/Infinity))
                              :else oneshot-completion-wait-seconds-default))
            :else oneshot-completion-wait-seconds-default)
        nan? #?(:lpy (not= v v) :clj (Double/isNaN v) :cljs (js/isNaN v))]
    (if nan? oneshot-completion-wait-seconds-default (max v 0))))

(defn background-notifications-mode
  "The background notification mode: env override, else display config,
  stripped and lower-cased, falling back to \"concise\"."
  [env config]
  (let [env-mode (get env "HERMES_BACKGROUND_NOTIFICATIONS")
        mode (if (or (nil? env-mode) (= "" env-mode))
                 (let [raw (get-in config ["display" "background_process_notifications"])]
                   (cond
                     (false? raw) "off"
                     (and (some? raw) (not= raw "")) (str raw)
                     :else nil))
                 env-mode)
        mode (str/lower-case (str/trim (str (or mode "concise"))))]
    (if (contains? #{"concise" "all" "result" "error" "off"} mode)
      mode
      "concise")))

(defn surface-child-process-notifications?
  "`delegation.surface_child_process_notifications` (default false)."
  [config]
  (boolean (get-in config ["delegation" "surface_child_process_notifications"])))

(defn should-surface-notification
  "Raw child-process noise surfaces only when the profile opts in."
  [evt surface-child?]
  (or (not (child-notification? evt))
      (boolean surface-child?)))

(defn shorten-command-for-display
  "Collapse a shell command onto one line, capped for display."
  ([command] (shorten-command-for-display command 80))
  ([command limit]
   (let [one-line (str/join " " (str/split (str/trim (str (or command ""))) #"\s+"))]
     (if (> (count one-line) limit)
       (str (subs one-line 0 (dec limit)) "…")
       one-line))))

(defn redact-command
  "Mask inline credentials so they never reach transcripts. Public so
  the shared cases can pin the masking on every runner: token edges
  avoid word-boundary `\\b` (never matches on the bb runner) and use
  explicit guards instead."
  [command]
  (-> (str command)
      (str/replace #"://[^/@\s]+:[^/@\s]*@" "://[redacted]@")
      ;; The replacement fn takes the whole match (a vector on most
      ;; runners, the bare string on bb/SCI): never `$1` (unexpanded on
      ;; bb) and never `\b` (never matches on bb). Boundaries are
      ;; parsed by hand below (char sets only) for the same reason.
      (str/replace #"(?i)(?:^|[^A-Za-z0-9_])Bearer\s+[A-Za-z0-9._~+/=-]+"
                   (fn [m] (let [s (if (sequential? m) (first m) m)
                                  b (re-find #"^[^A-Za-z0-9_]" s)]
                              (str (or b "") "Bearer [redacted]"))))
      (str/replace #"(?i)(?:^|[?&\s])[A-Za-z0-9_-]*(?:token|api[-_]?key|secret|password|passwd|pwd)[A-Za-z0-9_-]*[=:\s]+[^\s\"']+"
                   (fn [m] (let [s (if (sequential? m) (first m) m)
                                  n (count s)
                                  pre-end (if (contains? #{\? \& \space \tab \newline \return} (nth s 0)) 1 0)
                                  sep? (fn [ch] (contains? #{\= \: \space \tab \newline \return} ch))]
                              (loop [i pre-end]
                                (if (>= i n)
                                  (str s "[redacted]")
                                  (if (sep? (nth s i))
                                    (let [j (loop [k (inc i)]
                                              (if (and (< k n) (sep? (nth s k))) (recur (inc k)) k))]
                                      (str (subs s 0 j) "[redacted]"))
                                    (recur (inc i))))))))))

(defn- redacted-output-tail
  "The last `limit` chars of the output buffer through the redactors."
  [session limit]
  (let [s @(:output session)]
    (if (= s "")
      ""
      (redact-command (subs s (max 0 (- (count s) limit)))))))

(defn format-concise-process-notification
  "The one-line status header, with duration and exit code."
  [session-id command exit-code output duration-seconds]
  (let [ok (contains? #{0 nil} exit-code)
        short-cmd (shorten-command-for-display command)
        details (cond-> []
                  (and (number? duration-seconds) (>= duration-seconds 0))
                  (conj (let [secs (long duration-seconds)]
                          (cond
                            (>= secs 3600) (str (quot secs 3600) "h " (quot (rem secs 3600) 60) "m")
                            (>= secs 60) (str (quot secs 60) "m " (rem secs 60) "s")
                            :else (str secs "s"))))
                  (not ok) (conj (str "exit " exit-code)))
        text (str (str/join " " (cond-> [(if ok "✅ Background task finished" "❌ Background task failed")]
                                 (not (str/blank? short-cmd)) (conj (str "— `" short-cmd "`"))))
                  (when (seq details) (str " (" (str/join ", " details) ")")))
        text (if (and (not ok) (not= "" (str (or output ""))))
               (let [tail-lines (->> (str/split (str/trim (str output)) #"\n")
                                     (remove str/blank?)
                                     (take-last 5))
                     tail (str/join "\n" tail-lines)
                     tail (if (> (count tail) 500) (subs tail (- (count tail) 500)) tail)]
                 (if (str/blank? tail)
                   text
                   (str text ". Last output:\n```\n" tail "\n```")))
               text)]
    (if ok text (str text "\nAsk me to rerun it or show the full log."))))

(defn format-process-final-message
  "Every mode shares the one-line header; raw-output modes append the
  bounded tail. `now-ms` supplies the wall clock."
  [session-id session notify-mode now-ms]
  (let [new-output (redacted-output-tail session 1000)
        started (:started-at session)
        dur (when (number? started) (max 0.0 (/ (- now-ms started) 1000)))
        command (redact-command (:command session))
        exit-code @(:exit-code session)]
    (if (= notify-mode "concise")
      (format-concise-process-notification session-id command exit-code new-output dur)
      (let [header (format-concise-process-notification session-id command exit-code "" dur)]
        (if (str/blank? (str/trim new-output))
          header
          (str header "\n\nFinal output:\n```\n" (str/trim new-output) "\n```"))))))

(defn format-process-running-message
  "The still-running update with the recent output tail."
  [session]
  (let [new-output (redacted-output-tail session 500)
        short-cmd (shorten-command-for-display (redact-command (:command session)))
        header (str "⏳ Background task still running"
                    (when-not (str/blank? short-cmd) (str " — `" short-cmd "`")))]
    (if (str/blank? (str/trim new-output))
      header
      (str header "\n\nRecent output:\n```\n" (str/trim new-output) "\n```"))))

(def ^:private watcher-route-fields
  ["session_key" "platform" "chat_type" "chat_id" "thread_id" "user_id" "user_name"])

(defn build-process-completion-event
  "The synthetic `completion` event for an agent-notify watcher."
  [watcher session session-id]
  (let [raw (redact-command @(:output session))
        out (if (> (count raw) 2000)
              (let [tail (subs raw (- (count raw) 2000))
                    nl (str/index-of tail "\n")
                    tail (if nl (subs tail (inc nl)) tail)]
                (str "[… output truncated — showing last " (count tail) " chars]\n" tail))
              raw)
        message-id (str/trim (str (or (get watcher "message_id") "")))
        started (:started-at session)]
    (cond-> (into {"type" "completion"
                   "session_id" session-id}
                  (for [k watcher-route-fields] [k (get watcher k "")]))
      true (assoc "owner_task_id" (or @(:owner-task-id session) "")
                  "task_id" (or @(:task-id session) "")
                  "message_id" (when-not (str/blank? message-id) message-id))
      (number? started) (assoc "started_at" (/ started 1000))
      true (assoc "command" (redact-command (:command session))
                  "exit_code" @(:exit-code session)
                  "completion_reason" @(:completion-reason session)
                  "termination_source" (or @(:termination-source session) "")
                  "output" out
                  "parent_session_id" (or (get watcher "parent_session_id")
                                          @(:parent-session-id session)
                                          "")))))

(def max-completion-injection-attempts
  "Watcher retries of a refused completion."
  8)

(def completion-injection-retry-max-delay
  "Cap for the watcher retry backoff."
  60)

(defn jittered-backoff
  "`min(base * 2^(attempt-1), max-delay)`, `attempt` 1-based; a 63+
  exponent or a non-positive base pins `max-delay`."
  [attempt base-delay max-delay]
  (let [exponent (max 0 (dec attempt))]
    (if (or (>= exponent 63) (<= base-delay 0))
      max-delay
      (min (reduce * (double base-delay) (repeat exponent 2.0)) max-delay))))
