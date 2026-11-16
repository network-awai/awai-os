;; Lane-adapter port of src/itonami/agent/platform_adapters.cljk
;; (JUN-1036 S5c): the pure per-lane request builders plus lane
;; resolution. Token secrets come from the environment (never config);
;; the chat target comes from profile config. Sends ride an injected
;; `:fetch` that answers response maps `{:ok :status :json :text}`
;; synchronously (the live transport wraps the real fetch+parse
;; host-side); the error strings are verbatim from the legacy.
(ns itonami.otehon.adapters
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(defn- url-encode [s]
  #?(:lpy (let [u (python/__import__ "urllib.parse" ** :fromlist ["quote"])] (.quote u (str s) ** :safe ""))
     :clj (str/replace (java.net.URLEncoder/encode (str s) "UTF-8") "+" "%20")
     :cljs (js/encodeURIComponent (str s))))

;; ---------------------------------------------------------------- telegram

(defn telegram-request
  "The Telegram Bot API sendMessage request this adapter makes."
  ([token chat-id text] (telegram-request token chat-id text nil))
  ([token chat-id text thread-id]
   (let [tid (when (re-matches #"\d+" (str thread-id)) (parse-long (str thread-id)))]
     {:url (str "https://api.telegram.org/bot" token "/sendMessage")
      :body (hio/json-str (cond-> {"chat_id" chat-id "text" (str text)}
                            tid (assoc "message_thread_id" tid)))})))

;; ---------------------------------------------------------------- slack

(defn slack-request
  [token channel text]
  {:url "https://slack.com/api/chat.postMessage"
   :headers {"Authorization" (str "Bearer " token) "Content-Type" "application/json; charset=utf-8"}
   :body (hio/json-str {"channel" channel "text" (str text)})})

;; ---------------------------------------------------------------- discord

(defn discord-request
  [webhook-url text]
  {:url (str webhook-url "?wait=true")
   :body (hio/json-str {"content" (str text)})})

(defn discord-bot-request
  [token channel-id text]
  {:url (str "https://discord.com/api/channels/" (url-encode (str channel-id)) "/messages")
   :headers {"Authorization" (str "Bot " token) "Content-Type" "application/json"}
   :body (hio/json-str {"content" (str text)})})

;; ---------------------------------------------------------------- mattermost

(defn mattermost-request
  [webhook-url text]
  {:url webhook-url
   :body (hio/json-str {"text" (str text)})})

;; ---------------------------------------------------------------- matrix

(defn matrix-request
  [homeserver token room-id text]
  {:url (str (str/replace (str homeserver) #"/$" "") "/_matrix/client/v3/rooms/"
             (url-encode room-id) "/send/m.room.message/" (hio/random-hex 12))
   :headers {"Authorization" (str "Bearer " token) "Content-Type" "application/json"}
   :body (hio/json-str {"msgtype" "m.text" "body" (str text)})})

;; ---------------------------------------------------------------- feishu

(defn feishu-token-request
  [app-id app-secret]
  {:url "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
   :headers {"Content-Type" "application/json; charset=utf-8"}
   :body (hio/json-str {"app_id" (str app-id) "app_secret" (str app-secret)})})

(defn feishu-request
  [token chat-id text]
  {:url "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id"
   :headers {"Authorization" (str "Bearer " token) "Content-Type" "application/json; charset=utf-8"}
   :body (hio/json-str {"receive_id" (str chat-id)
                        "msg_type" "text"
                        "content" (hio/json-str {"text" (str text)})})})

;; ---------------------------------------------------------------- dingtalk

(defn dingtalk-token-request
  [app-key app-secret]
  {:url "https://api.dingtalk.com/v1.0/oauth2/accessToken"
   :headers {"Content-Type" "application/json; charset=utf-8"}
   :body (hio/json-str {"appKey" (str app-key) "appSecret" (str app-secret)})})

(defn dingtalk-request
  [token robot-code user-id text]
  {:url "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend"
   :headers {"Authorization" (str "Bearer " token) "Content-Type" "application/json; charset=utf-8"}
   :body (hio/json-str {"robotCode" (str robot-code)
                        "userIds" [(str user-id)]
                        "msgKey" "sampleText"
                        "msgParam" (hio/json-str {"text" (str text)})})})

;; ---------------------------------------------------------------- wecom

(defn wecom-token-request
  [corp-id corp-secret]
  {:url (str "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid="
             (url-encode (str corp-id)) "&corpsecret="
             (url-encode (str corp-secret)))
   :method "GET"})

(defn wecom-request
  [token touser agent-id text]
  {:url (str "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token="
             (url-encode (str token)))
   :headers {"Content-Type" "application/json; charset=utf-8"}
   :body (hio/json-str {"touser" (str touser)
                        "msgtype" "text"
                        "agentid" (if (number? agent-id) agent-id (parse-long (str agent-id)))
                        "text" {"content" (str text)}})})

;; ---------------------------------------------------------------- whatsapp

(defn whatsapp-request
  [token phone-number-id to text]
  {:url (str "https://graph.facebook.com/v20.0/"
             (url-encode (str phone-number-id)) "/messages")
   :headers {"Authorization" (str "Bearer " token) "Content-Type" "application/json; charset=utf-8"}
   :body (hio/json-str {"messaging_product" "whatsapp"
                        "to" (str to)
                        "type" "text"
                        "text" {"body" (str text)}})})

;; ---------------------------------------------------------------- send fns
;; Each answers nil (delivered) or an error string, verbatim from the
;; legacy. `:fetch` rides `opts` (or the lane default, injected in
;; cases) and answers a response map `{:ok :status :json :text}`; a
;; throwing fetch maps to the lane's transport error.

(defn- call-fetch [fetch-fn url opts]
  (try {:transport (fetch-fn url opts)}
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
         {:error (or (ex-message e) (str e))})))

(defn- http-failed [label res]
  (str label " failed: HTTP " (str (:status res))))

(defn- post-ok!
  "POST/PUT `r`, mapping the response to nil or `<label> failed: ...`."
  [fetch-fn r label method]
  (let [res (call-fetch fetch-fn (:url r) {:method method
                                           :headers (or (:headers r) {"Content-Type" "application/json"})
                                           :body (:body r)})]
    (cond
      (:error res) (str label " failed: " (:error res))
      (:ok (:transport res)) nil
      :else (str label " failed: HTTP " (str (:status (:transport res)))))))

(defn telegram-send!
  [fetch-fn token chat-id content opts]
  (post-ok! fetch-fn
            (telegram-request token (or (:chat-id opts) chat-id) content (:thread-id opts))
            "telegram sendMessage" "POST"))

(defn slack-send!
  [fetch-fn token channel content opts]
  (let [r (slack-request token (or (:chat-id opts) channel) content)
        res (call-fetch fetch-fn (:url r) {:method "POST"
                                           :headers (:headers r)
                                           :body (:body r)})]
    (cond
      (:error res) (str "slack chat.postMessage failed: " (:error res))
      (:ok (:transport res)) (let [j (or (:json (:transport res)) {})]
                               (if (get j "ok")
                                 nil
                                 (str "slack chat.postMessage failed: " (or (get j "error") "unknown error"))))
      :else (str "slack chat.postMessage failed: HTTP " (str (:status (:transport res)))))))

(defn discord-send!
  [fetch-fn webhook-url token channel-id configured-chat content opts]
  (let [to (str (:chat-id opts))]
    (if (and webhook-url (not (str/blank? to)) (not= to (str configured-chat)))
      (str "discord webhook serves chat " (str configured-chat) "; refusing reply to " to)
      (let [r (if webhook-url (discord-request webhook-url content)
                  (discord-bot-request token (or (:chat-id opts) channel-id) content))]
        (post-ok! fetch-fn r "discord send" "POST")))))

(defn mattermost-send!
  [fetch-fn webhook-url configured-chat content opts]
  (let [to (str (:chat-id opts))]
    (if (and (not (str/blank? to)) (not= to (str configured-chat)))
      (str "mattermost webhook serves chat " (str configured-chat) "; refusing reply to " to)
      (post-ok! fetch-fn (mattermost-request webhook-url content) "mattermost webhook" "POST"))))

(defn matrix-send!
  [fetch-fn homeserver token room-id content opts]
  (let [r (matrix-request homeserver token (or (:chat-id opts) room-id) content)]
    (post-ok! fetch-fn r "matrix send" "PUT")))

(defn whatsapp-send!
  [fetch-fn token phone-number-id to content]
  (post-ok! fetch-fn
            (whatsapp-request token phone-number-id to content)
            "whatsapp messages" "POST"))

(defn- exchange-then-send!
  "Run the auth-transport token exchange, then send with the token."
  [fetch-fn token-req exchange-label send]
  (let [r (token-req)
        res (call-fetch fetch-fn (:url r) {:method (or (:method r) "POST")
                                           :headers (or (:headers r) {"Content-Type" "application/json"})
                                           :body (:body r)})]
    (cond
      (:error res) (str exchange-label " failed: " (:error res))
      (not (:ok (:transport res)))
      (str exchange-label " failed: HTTP " (str (:status (:transport res))))
      :else (let [j (or (:json (:transport res)) {})]
              (send j)))))

(defn- feishu-direct-send!
  [fetch-fn token chat content]
  (let [r (feishu-request token chat content)
        res (call-fetch fetch-fn (:url r) {:method "POST"
                                           :headers (:headers r)
                                           :body (:body r)})]
    (cond
      (:error res) (str "feishu im/v1/messages failed: " (:error res))
      (not (:ok (:transport res)))
      (str "feishu im/v1/messages failed: HTTP " (str (:status (:transport res))))
      :else (let [j (or (:json (:transport res)) {})]
              (if (zero? (or (get j "code") -1))
                nil
                (str "feishu im/v1/messages failed: " (or (get j "msg") "unknown error")))))))

(defn feishu-send!
  [fetch-fn token app-id app-secret chat-id content opts]
  (let [override (str (:chat-id opts))
        chat (if (str/blank? override) (str chat-id) override)]
    (if (not (str/blank? (str token)))
      (feishu-direct-send! fetch-fn token chat content)
      (let [r (exchange-then-send!
               fetch-fn
               (fn [] (feishu-token-request app-id app-secret))
               "feishu token exchange"
               (fn [j]
                 (if (zero? (or (get j "code") -1))
                   (let [tok (get j "tenant_access_token")]
                     (if (str/blank? (str tok))
                       {:error "feishu token exchange failed: response carried no tenant_access_token"}
                       {:token (str tok)}))
                   {:error (str "feishu token exchange failed: " (or (get j "msg") "unknown error"))})))]
        (cond
          (string? r) r
          (:error r) (:error r)
          :else (feishu-direct-send! fetch-fn (:token r) chat content))))))

(defn- dingtalk-direct-send!
  [fetch-fn token robot-code chat content]
  (let [r (dingtalk-request token robot-code chat content)
        res (call-fetch fetch-fn (:url r) {:method "POST"
                                           :headers (:headers r)
                                           :body (:body r)})]
    (cond
      (:error res) (str "dingtalk batchSend failed: " (:error res))
      (:ok (:transport res)) nil
      :else (str "dingtalk batchSend failed: HTTP " (str (:status (:transport res)))))))

(defn dingtalk-send!
  [fetch-fn token app-key app-secret chat-id content opts]
  (let [override (str (:chat-id opts))
        chat (if (str/blank? override) (str chat-id) override)]
    (if (not (str/blank? (str token)))
      (dingtalk-direct-send! fetch-fn token (str app-key) chat content)
      (let [r (exchange-then-send!
               fetch-fn
               (fn [] (dingtalk-token-request app-key app-secret))
               "dingtalk token exchange"
               (fn [j]
                 (let [tok (get j "accessToken")]
                   (if (str/blank? (str tok))
                     {:error "dingtalk token exchange failed: response carried no accessToken"}
                     {:token (str tok)}))))]
        (cond
          (string? r) r
          (:error r) (:error r)
          :else (dingtalk-direct-send! fetch-fn (:token r) (str app-key) chat content))))))

(defn- wecom-direct-send!
  [fetch-fn token touser agent-id content]
  (let [r (wecom-request token touser agent-id content)
        res (call-fetch fetch-fn (:url r) {:method "POST"
                                           :headers (:headers r)
                                           :body (:body r)})]
    (cond
      (:error res) (str "wecom message/send failed: " (:error res))
      (not (:ok (:transport res)))
      (str "wecom message/send failed: HTTP " (str (:status (:transport res))))
      :else (let [j (or (:json (:transport res)) {})]
              (if (zero? (or (get j "errcode") -1))
                nil
                (str "wecom message/send failed: " (or (get j "errmsg") "unknown error")))))))

(defn wecom-send!
  [fetch-fn token corp-id corp-secret agent-id chat-id content opts]
  (let [override (str (:chat-id opts))
        chat (if (str/blank? override) (str chat-id) override)]
    (if (not (str/blank? (str token)))
      (wecom-direct-send! fetch-fn token chat agent-id content)
      (let [r (exchange-then-send!
               fetch-fn
               (fn [] (wecom-token-request corp-id corp-secret))
               "wecom token exchange"
               (fn [j]
                 (let [tok (get j "access_token")]
                   (if (str/blank? (str tok))
                     {:error "wecom token exchange failed: response carried no access_token"}
                     {:token (str tok)}))))]
        (cond
          (string? r) r
          (:error r) (:error r)
          :else (wecom-direct-send! fetch-fn (:token r) chat agent-id content))))))

;; ---------------------------------------------------------------- registry

(def token-env-defaults
  "The env var each lane's token comes from when delivery.<lane>.token_env
  does not name one."
  {"telegram" "TELEGRAM_BOT_TOKEN"
   "slack" "SLACK_BOT_TOKEN"
   "discord" "DISCORD_BOT_TOKEN"
   "mattermost" nil
   "matrix" "MATRIX_ACCESS_TOKEN"
   "feishu" "FEISHU_TENANT_ACCESS_TOKEN"
   "dingtalk" "DINGTALK_ACCESS_TOKEN"
   "wecom" "WECOM_ACCESS_TOKEN"
   "whatsapp" "WHATSAPP_ACCESS_TOKEN"})

(defn token-env-name
  "The env var carrying this lane's token, or nil for webhook lanes and
  unknown lanes without a token_env."
  [lane config]
  (let [lane (str/lower-case (str lane))
        c (get-in config ["delivery" lane])]
    (when-not (or (= "mattermost" lane)
                  (and (= "discord" lane)
                       (not (str/blank? (str (get c "webhook_url"))))))
      (or (get c "token_env") (get token-env-defaults lane)))))

(defn- lane-env
  [env name]
  (when-not (str/blank? (str name))
    (let [v (if (map? env) (get env (str name)) (env (str name)))]
      (when-not (str/blank? (str v)) (str v)))))

(defn for-lane
  "The built-in adapter for a deliver lane, or nil when unconfigured.
  Credentials come from `env` (defaulting to the live environment)."
  ([lane config] (for-lane lane config hio/env))
  ([lane config env]
   (let [getenv (fn [name] (lane-env env name))]
     (case (str/lower-case (str lane))
       "telegram"
       (let [c (get-in config ["delivery" "telegram"])
             token (getenv (token-env-name "telegram" config))
             chat-id (get c "chat_id")]
         (when (and (not (str/blank? (str token))) (not (str/blank? (str chat-id))))
           (fn [job lane content opts]
             (telegram-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "telegram: no fetch" {}))))
                             token chat-id content opts))))
       "slack"
       (let [c (get-in config ["delivery" "slack"])
             token (getenv (token-env-name "slack" config))
             channel (get c "channel")]
         (when (and (not (str/blank? (str token))) (not (str/blank? (str channel))))
           (fn [job lane content opts]
             (slack-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "slack: no fetch" {}))))
                           token channel content opts))))
       "discord"
       (let [c (get-in config ["delivery" "discord"])
             webhook (get c "webhook_url")
             token (getenv (token-env-name "discord" config))
             channel-id (get c "channel_id")]
         (cond
           (not (str/blank? (str webhook)))
           (fn [job lane content opts]
             (discord-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "discord: no fetch" {}))))
                             (str webhook) nil nil (str (get c "chat_id")) content opts))
           (and (not (str/blank? (str token))) (not (str/blank? (str channel-id))))
           (fn [job lane content opts]
             (discord-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "discord: no fetch" {}))))
                             nil token channel-id nil content opts))))
       "mattermost"
       (let [c (get-in config ["delivery" "mattermost"])
             webhook (get c "webhook_url")]
         (when-not (str/blank? (str webhook))
           (fn [job lane content opts]
             (mattermost-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "mattermost: no fetch" {}))))
                               (str webhook) (str (get c "chat_id")) content opts))))
       "matrix"
       (let [c (get-in config ["delivery" "matrix"])
             homeserver (get c "homeserver")
             token (getenv (token-env-name "matrix" config))
             room-id (get c "room_id")]
         (when (and (not (str/blank? (str homeserver)))
                    (not (str/blank? (str token)))
                    (not (str/blank? (str room-id))))
           (fn [job lane content opts]
             (matrix-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "matrix: no fetch" {}))))
                             (str homeserver) token room-id content opts))))
       "feishu"
       (let [c (get-in config ["delivery" "feishu"])
             token (getenv (token-env-name "feishu" config))
             app-id (getenv "FEISHU_APP_ID")
             app-secret (getenv "FEISHU_APP_SECRET")
             chat-id (get c "chat_id")]
         (when (and (not (str/blank? (str chat-id)))
                    (or (not (str/blank? (str token)))
                        (and (not (str/blank? (str app-id)))
                             (not (str/blank? (str app-secret))))))
           (fn [job lane content opts]
             (feishu-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "feishu: no fetch" {}))))
                             token app-id app-secret chat-id content opts))))
       "dingtalk"
       (let [c (get-in config ["delivery" "dingtalk"])
             token (getenv (token-env-name "dingtalk" config))
             app-key (getenv "DINGTALK_APP_KEY")
             app-secret (getenv "DINGTALK_APP_SECRET")
             chat-id (get c "chat_id")]
         (when (and (not (str/blank? (str chat-id)))
                    (not (str/blank? (str app-key)))
                    (or (not (str/blank? (str token)))
                        (not (str/blank? (str app-secret)))))
           (fn [job lane content opts]
             (dingtalk-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "dingtalk: no fetch" {}))))
                               token app-key app-secret chat-id content opts))))
       "wecom"
       (let [c (get-in config ["delivery" "wecom"])
             token (getenv (token-env-name "wecom" config))
             corp-id (getenv "WECOM_CORP_ID")
             corp-secret (getenv "WECOM_CORP_SECRET")
             agent-id (get c "agent_id")
             chat-id (get c "chat_id")]
         (when (and (not (str/blank? (str chat-id)))
                    (re-matches #"\d+" (str agent-id))
                    (or (not (str/blank? (str token)))
                        (and (not (str/blank? (str corp-id)))
                             (not (str/blank? (str corp-secret))))))
           (fn [job lane content opts]
             (wecom-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "wecom: no fetch" {}))))
                           token corp-id corp-secret agent-id chat-id content opts))))
       "whatsapp"
       (let [c (get-in config ["delivery" "whatsapp"])
             token (getenv (token-env-name "whatsapp" config))
             phone-number-id (get c "phone_number_id")
             chat-id (get c "chat_id")]
         (when (and (not (str/blank? (str chat-id)))
                    (not (str/blank? (str phone-number-id)))
                    (not (str/blank? (str token))))
           (fn [job lane content opts]
             (let [override (str (:chat-id opts))
                   chat (if (str/blank? override) (str chat-id) override)]
               (whatsapp-send! (or (:fetch opts) (fn [_ _] (throw (ex-info "whatsapp: no fetch" {}))))
                               token phone-number-id chat content)))))
       nil))))

