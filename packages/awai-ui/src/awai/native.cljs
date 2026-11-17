(ns awai.native)
;; Styling adapter for owning legacy DOM. Never replace controls or their listeners,
;; change disabled/hidden/value/type, route, approve, call a service, or persist state.
(defn bind-native [root opts]
 (let [selector (or (:buttons opts) "button") tonal (or (:tonal opts) ".tonal,.secondary")
       text (or (:text opts) ".text-button") skip (or (:skip opts) ".kotoba-client-consent")
       decorate (fn []
        (doseq [b (.querySelectorAll root selector)]
         (when-not (.closest b skip)
          (.add (.-classList b) "awai-button")
          (doseq [[cls active] [["awai-button--tonal" (.matches b tonal)] ["awai-button--text" (.matches b text)]
                               ["awai-button--primary" (not (or (.matches b tonal) (.matches b text)))]]]
           (.toggle (.-classList b) cls active)))))
       observer (js/MutationObserver. (fn [_] (decorate)))]
  (.add (.-classList root) "awai-ui" "awai-native-host")
  (decorate)
  (.observe observer root #js{:childList true :subtree true})
  (fn [] (.disconnect observer))))
