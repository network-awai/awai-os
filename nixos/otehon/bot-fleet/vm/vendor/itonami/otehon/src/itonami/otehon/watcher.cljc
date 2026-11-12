;; Watcher port of src/itonami/agent/watcher.cljk (JUN-1036 S5c): the
;; gateway process-watcher's delivery loop. The legacy parks promises;
;; the port runs the same decision tree synchronously — the observable
;; contract is the hook call sequence (`:send!` chat pushes, `:enqueue!`
;; completion injections with the Hermes `delivered is not False`
;; rule, `:warn-fn` notices, `:sleep-fn` waits), all injected. `:send!`,
;; `:enqueue!`, `:sleep-fn` and `:now-fn` have legacy-shaped defaults;
;; `:session-fn` defaults to the process registry read.
(ns itonami.otehon.watcher
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]
            [itonami.otehon.process :as process]
            [itonami.otehon.quiet :as quiet]))

(defn default-present!
  "Present a notice when the platform policy shows warnings."
  [config render platform diagnostic]
  (if (and diagnostic (not (quiet/warning-notifications-enabled? platform config)))
    false
    (do (render) true)))

(defn run-process-watcher!
  "Poll the registry session until it is gone or its exit is handled.
  Answers nil like the legacy; a tripped `:max-ticks` guard answers
  `{:status :max-ticks}` so a stuck script can never wedge the harness."
  [watcher {:keys [config env session-fn send! enqueue! launching-turn-active?
                   admission-recheck present! sleep-fn now-fn consumed?-fn
                   surface-child? warn-fn max-ticks]
            :or {enqueue! (fn [_ _] nil)
                 launching-turn-active? (fn [_ _] false)
                 sleep-fn (fn [_] nil)
                 max-ticks 10000
                 env {}
                 warn-fn (fn [& _] nil)}
            :as opts}]
  (let [session-id (get watcher "session_id")
        interval (double (get watcher "check_interval" 5))
        session-fn (or session-fn process/get-session)
        now-fn (or now-fn hio/now-ms)
        consumed?-fn (or consumed?-fn process/is-completion-consumed?)
        sleep-fn sleep-fn
        platform-name (str (or (get watcher "platform") ""))
        chat-id (get watcher "chat_id" "")
        thread-id (get watcher "thread_id" "")
        agent-notify (boolean (get watcher "notify_on_complete" false))
        notify-mode (process/background-notifications-mode env config)
        silent (and (= notify-mode "off") (not agent-notify))
        surface-child (if (contains? opts :surface-child?)
                        (boolean surface-child?)
                        (process/surface-child-process-notifications? config))
        present! (or present!
                     (fn [render platform diagnostic]
                       (default-present! config render platform diagnostic)))
        mode-fires? (fn [exit-code]
                      (or (contains? #{"concise" "all" "result"} notify-mode)
                          (and (= notify-mode "error")
                               (not (contains? #{0 nil} exit-code)))))
        push! (fn [message-text]
                (when (and (fn? send!) (not (= "" (str chat-id))))
                  (send! platform-name chat-id thread-id message-text watcher)))
        text-notice! (fn []
                       (when-not (consumed?-fn session-id)
                         (let [s (session-fn session-id)]
                           (when (and s (mode-fires? @(:exit-code s)))
                             (let [message-text (process/format-process-final-message
                                                 session-id s notify-mode (now-fn))]
                               (present! (fn [] (push! message-text))
                                         platform-name
                                         (not (contains? #{0 nil} @(:exit-code s))))))))
                       nil)]
    (loop [retry-interval interval
           last-output-len 0
           completion-attempts 0
           ticks 0]
      (if (>= ticks max-ticks)
        {:status :max-ticks :ticks ticks}
        (do (sleep-fn retry-interval)
            (let [session (session-fn session-id)]
              (if (nil? session)
                nil
                (let [surface (process/should-surface-notification
                               {"owner_task_id" @(:owner-task-id session)
                                "task_id" @(:task-id session)}
                               surface-child)
                      exited? (= :exited @(:state session))]
                  (cond
                    (not surface)
                    (if exited?
                      nil
                      (recur interval last-output-len completion-attempts (inc ticks)))

                    silent
                    (if exited?
                      nil
                      (recur interval last-output-len completion-attempts (inc ticks)))

                    :else
                    (let [current-output-len (count @(:output session))
                          has-new-output (> current-output-len last-output-len)]
                      (if-not exited?
                        (do
                          (when (and has-new-output (= notify-mode "all") (not agent-notify))
                            (push! (process/format-process-running-message session)))
                          (recur interval current-output-len completion-attempts (inc ticks)))
                        (if (and agent-notify (not (consumed?-fn session-id)))
                          (let [completion-evt (process/build-process-completion-event
                                                watcher session session-id)
                                synth-text (process/format-completion-notification completion-evt)]
                            (if (= synth-text "")
                              nil
                              (let [turn-busy (boolean (launching-turn-active? platform-name watcher))
                                    delivered (enqueue! synth-text completion-evt)]
                                (if (not (false? delivered))
                                  (do
                                    (when (and turn-busy (mode-fires? @(:exit-code session)))
                                      (push! (process/format-process-final-message
                                              session-id session "concise" (now-fn))))
                                    nil)
                                  (let [attempts (inc completion-attempts)]
                                    (if (< attempts process/max-completion-injection-attempts)
                                      (recur (process/jittered-backoff
                                              attempts (* (max interval 1) 2)
                                              process/completion-injection-retry-max-delay)
                                             last-output-len
                                             attempts
                                             (inc ticks))
                                      (let [committed (and (some? admission-recheck)
                                                           (try (boolean (admission-recheck completion-evt))
                                                                (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ false)))]
                                        (if committed
                                          nil
                                          (do
                                            (warn-fn (str "Process watcher: completion for " session-id
                                                          " was refused " attempts " times; falling back to the "
                                                          "notify_mode=" notify-mode " notice"))
                                            (text-notice!))))))))))
                          (text-notice!)))))))))))))
