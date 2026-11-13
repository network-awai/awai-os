(ns itonami.otehon.conversation
  "Agent-owned AwaiFS/Kotobase conversation sessions, shared by CLI and UI hosts.
  Legacy state.db browsing remains separate; never import Hermes state implicitly."
  (:require [clojure.string :as str] [itonami.otehon.io :as io]))

(defn valid-session? [id]
  (boolean (and (string? id) (or (= "default" id)
    (re-matches #"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}" id)))))
(defn valid-bot? [id] (boolean (and (string? id) (re-matches #"profile:[A-Za-z0-9_.-]+" id))))
(defn session-scope [owner bot id]
  (when-not (and (string? owner) (not (str/blank? owner)) (valid-bot? bot) (valid-session? id))
    (throw (ex-info "invalid Agent session scope" {})))
  ;; Preserve the original owner/Bot default partition exactly.
  (io/sha256-utf8 (str "itonami-agent/conversation/v1\u0000" owner "\u0000" bot
                       (when-not (= id "default") (str "\u0000session\u0000" id)))))
(defn session-list [events]
  (->> events
       (filter #(and (valid-session? (:sessionId %)) (string? (:updatedAt %))))
       (sort-by :updatedAt)
       (reduce (fn [m e] (assoc m (:sessionId e) (select-keys e [:sessionId :title :createdAt :updatedAt :messageCount :state :kind :goal :cycleId :participants :maxTurns :completedTurns]))) {})
       vals (sort-by :updatedAt #(compare %2 %1)) vec))
(defn request-plan [{:keys [action botId sessionId model text requestId title]}]
  (when-not (valid-bot? botId) (throw (ex-info "invalid Bot identity" {})))
  (let [id (or sessionId "default")]
    (when-not (valid-session? id) (throw (ex-info "invalid session identity" {})))
    (case action
      "list" {:path "/v1/bot-chat/sessions" :body {:botId botId :action "list"}}
      "new" (do (when (or (= id "default") (not (string? title)) (> (count title) 120))
                        (throw (ex-info "new requires an explicit session UUID and bounded title" {})))
                 {:path "/v1/bot-chat/sessions" :body {:botId botId :action "create" :sessionId id :title title}})
      "show" {:path "/v1/bot-chat/history" :body {:botId botId :sessionId id}}
      "send" (do (when-not (and (= model "muse-spark-1.3") (valid-session? requestId)
                                (not= requestId "default") (string? text) (not (str/blank? text)) (<= (count text) 8192))
                        (throw (ex-info "send requires explicit model, request UUID and bounded text" {})))
                  {:path "/v1/bot-chat/turn" :body {:schema "awai.bot-chat-request.v1" :botId botId :sessionId id :model model :requestId requestId :text text}})
      (throw (ex-info "unknown conversation operation" {})))))
(defn command [args]
  (try
    (let [[action & tail] (remove nil? args)
          _ (when (odd? (count tail)) (throw (ex-info "expected named argument/value pairs" {})))
          flags (into {} (map vec (partition 2 tail)))
          _ (when (some #(not (contains? #{"--endpoint" "--bot" "--session" "--model" "--text-file" "--request" "--title"} %)) (keys flags))
              (throw (ex-info "unknown conversation argument" {})))
          endpoint (get flags "--endpoint")
          _ (when-not (and (string? endpoint) (re-matches #"https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?" endpoint))
              (throw (ex-info "explicit HTTPS Agent endpoint required" {})))
          file (get flags "--text-file")
          _ (when (and file (not (io/file? file))) (throw (ex-info "message file missing" {})))
          plan (request-plan {:action action :botId (get flags "--bot") :sessionId (get flags "--session")
                              :model (get flags "--model") :requestId (get flags "--request")
                              :title (get flags "--title" "") :text (when file (io/slurp-utf8 file))})
          ;; One explicit operator command, no shell, redirect, retry or provider fallback.
          r (io/spawn-sync! ["curl" "--silent" "--show-error" "--fail-with-body" "--max-time" "150"
                            "--request" "POST" "--header" "content-type: application/json"
                            "--data-binary" "@-" (str endpoint (:path plan))]
                           {:input (io/json-str (:body plan)) :timeout-ms 155000})]
      {:exit (if (zero? (:exit r)) 0 1) :lines [(if (zero? (:exit r)) (:stdout r) "Agent request unconfirmed; no automatic retry") ]})
    (catch #?(:clj Exception :cljs :default :lpy python/Exception) e
      {:exit 2 :lines [(ex-message e)]})))
