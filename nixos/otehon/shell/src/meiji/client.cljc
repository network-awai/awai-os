(ns meiji.client)

#?(:cljs
   (do
     (defn available? [] (boolean (some-> js/window (aget "__TAURI__") (aget "core") (aget "invoke"))))
     (defn request [value]
       (if (available?)
         (-> ((aget (aget (aget js/window "__TAURI__") "core") "invoke") "meiji_request" #js {:request (clj->js value)})
             (.then (fn [reply]
                      (if-let [error (aget reply "error")] (throw (js/Error. error))
                        (js->clj (aget reply "ok") :keywordize-keys true)))))
         (js/Promise.reject (js/Error. "desktop-required"))))
     (defn report-response [file options]
       (if (available?)
         (-> (request {:op "report" :id file})
             (.then (fn [report] #js {:ok true :json (fn [] (js/Promise.resolve (js/JSON.parse (:text report))))})))
         (js/fetch (str "./" file) options)))))
