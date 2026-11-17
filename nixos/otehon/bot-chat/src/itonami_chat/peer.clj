(ns itonami-chat.peer (:require [cheshire.core :as json] [itonami.otehon.peer-talk :as p]))
(defn -main [] (let [{:keys [grant turns]} (json/parse-string (slurp *in*) true)] (println (json/generate-string (p/turn-plan grant turns)))))
