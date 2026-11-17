(ns itonami-chat.sessions (:require [cheshire.core :as json] [itonami.otehon.conversation :as c] [itonami.otehon.io :as io]))
(defn -main []
 (let [{:keys [op owner botId sessionId events]} (json/parse-string (slurp *in*) true)]
  (println (json/generate-string
   (case op
    "scope" {:thread (c/session-scope owner botId (or sessionId "default"))
              :index (do (c/session-scope owner botId "default") (io/sha256-utf8 (str "itonami-agent/session-index/v1\u0000" owner "\u0000" botId)))}
    "list" (c/session-list events)
    (throw (ex-info "unknown session adapter operation" {})))))))
