(ns itonami.otehon.delivery
  "The cron delivery vocabulary: lane parsing and the run-outcome
  vocabulary. Verbatim from delivery.cljk; every function is pure, so
  the three runners share every byte by construction.

  A lane is one comma-separated part of a job's `deliver` value. `local`
  (the default) never sends — the output record is the delivery. Every
  other lane resolves to a delivery adapter at fire time."
  (:require [clojure.string :as str]))

(def bot-chat-platform "bot-chat")

(def routing-tokens
  "Routing tokens resolve at fire time (a job outlives platform wiring).
  `all` = every configured platform; `bot-chat` is NOT in `all` (costs a
  turn)."
  #{"all"})

(defn normalize-deliver-value
  "Hermes _normalize_deliver_value: the canonical comma-separated string;
  \"local\" when falsy. Lists are flattened — str([\"telegram\"]) would yield
  \"['telegram']\" and fail resolution silently."
  [deliver]
  (cond
    (or (nil? deliver) (= deliver "")) "local"
    (sequential? deliver) (let [parts (remove str/blank? (map #(str/trim (str %)) deliver))]
                            (if (seq parts) (str/join "," parts) "local"))
    :else (str deliver)))

(defn lanes
  "The normalized deliver value as distinct lane names."
  [deliver]
  (->> (str/split (normalize-deliver-value deliver) #",")
       (map str/trim)
       (remove str/blank?)
       distinct
       vec))

(defn parse-bot-chat-token
  "Hermes parse_bot_deliver_token: `bot-chat[:<name>]` -> \"\" (own
  profile) or the profile name; nil for any other lane.
  Case-insensitive; the name is normalized by the profile layer."
  [part]
  (let [raw (str/trim (str part))
        lower (str/lower-case raw)]
    (cond
      (= lower bot-chat-platform) ""
      (str/starts-with? lower (str bot-chat-platform ":"))
      (str/trim (subs raw (inc (count bot-chat-platform))))
      :else nil)))

;; ---------------------------------------------------------------- adapters

(def adapters
  "lane -> (fn [job content opts] -> promise of nil (delivered) or an error
  string). Platform adapters of the messaging gateway register here; a
  job-run's injected :delivery-fn is the fallback for any lane."
  (atom {}))

(defn register-adapter!
  "A lane -> (fn [job content opts] -> nil (delivered) or an error
  string). Platform adapters register here; a job-run's :delivery-fn is
  the fallback for any lane."
  [lane f]
  (swap! adapters assoc (str lane) f)
  nil)

(defn adapter-for
  "The registered adapter for one lane, or nil."
  [lane]
  (get @adapters (str lane)))

;; ---------------------------------------------------------------- outcome

(defn classify-outcome
  "Hermes _classify_delivery_outcome, same vocabulary:
  failed | queued | suppressed | not_configured | delivered | suppressed_acked.
  `incident-acked` is the repeat-alert gate's input (failure ping withheld
  for a known signature); with the gate unwired it is passed as false."
  [{:keys [delivery-error should-deliver unresolved-origin normalized-deliver
           incident-acked success delivery-queued notification-suppressed]
    :or {incident-acked false notification-suppressed false}}]
  (cond
    delivery-error "failed"
    (and should-deliver delivery-queued) "queued"
    notification-suppressed "suppressed"
    (and should-deliver unresolved-origin) "not_configured"
    (and should-deliver (not= "local" normalized-deliver)) "delivered"
    (and incident-acked (not success)) "suppressed_acked"
    :else "suppressed"))
