(ns shell.inference-check
  (:require ["../inference-client.gen.js" :refer [createInferenceClient]]))

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
        (.catch (fn [error] (js/console.error error) (set! (.-exitCode js/process) 1))))))
