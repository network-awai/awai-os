;; Quiet-notify port of src/itonami/agent/quiet.cljk (JUN-1036 S5c):
;; warning-notification admission plus the quiet linger loop. Waits and
;; drains ride injected fns (the live registry waits stay host-side).
(ns itonami.otehon.quiet
  (:require [clojure.string :as str]
            [itonami.otehon.process :as process]))

(def max-quiet-notify-rounds
  "Cap for the quiet follow-up loop."
  8)

(defn- norm-suppress-warning-notifications
  [v]
  (if (boolean? v)
    v
    (contains? #{"true" "1" "yes" "on"} (str/lower-case (str/trim (str v))))))

(defn- configured-suppress-warning-notifications
  [config platform]
  (let [display (get config "display")
        display (if (map? display) display {})
        platforms (get display "platforms")
        override (when (map? platforms)
                   (let [entry (get platforms (str platform))]
                     (when (map? entry)
                       (get entry "suppress_warning_notifications"))))]
    (if (some? override)
      override
      (get display "suppress_warning_notifications"))))

(defn warning-notifications-enabled?
  "A diagnostic-classified send runs only when the platform policy shows
  warning notifications."
  [platform config]
  (let [configured (configured-suppress-warning-notifications config platform)]
    (if (some? configured)
      (not (norm-suppress-warning-notifications configured))
      true)))

(defn diagnostic-process-event?
  "True for diagnostic-only events that never wake a muted run alone."
  [evt]
  (or (boolean (get evt "task_failure_notice"))
      (contains? #{"watch_disabled" "watch_overflow_tripped" "watch_overflow_released"}
                 (get evt "type"))))

(defn diagnostic-only-wake-muted?
  "A wake of only diagnostic events stays muted."
  [events config]
  (and (seq events)
       (every? diagnostic-process-event? events)
       (not (warning-notifications-enabled? "cli" config))))

(defn quiet-notify-linger-seconds
  "The shared linger budget for the quiet follow-up loop."
  [config]
  (process/oneshot-completion-wait-seconds config))

(defn turn-failed?
  "Hard failure or cancellation counts as failed; unfinished does not."
  [r]
  (or (some? (:error r)) (= "interrupted" (:exit-reason r))))

(defn continue-quiet-notify-completions!
  "Drain pending completions and run one follow-up turn per non-empty
  drain, until the linger budget or the round cap runs out. `wait-fn`
  and `drain-fn` are injected; the live registry fns stay host-side."
  [session-key run-turn {:keys [config linger-budget max-rounds surface-child? wait-fn drain-fn now-fn]
                         :or {max-rounds max-quiet-notify-rounds}}]
  (let [now (or now-fn (fn [] (throw (ex-info "quiet: now-fn required" {}))))
        wait (or wait-fn (fn [_ _] nil))
        drain (or drain-fn (fn [_] []))
        budget (if (some? linger-budget) linger-budget (quiet-notify-linger-seconds config))
        deadline (+ (now) (* 1000 (max budget 0)))
        child? (if (some? surface-child?)
                 (boolean surface-child?)
                 (boolean (get-in config ["delegation" "surface_child_process_notifications"])))]
    (loop [rounds 0 last nil]
      (if (>= rounds max-rounds)
        last
        (let [w (wait {:timeout (/ (max (- deadline (now)) 0) 1000)}
                      {:session-key (str session-key) :surface-child? child?})
              pairs (drain {:session-key (str session-key) :surface-child? child?})
              texts (vec (keep second pairs))]
          (if (empty? texts)
            last
            (let [r (run-turn (str/join "\n\n" texts))]
              (if (seq (get w "timed_out"))
                r
                (recur (inc rounds) r)))))))))

(defn oneshot-exit-linger!
  "Wait out pending completions at one-shot exit, unless the quiet loop
  already consumed the budget."
  [config linger-done? & [{:keys [wait-fn]}]]
  (if linger-done?
    nil
    (let [wait (or wait-fn (fn [_] nil))]
      (try (wait {:config config}) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))
      nil)))
