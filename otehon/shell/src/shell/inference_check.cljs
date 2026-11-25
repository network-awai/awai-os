(ns shell.inference-check
  (:require ["../setup-state.js" :refer [createSetupState]]
            ["../inference-client.gen.js" :refer [createInferenceClient]]))

;; Exercise the same advanced compiler as the browser against literal native
;; JSON. Source-only SDK tests cannot detect property renaming on the wire.
(defn main []
  (let [id "11111111-1111-4111-a111-111111111111"
        calls (atom [])
        client (createInferenceClient
                #js {:uuid (fn [] id)
                     :invoke (fn [command args]
                               (swap! calls conj [command (js->clj (.parse js/JSON (.stringify js/JSON args)) :keywordize-keys true)])
                               (js/Promise.resolve
                                 (.parse js/JSON
                                   (if (= "info" (aget args "request" "action"))
                                     "{\"installed\":true,\"status\":{\"loaded\":true}}"
                                     "{\"schema\":\"awai.inference.result.v1\",\"requestId\":\"11111111-1111-4111-a111-111111111111\",\"modality\":\"text\",\"engine\":\"llama.cpp\",\"text\":\"native JSON fixture\",\"outputTokens\":7}"))))})]
    (-> (.info client)
        (.then (fn [info]
                 (when-not (and (.-installed info) (some-> info .-status .-loaded))
                   (throw (js/Error. "advanced-native-readiness-keys-renamed")))
                 (.generate client #js {:prompt "public fixture" :modality "text" :maxTokens 7})))
        (.then (fn [result]
                 (when-not (= ["awai_local_inference"
                               {:request {:action "generate" :schema "awai.inference.request.v1"
                                          :requestId id :modality "text" :prompt "public fixture" :maxTokens 7}}]
                              (last @calls))
                   (throw (js/Error. "advanced-native-request-keys-renamed")))
                 (when-not (and (= "text" (aget result "modality")) (= 7 (aget result "outputTokens")))
                   (throw (js/Error. "advanced-native-response-keys-renamed")))
                 (js/console.log "PASS: advanced SDK preserves native readiness/request/result JSON keys")))
        (.then (fn [_]
          (let [image-client (createInferenceClient #js {:uuid (fn [] id)
            :invoke (fn [_ args]
              (js/Promise.resolve (.parse js/JSON
                (if (= "saveImage" (aget args "request" "action"))
                  "{\"saved\":true,\"readbackVerified\":true,\"uri\":\"content://media/external/images/media/1\",\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}"
                  "{\"schema\":\"awai.inference.result.v1\",\"requestId\":\"11111111-1111-4111-a111-111111111111\",\"imageId\":\"11111111-1111-4111-a111-111111111111\",\"modality\":\"image\",\"engine\":\"stable-diffusion.cpp\",\"modelSet\":\"qwen-image-2.1-turbo-uncensored-ad-q2-k\",\"width\":512,\"height\":512,\"bytes\":3,\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"dataUrl\":\"data:image/png;base64,YWJj\"}"))))})]
            (-> (.generate image-client #js {:modality "image" :prompt "public image fixture"})
              (.then (fn [r] (when-not (= id (.-imageId r)) (throw (js/Error. "advanced-image-keys-renamed"))) (.saveImage image-client (.-imageId r))))
              (.then (fn [r] (when-not (.-readbackVerified r) (throw (js/Error. "advanced-save-keys-renamed"))) (js/console.log "PASS: advanced image and save native JSON keys")))))))
        (.then (fn [_]
                 (let [requests (atom [])
                       reject-generation (atom nil)
                       invoke (fn [_ args]
                                (swap! requests conj (js->clj (.parse js/JSON (.stringify js/JSON (aget args "request"))) :keywordize-keys true))
                                (if (= "cancel" (aget args "request" "action"))
                                  (do (@reject-generation "inference-cancelled")
                                      (js/Promise.resolve (.parse js/JSON "{\"cancelled\":true}")))
                                  (js/Promise. (fn [_ reject] (reset! reject-generation reject)))))
                       cancelling (createInferenceClient (js-obj "uuid" (fn [] id) "invoke" invoke))
                       handle (.startGeneration cancelling #js {:prompt "public fixture" :modality "text"})
                       result (.then (.-result handle)
                                     (fn [_] (throw (js/Error. "cancel-did-not-reject")))
                                     (fn [error]
                                       (when-not (= "inference-cancelled" (.-message error))
                                         (throw (js/Error. "advanced-cancel-code-renamed")))))]
                   (-> (js/Promise.all #js [result (.cancel cancelling (.-requestId handle))])
                       (.then (fn [outcomes]
                                (when-not (true? (.-cancelled (aget outcomes 1)))
                                  (throw (js/Error. "advanced-cancel-answer-renamed")))
                                (when-not (= [{:action "generate" :schema "awai.inference.request.v1"
                                               :requestId id :modality "text" :prompt "public fixture" :maxTokens 128}
                                              {:action "cancel" :requestId id}]
                                             @requests)
                                  (throw (js/Error. "advanced-cancel-request-renamed")))
                                (js/console.log "PASS: advanced SDK cancels a pending generation using its public request ID")))))))
        (.then (fn [_]
                 (.complete (createSetupState
                              #js {:invoke (fn [_ _] (js/Promise.resolve (.parse js/JSON "{\"schema\":\"awai.setup.state.v1\",\"complete\":true}")))
                                   :storage #js {:getItem (fn [_] nil)}}))))
        (.then (fn [done] (when-not done (throw (js/Error. "native-setup-not-committed")))
                 (js/console.log "PASS: advanced setup persistence waits for literal native JSON ack")))
        (.catch (fn [error] (js/console.error error) (set! (.-exitCode js/process) 1))))))
