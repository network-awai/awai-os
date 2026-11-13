;; Messaging gateway transport surface (Otehon port of the pure core of
;; src/itonami/agent/gateway.cljk: platform values, delivery transports,
;; adapter resolution, the watcher send seam and the completion fan-in).
;;
;; Resolution is pure data over injected adapter/config maps; the send
;; fns themselves are called synchronously (shared cases pass stubs —
;; the live promise transport stays host-side). Fan-in flushes run
;; explicitly (no background timers); the serve loop and the live
;; session-automation store stay host-side (see COMPAT.md).
(ns itonami.otehon.gateway
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]
            [itonami.otehon.process :as process]))

(def relay-platform "relay")

(defn platform-value [platform]
  (let [raw (if (map? platform) (or (:value platform) platform) platform)]
    (str/lower-case (str/trim (str (or raw ""))))))

(defn non-conversational-metadata [metadata platform]
  (if (not= (platform-value platform) "discord")
    metadata
    (assoc (or metadata {}) "non_conversational" true)))

(defn delivery-transport [adapter config transport-platform]
  {:adapter adapter
   :config config
   :transport-platform (platform-value transport-platform)})

(defn relay? [transport]
  (= relay-platform (platform-value (:transport-platform transport))))

(defn- platform-enabled? [config]
  (or (nil? config) (boolean (:enabled config))))

(defn resolve-delivery-transport
  "A concrete native adapter always wins; Relay is eligible only when
  its transport advertises that it fronts the logical platform. An
  explicitly disabled native adapter never shadows an enabled Relay
  transport. Answers the DeliveryTransport or nil."
  [platform platforms adapters]
  (let [p (platform-value platform)
        native (get adapters p)
        relay (get adapters relay-platform)
        fronts (get relay :fronts-platform)]
    (cond
      (and (some? native) (platform-enabled? (get platforms p)))
      (delivery-transport native (get platforms p) p)

      (and (some? relay)
           (platform-enabled? (get platforms relay-platform))
           (fn? fronts)
           (boolean (fronts platform)))
      (delivery-transport relay (get platforms relay-platform) relay-platform)

      :else nil)))

(defn resolve-injection-adapter
  "The alias-aware transport resolver first (one Relay fronts N logical
  platforms; native wins), the literal platform-value scan as fallback."
  [platforms adapters platform-name]
  (or (:adapter (resolve-delivery-transport platform-name platforms adapters))
      (get adapters platform-name)))

(defn- warn-delivery-error [warn-fn e]
  (warn-fn (str "Watcher delivery error: " (or (ex-message e) (str e)))))

(defn send-watcher-message!
  "Resolve the platform's injection adapter and, `if adapter and
  chat_id`, send with non-conversational metadata. A missing adapter or
  a blank chat id sends nothing. Delivery errors are suppressed through
  warn-fn and answer nil; otherwise answers the send result."
  [{:keys [platforms adapters warn-fn]} platform-name chat-id thread-id message-text]
  (let [adapter (resolve-injection-adapter platforms adapters platform-name)
        warn (or warn-fn (fn [_]))]
    (when (and (some? adapter) (not= "" (str chat-id)))
      (let [send-meta (when-not (= "" (str thread-id)) {"thread_id" thread-id})
            metadata (non-conversational-metadata send-meta platform-name)]
        (try
          ((:send adapter) (str chat-id) (str message-text) metadata)
          (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
            (warn-delivery-error warn e)
            nil))))))

(defn send-hook
  "The live `:send!` binding shape over this adapter surface."
  [surface]
  (fn [platform-name chat-id thread-id message-text watcher]
    (send-watcher-message! surface platform-name chat-id thread-id message-text)))

;; ---------------------------------------------------------------- completion fan-in

(defn send-transport!
  "Send through this transport while preserving the logical platform —
  a relay dispatches `send-for-platform`, a native adapter its own send."
  [transport logical-platform chat-id content metadata]
  (if (relay? transport)
    ((:send-for-platform (:adapter transport)) logical-platform chat-id content metadata)
    ((:send (:adapter transport)) chat-id content metadata)))

(def ^:private completion-batch-key-fields
  ["session_key" "platform" "chat_type" "chat_id" "thread_id" "user_id"])

(defn event-route-key
  "The batch key of one completion event over `fields` — every field
  stringified, empty for a missing one."
  [evt fields]
  (mapv (fn [field] (str (or (get evt field) ""))) fields))

(defn completion-delivery-identity
  "A producer-stable identity when one is available: delegation UUIDs
  (an interim per-task failure notice is its own producer event);
  liveness/watch events ride their `event_id`; a process `completion`
  includes the persisted spawn epoch so a reused session id is a
  distinct incarnation; legacy events without `started_at` deliver
  undeduplicated (nil)."
  [evt]
  (let [evt-type (str (or (get evt "type") ""))]
    (cond
      (= evt-type "async_delegation")
      (let [producer-id (str (or (get evt "delegation_id") ""))]
        (cond
          (= producer-id "") nil
          (get evt "task_failure_notice")
          (let [task-idx (get (or (first (get evt "results")) {}) "task_index" "")]
            [evt-type producer-id (str "task_failure:" (if (nil? task-idx) "None" task-idx))])
          :else [evt-type producer-id ""]))

      (and (contains? #{"watch_match" "watch_disabled" "heartbeat"} evt-type)
           (get evt "event_id"))
      [evt-type (str (get evt "session_id")) (str (get evt "event_id"))]

      (= evt-type "completion")
      (let [producer-id (str (or (get evt "session_id") ""))
            started-at (get evt "started_at")]
        (when (and (not= producer-id "") (some? started-at))
          [evt-type producer-id started-at]))

      :else nil)))

(defn- whole-number [v]
  (if (and (number? v) (== v (long v))) (long v) v))

(defn producer-identity
  "The completion's producer-stable identity as one compact JSON string;
  raises `invalid_params` when the event carries none. Whole doubles
  render integral (matching `JSON.stringify`), keeping the canon
  byte-identical across runners."
  [evt]
  (let [identity (completion-delivery-identity evt)]
    (if (nil? identity)
      (throw (ex-info "invalid_params" {}))
      (hio/json-str (mapv whole-number identity)))))

(defn completion-admission
  "The matching admission row for the event (the turn is committed — a
  lost ACK must finish durable claims, never infer again) or nil. Store
  seams ride the surface: `:session-authority`, `:lookup-session`,
  `:list-admissions`, `:route-owner`."
  [surface event]
  (let [authority (:session-authority surface)]
    (if (nil? authority)
      nil
      (let [entry ((:lookup-session surface) (str (or (get event "session_key") "")))]
        (if (nil? entry)
          nil
          (let [identity (producer-identity event)]
            (some (fn [row]
                    (let [payload (get row "payload")
                          descriptor (or (get payload "local_automation_v1")
                                         (get-in payload ["native_text_v1" "automation"])
                                         {})
                          identities (get descriptor "identities" [(get descriptor "identity")])]
                      (when (some #(= identity %) identities)
                        row)))
                  ((:list-admissions surface) authority ((:route-owner surface) authority entry)))))))))

(defn- py-str [v]
  (if (nil? v) "None" (str v)))

(defn format-coalesced-process-completions
  "One bounded synthetic event built from several redacted completions.
  `entries` are the `[synth-text evt waiter]` triples; `redact` is the
  gateway redaction seam. Redact BEFORE slicing."
  [redact entries]
  (let [n (count entries)
        shown (take 10 entries)
        lines (atom [(str "[IMPORTANT: " n " background processes completed for this session.")
                     (str "Treat these results as one completion batch and send at most one "
                          "consolidated user-facing response.")])]
    (doseq [[_text evt _waiter] shown]
      (let [session-id (str (or (get evt "session_id") "unknown"))
            exit-code (get evt "exit_code")
            reason (str (or (get evt "completion_reason") "exited"))
            raw (str/trim (str (redact (str (or (get evt "output") "")))))
            output (if (> (count raw) 800)
                     (str "[… truncated …]\n" (subs raw (- (count raw) 800)))
                     raw)]
        (swap! lines conj (str "\n- " session-id ": exit_code=" (py-str exit-code) ", reason=" reason))
        (when (not= output "")
          (swap! lines conj output))))
    (let [omitted (- n (count shown))]
      (when (pos? omitted)
        (swap! lines conj (str "\n- … and " omitted " more completion(s); inspect them with "
                               "the process tool if they affect the conclusion."))))
    (swap! lines conj "If a result does not change the current conclusion, absorb it silently.]")
    (str/join "\n" @lines)))

(defn- settle-batch-waiters! [entries result]
  (doseq [[_text _evt resolve] entries]
    (resolve result)))

(defn completion-fan-in
  "The completion-notification fan-in over one messaging-gateway surface.
  The surface supplies `:deliver!` [synth-text candidate-evt] (true =
  adapter admission, nil = deduplicated or terminal, false = retryable),
  `:display-text` [events], `:redact` [text], `:record-coalesced-siblings!`
  [evts], `:surface-child?` and `:batch-window` seconds. Flushes run
  explicitly via `flush-batch!` (no background timers); the waiter a
  legacy promise settles becomes a result atom."
  [surface]
  {:surface surface
   :batches (atom {})
   :stopping (atom false)
   :window-ms (* 1000 (double (or (:batch-window surface) 0.1)))})

(defn- deliver-entries!
  [fan-in entries entries-to-deliver]
  (let [surface (:surface fan-in)
        redact (or (:redact surface) (fn [text] text))
        synth-text (if (= 1 (count entries-to-deliver))
                     (first (first entries-to-deliver))
                     (format-coalesced-process-completions redact entries-to-deliver))
        display-text ((or (:display-text surface) process/process-completion-display-text)
                      (mapv second entries-to-deliver))
        authority (:session-authority surface)
        identities (when (some? authority)
                     (mapv (fn [[_text evt]] (producer-identity evt)) entries-to-deliver))]
    (loop [cands (vec entries-to-deliver)]
      (if (empty? cands)
        nil
        (let [[_text evt] (first cands)
              candidate (cond-> (assoc evt "_display_text" display-text)
                          (some? authority) (assoc "_automation_identities" identities))
              delivered ((:deliver! surface) synth-text candidate)]
          (if (some? delivered)
            delivered
            (recur (vec (rest cands)))))))))

(defn- deliver-batch!
  [fan-in entries]
  (let [surface (:surface fan-in)]
    (if (some? (:session-authority surface))
      (let [entries-to-deliver
            (vec (remove (fn [[_text evt]] (some? (completion-admission surface evt))) entries))]
        (if (empty? entries-to-deliver)
          true
          (deliver-entries! fan-in entries entries-to-deliver)))
      (deliver-entries! fan-in entries (vec entries)))))

(defn flush-batch!
  "Deliver one route-key batch and settle its waiters, answering the
  delivery result (true/false/nil). A stopping fan-in settles queued
  entries as retryable (false)."
  [fan-in key]
  (let [{:keys [batches stopping]} fan-in
        surface (:surface fan-in)
        entries (let [es (get @batches key [])]
                  (swap! batches dissoc key)
                  es)]
    (if (empty? entries)
      nil
      (if @stopping
        (do (settle-batch-waiters! entries false) false)
        (let [delivered (try (deliver-batch! fan-in entries)
                             (catch #?(:lpy python/Exception :clj Exception :cljs :default) _e
                               ::throw))]
          (if (= delivered ::throw)
            (do (settle-batch-waiters! entries false) false)
            (do (when (and (true? delivered) (> (count entries) 1))
                  (when-let [record (:record-coalesced-siblings! surface)]
                    (record (mapv second entries))))
                (settle-batch-waiters! entries delivered)
                delivered)))))))

(defn enqueue-process-completion-notification!
  "Fan in a policy-admitted process completion with compatible pinned
  owners. Answers nil (dropped), false (refused — stopping) or a result
  atom the flush realizes with the delivery result."
  [fan-in synth-text evt]
  (if-not (process/should-surface-notification evt (boolean (get-in fan-in [:surface :surface-child?])))
    nil
    (if @(:stopping fan-in)
      false
      (let [key (event-route-key evt (into completion-batch-key-fields
                                           ["parent_session_id" "origin_session_id"]))
            settled (atom :pending)
            entry [synth-text evt (fn [result] (reset! settled result))]]
        (swap! (:batches fan-in) update key (fnil conj []) entry)
        settled))))

(defn cancel-completion-batches!
  "Settle pending completion batches before adapter teardown — everything
  still queued settles as retryable (false)."
  [fan-in]
  (reset! (:stopping fan-in) true)
  (let [leftover (mapcat val @(:batches fan-in))]
    (reset! (:batches fan-in) {})
    (settle-batch-waiters! leftover false)))

(defn enqueue-hook
  "The `:enqueue!` binding for the watcher over one fan-in: false =
  refused, anything else counts as delivered."
  [fan-in]
  (fn [synth-text completion-evt]
    (enqueue-process-completion-notification! fan-in synth-text completion-evt)))

(defn admission-recheck-hook
  "The `:admission-recheck` binding for the watcher: truthy = the turn is
  committed. Answers nil when the surface has no session authority."
  [surface]
  (when (some? (:session-authority surface))
    (fn [completion-evt]
      (completion-admission surface completion-evt))))
