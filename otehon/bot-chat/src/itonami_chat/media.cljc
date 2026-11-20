(ns itonami-chat.media (:require [clojure.string :as str]))
(def uuid-pattern #"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
(def model-set "qwen-image-2.1-turbo-uncensored-ad-q2-k")
(defn admitted? [{:keys [requestId botId sessionId text image]}]
 (and (string? requestId) (re-matches uuid-pattern requestId)
      (string? botId) (re-matches #"profile:[\w.-]+" botId)
      (string? sessionId) (re-matches uuid-pattern sessionId)
      (string? text) (not (str/blank? text)) (<= 1 (count text) 8192)
      (= #{:imageId :sha256 :bytes :width :height :modelSet :engine} (set (keys image)))
      (= requestId (:imageId image)) (string? (:sha256 image)) (re-matches #"[a-f0-9]{64}" (:sha256 image))
      (integer? (:bytes image)) (<= 1 (:bytes image) 4194304)
      (= 512 (:width image)) (= 512 (:height image))
      (= model-set (:modelSet image)) (= "stable-diffusion.cpp" (:engine image))))
(defn events [{:keys [requestId botId sessionId text image at] :as request}]
 (when-not (and (admitted? request) (string? at) (re-matches #"[0-9TZ:.+-]+" at))
  (throw (ex-info "invalid-local-image-record" {})))
 [{:id requestId :role "user" :text text :at at}
  {:id (str requestId ":image") :parentId requestId :role "assistant" :text ""
   :kind "local-image" :image image :at at :speakerBotId botId
   :artifactScope {:botId botId :sessionId sessionId}
   :provenance "owner-reported-device-local-native-receipt"
   :verification "metadata-only-pixels-remain-on-generating-device"}])
