;; Inbound-chat port of src/itonami/agent/chat_platform.cljk (JUN-1036 S5c):
;; normalize, intake guards, routing, history, the sync per-chat
;; dispatcher, the telegram long-poll/serve loop, the explicit-send
;; profile shaping and chunked replies. The turn run, the transport
;; fetch and the reply send ride injected fns; the busy-chat queue has
;; no observable effect single-threaded, so dispatch runs inline.
(ns itonami.otehon.chat
  (:require [clojure.string :as str]
            [itonami.otehon.adapters :as adapters]
            [itonami.otehon.io :as hio]))

;; ---------------------------------------------------------------- normalize

(defn telegram-normalize
  [raw]
  (let [m (get raw "message")]
    (when (and m (string? (get m "text")))
      {"update_id" (str (get raw "update_id"))
       "platform" "telegram"
       "chat_id" (str (get-in m ["chat" "id"]))
       "user_id" (str (get-in m ["from" "id"]))
       "user_name" (str (or (get-in m ["from" "username"])
                            (get-in m ["from" "first_name"]) ""))
       "thread_id" (str (or (get m "message_thread_id") ""))
       "message_id" (str (get m "message_id"))
       "text" (get m "text")})))

(defn feishu-normalize
  [raw]
  (let [m (get-in raw ["event" "message"])]
    (when (and (= "im.message.receive_v1" (get-in raw ["header" "event_type"]))
               m
               (= "text" (get m "message_type")))
      (let [content (try (hio/parse-json (str (get m "content")))
                         (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))]
        (when (string? (get content "text"))
          {"update_id" (str (or (get-in raw ["header" "event_id"]) (get m "message_id")))
           "platform" "feishu"
           "chat_id" (str (get m "chat_id"))
           "user_id" (str (get-in raw ["event" "sender" "sender_id" "open_id"]))
           "user_name" (str (or (get-in raw ["event" "sender" "sender_id" "open_id"]) ""))
           "thread_id" (str (or (get m "thread_id") ""))
           "message_id" (str (get m "message_id"))
           "text" (get content "text")})))))

(defn dingtalk-normalize
  [raw]
  (let [m (get raw "text")
        uid (let [a (get raw "msgId")] (if (str/blank? (str a)) (get raw "createAt") a))]
    (when (and m (string? (get m "content")) (not (str/blank? (str uid))))
      {"update_id" (str uid)
       "platform" "dingtalk"
       "chat_id" (str (or (get raw "senderStaffId") ""))
       "user_id" (str (or (get raw "senderStaffId") ""))
       "user_name" (str (or (get raw "senderNick") ""))
       "thread_id" (str (or (get raw "conversationId") ""))
       "message_id" (str (or (get raw "msgId") ""))
       "text" (get m "content")})))

(defn wecom-normalize
  [raw]
  (let [uid (let [a (get raw "MsgId")] (if (str/blank? (str a)) (get raw "CreateTime") a))]
    (when (and (= "text" (get raw "MsgType"))
               (string? (get raw "Content"))
               (not (str/blank? (str uid))))
      {"update_id" (str uid)
       "platform" "wecom"
       "chat_id" (str (get raw "FromUserName"))
       "user_id" (str (get raw "FromUserName"))
       "user_name" (str (or (get raw "FromUserName") ""))
       "thread_id" (str (or (get raw "ConversationId") ""))
       "message_id" (str (or (get raw "MsgId") ""))
       "text" (get raw "Content")})))

(defn whatsapp-normalize
  [raw]
  (let [msg (get-in raw ["entry" 0 "changes" 0 "value" "messages" 0])
        uid (let [a (get msg "id")] (if (str/blank? (str a)) (get msg "timestamp") a))]
    (when (and msg (= "text" (get msg "type")) (string? (get-in msg ["text" "body"]))
               (not (str/blank? (str uid))))
      {"update_id" (str uid)
       "platform" "whatsapp"
       "chat_id" (str (get msg "from"))
       "user_id" (str (get msg "from"))
       "user_name" (str (or (get-in raw ["entry" 0 "changes" 0 "value" "contacts" 0 "profile" "name"]) ""))
       "thread_id" ""
       "message_id" (str (or (get msg "id") ""))
       "text" (get-in msg ["text" "body"])})))

(def platform-adapters
  {"telegram" {:normalize telegram-normalize}
   "feishu" {:normalize feishu-normalize}
   "dingtalk" {:normalize dingtalk-normalize}
   "wecom" {:normalize wecom-normalize}
   "whatsapp" {:normalize whatsapp-normalize}})

(defn normalize
  [platform raw]
  (when-let [f (get-in platform-adapters [platform :normalize])]
    (f raw)))

;; ---------------------------------------------------------------- guards

(def max-text-chars 8000)

(def max-seen-updates 512)

(defn- err-str [e]
  (str (or (ex-message e) e)))

(defn guard-message
  [seen msg]
  (let [uid (str (get msg "platform") ":" (get msg "update_id"))]
    (cond
      (some #(= uid %) @seen) {:drop "duplicate"}
      (or (str/blank? (str (get msg "chat_id"))) (str/blank? (str (get msg "user_id"))))
      {:drop "empty-identity"}
      (str/blank? (str (get msg "text"))) {:drop "empty"}
      (< max-text-chars (count (str (get msg "text")))) {:drop "oversized"}
      :else (do (swap! seen (fn [s]
                              (let [s (conj (vec (or s [])) uid)]
                                (if (< max-seen-updates (count s))
                                  (subvec s (- (count s) max-seen-updates))
                                  s))))
                {:ok msg}))))

;; ---------------------------------------------------------------- routing

(defn route-chat
  [profiles msg]
  (let [platform (get msg "platform")
        chat (get msg "chat_id")
        explicit (reduce (fn [acc prof]
                           (or acc (get-in (:config prof) ["gateway" "routes" (str platform ":" chat)])))
                         nil profiles)]
    (or explicit
        (some (fn [prof]
                (when (= (str (get-in (:config prof) ["delivery" platform "chat_id"])) (str chat))
                  (:name prof)))
              profiles))))

;; ---------------------------------------------------------------- history

(defn- history-path [home platform chat-id]
  (str home "/chat/"
       (str (str/replace (str platform) #"[^A-Za-z0-9_-]" "_") "-"
            (str/replace (str chat-id) #"[^A-Za-z0-9_-]" "_") ".jsonl")))

(defn load-history
  ([home platform chat-id] (load-history home platform chat-id 100))
  ([home platform chat-id limit]
   (let [f (history-path home platform chat-id)]
     (if (hio/file? f)
       (->> (str/split-lines (hio/slurp-utf8 f))
            (remove str/blank?)
            (map #(hio/parse-json %))
            (take-last limit)
            vec)
       []))))

(defn append-history!
  [home platform chat-id rows]
  (when (seq rows)
    (let [f (history-path home platform chat-id)
          prior (if (hio/file? f) (hio/slurp-utf8 f) "")]
      (hio/mkdirs! (str home "/chat"))
      (hio/replace-file! f (str prior (str/join "" (for [r rows] (str (hio/json-str r) "\n"))))))))

;; ---------------------------------------------------------------- dispatch

(defn make-dispatcher
  "The sync per-chat dispatch: normalize -> guard -> route -> turn ->
  reply. `executor` [prof prompt opts] answers the loop result map;
  `run-opts` [prof msg] builds the turn options; `send!` [prof msg text]
  answers nil or an error string; `on-event` observes drop/unrouted/
  turn/turn-error events."
  [{:keys [profiles executor run-opts send! on-event]}]
  (let [seen (atom #{})
        emit (fn [e] (when on-event (on-event e)))
        chat-key (fn [m] (str (get m "platform") ":" (get m "chat_id")))
        run-one (fn [msg]
                  (let [platform (get msg "platform")
                        chat-id (get msg "chat_id")
                        prof-name (route-chat profiles msg)
                        prof (some #(when (= (:name %) prof-name) %) profiles)]
                    (if-not prof
                      (do (emit {:event :unrouted :msg (select-keys msg ["platform" "chat_id" "user_id"])})
                          {:status :unrouted})
                      (let [home (:home prof)
                            prior (load-history home platform chat-id)]
                        (try
                          (let [r (executor prof (get msg "text")
                                            (assoc (run-opts prof msg) :history prior))
                                final (or (:final r) (str "[" (:exit-reason r) "]"))]
                            (append-history! home platform chat-id
                                             [{"role" "user" "content" (get msg "text")}
                                              {"role" "assistant" "content" final}])
                            (emit {:event :turn :msg msg :exit-reason (:exit-reason r)})
                            (if (= "completed" (:exit-reason r))
                              (let [res (try (send! prof msg final)
                                             (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                                               (err-str e)))]
                                (if (nil? res)
                                  {:status :replied :reply final}
                                  {:status :send-failed :reply final :error (str res)}))
                              (let [notice (str "The turn failed: " (:exit-reason r)
                                                (when-let [e (get-in r [:error :error])] (str " — " e)))
                                    res (try (send! prof msg notice)
                                             (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                                               (err-str e)))]
                                {:status :turn-failed :exit-reason (:exit-reason r)
                                 :notice (if (nil? res) :delivered (str res))})))
                          (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                            (emit {:event :turn-error :msg msg :error (err-str e)})
                            {:status :turn-failed :error (err-str e)}))))))]
    (fn dispatch [platform raw]
      (let [msg (normalize platform raw)]
        (if (nil? msg)
          (let [reason (if (contains? platform-adapters platform) "no-turn" "unknown-platform")]
            (emit {:event :drop :reason reason})
            {:status :dropped :reason reason})
          (let [g (guard-message seen msg)]
            (if (:drop g)
              (do (emit {:event :drop :reason (:drop g)})
                  {:status :dropped :reason (:drop g)})
              (run-one msg))))))))

;; ---------------------------------------------------------------- telegram poll/serve

(defn telegram-poll!
  "One `getUpdates` long poll. `fetch` answers response maps
  `{:ok :status :body-text}`; timeout in seconds. Answers
  {:updates [...] :offset n} or {:error ... :updates [] :offset n}."
  [{:keys [fetch token offset timeout]}]
  (let [url (str "https://api.telegram.org/bot" token "/getUpdates?timeout="
                 (or timeout 25) "&offset=" (or offset 0))]
    (try
      (let [res (fetch url {:method "GET"})]
        (if (:ok res)
          (let [data (hio/parse-json (str (:body-text res)))
                updates (vec (get data "result"))
                ids (keep (fn [u]
                            (let [m (re-find #"^-?\d+" (str (get u "update_id")))]
                              (when m (try (parse-long m) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))))
                          updates)]
            {:updates updates
             :offset (if (seq ids) (inc (apply max ids)) (or offset 0))})
          {:error (str "getUpdates failed: HTTP " (str (:status res))) :updates [] :offset (or offset 0)}))
      (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
        {:error (err-str e) :updates [] :offset (or offset 0)}))))

(defn telegram-token
  "The bot token for a telegram session, or nil when unconfigured."
  ([config] (telegram-token config hio/env))
  ([config env]
   (let [name (adapters/token-env-name "telegram" config)
         token (when-not (str/blank? (str name))
                 (if (map? env) (get env (str name)) (env (str name))))]
     (when-not (str/blank? (str token)) (str token)))))

(defn backoff-ms
  "The poll-error backoff in milliseconds: a finite positive interval
  floored at 1000 and capped at 600000; anything unparseable falls back
  to 5000."
  [interval]
  (let [n (if (number? interval)
            (double interval)
            (try #?(:lpy (python/float (str interval))
                    :clj (Double/parseDouble (str interval))
                    :cljs (js/parseFloat (str interval)))
                 (catch #?(:lpy python/Exception :clj Exception :cljs :default) _
                   #?(:lpy (python/float "nan")
                       :clj Double/NaN
                       :cljs js/NaN))))
        finite? #?(:lpy (let [m (python/__import__ "math")] (boolean (.isfinite m n)))
                   :clj (Double/isFinite n)
                   :cljs (js/Number.isFinite n))]
    (if (and finite? (pos? n))
      (long (min 600000 (max 1000 n)))
      5000)))

(defn- read-offset [file]
  (try
    (if (and (some? file) (hio/file? file))
      (let [raw (str (get (hio/parse-json (hio/slurp-utf8 file)) "offset"))]
        (if (re-matches #"\d+" raw)
          (let [n (try (parse-long raw) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))]
            (if (and (some? n) (pos? n) (<= n 9007199254740991)) n 0))
          0))
      0)
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ 0)))

(defn- write-offset! [file n]
  (when file
    (try (hio/replace-file! file (hio/json-str {"offset" n}))
         (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))))

(defn serve!
  "Run the telegram serve loop bounded by `:max-ticks` (or until
  `:stop?` answers true): poll, dispatch every update, persist the
  consumed offset only after every dispatch settles. Answers
  {:status :max-ticks/:stopped :ticks n}. `:sleep-fn` records the
  between-poll wait (default no-op — pacing comes from the long poll)."
  [{:keys [fetch token dispatch on-error interval max-ticks poll-timeout offset-file sleep-fn stop?]}]
  (let [iv (backoff-ms interval)
        sleep (or sleep-fn (fn [_] nil))
        stop? (or stop? (fn [] false))
        off (atom (read-offset offset-file))
        notify! (fn [e] (when on-error (try (on-error e) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))))]
    (loop [ticks 0]
      (cond
        (stop?) {:status :stopped :ticks ticks}
        (and (some? max-ticks) (>= ticks max-ticks)) {:status :max-ticks :ticks ticks}
        :else
        (let [res (telegram-poll! {:fetch fetch :token token :offset @off
                                   :timeout (or poll-timeout 25)})]
          (if-let [err (:error res)]
            (do (notify! err) (sleep iv) (recur (inc ticks)))
            (do (doseq [u (:updates res)]
                  (try (dispatch u) (catch #?(:lpy python/Exception :clj Exception :cljs :default) e (notify! (err-str e)))))
                (reset! off (:offset res))
                (write-offset! offset-file (:offset res))
                (recur (inc ticks)))))))))

;; ---------------------------------------------------------------- explicit send

(defn prepare-send-profile
  "Shape a profile for an explicit-target send. Per-chat families take
  the requested chat as the target; webhook sends with an undeclared
  anchor are refused (fail closed). Answers {:prof ...} or {:error ...}."
  [prof platform chat-id]
  (let [c (get-in prof [:config "delivery" platform])
        webhook? (or (= "mattermost" platform)
                     (and (= "discord" platform)
                          (not (str/blank? (str (get c "webhook_url"))))))
        bot-channel? (and (= "discord" platform) (not webhook?))]
    (cond
      webhook?
      (cond
        (str/blank? (str (get c "webhook_url")))
        {:error (str platform " webhook lane needs delivery." platform ".webhook_url configured")}
        (str/blank? (str (get c "chat_id")))
        {:error (str platform " webhook lane must declare delivery." platform
                     ".chat_id (the one chat it serves) before an explicit send")}
        :else {:prof prof})

      (contains? #{"telegram" "slack" "matrix" "discord"} platform)
      (let [fill-key (if bot-channel?
                       "channel_id"
                       ({"telegram" "chat_id" "slack" "channel" "matrix" "room_id"} platform))]
        {:prof (update-in prof [:config "delivery" platform]
                          (fn [c]
                            (cond-> (or c {})
                              (str/blank? (str (get c fill-key)))
                              (assoc fill-key (str chat-id)))))})
      :else {:error (str platform " is not implemented for send (telegram/slack/matrix/discord/mattermost)")})))

(def max-reply-chars 4000)

(defn chunk-text
  "Split a reply into segments of at most `limit` chars, preferring the
  last newline inside the window. `limit` must be a positive integer."
  ([text] (chunk-text text max-reply-chars))
  ([text limit]
   (when-not (and (integer? limit) (pos? limit))
     (throw (ex-info "chunk-text: limit must be a positive integer" {})))
   (let [s (str text)]
     (if (<= (count s) limit)
       [s]
       (loop [rest-s s acc []]
         (if (<= (count rest-s) limit)
           (conj acc rest-s)
           (let [window (subs rest-s 0 limit)
                 nl (str/last-index-of window "\n")
                 cut (if nl (inc nl) limit)]
             (recur (subs rest-s cut) (conj acc (subs window 0 cut))))))))))

(defn send-reply!
  "The reply through the platform's existing send adapter, addressed to
  the message's chat. Answers nil or the adapter's error string."
  ([prof msg text] (send-reply! prof msg text nil nil))
  ([prof msg text fetch] (send-reply! prof msg text fetch nil))
  ([prof msg text fetch env]
   (let [platform (get msg "platform")
         chat (str (get msg "chat_id"))
         adapter (adapters/for-lane platform (:config prof) (or env hio/env))]
     (cond
       (str/blank? chat)
       (str platform " reply names no chat - refusing to fall back to the configured delivery chat")

       (str/blank? (str text))
       (str platform " reply is empty - refusing to send")

       (nil? adapter)
       (str platform " send adapter not configured")

       :else
       (let [send-opts (cond-> {:chat-id chat :thread-id (get msg "thread_id")}
                         fetch (assoc :fetch fetch))
             segments (chunk-text text)]
         (loop [segs segments]
           (let [res (try (adapter nil platform (first segs) send-opts)
                          (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                            (err-str e)))]
             (if (and (nil? res) (seq (rest segs)))
               (recur (rest segs))
               res))))))))
