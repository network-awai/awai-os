(ns itonami-chat.voice-adapter (:require [cheshire.core :as json] [itonami-chat.voice :as voice]))
(defn -main [& _]
 (let [{:keys [action frame state elapsedMs]} (json/parse-string (slurp *in*) true)
       value (case action "open" (voice/open frame) "turn" (voice/admit-turn state frame elapsedMs) nil)]
  (println (json/generate-string {:schema "awai.bot-voice-admission.v1" :admitted (some? value) :value value}))))
