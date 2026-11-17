(ns itonami-chat.media-adapter (:require [cheshire.core :as json] [itonami-chat.media :as media]))
(defn -main []
 (try (println (json/generate-string {:events (media/events (json/parse-string (slurp *in*) true))}))
  (catch Exception _ (binding [*out* *err*] (println "invalid-local-image-record")) (System/exit 1))))
