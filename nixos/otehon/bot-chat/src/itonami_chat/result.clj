(ns itonami-chat.result (:require [cheshire.core :as json] [itonami.otehon.muse :as muse]))
(defn -main [] (let [{:keys [events exitCode model]} (json/parse-string (slurp *in*) true)]
 (println (json/generate-string (muse/result {:status :ok :provider "meta" :model model :reasoning-effort "low"} events exitCode)))))
