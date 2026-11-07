(ns awai.apps.bunsho
  #?(:cljs (:require ["react" :as react])))

;; Pure shared validation is readable in both Clojure and ClojureScript.
(defn valid-account-id? [account-id]
  (and (string? account-id) (.startsWith account-id "did:") (<= (count account-id) 512)))

#?(:cljs
   (do
     ;; This app stores exactly one local draft for each signed-in account.
     (defn ^:export draft-key [account-id]
       (when (valid-account-id? account-id)
         (str "otehon.bunsho.v1:" (js/encodeURIComponent account-id))))

     (defn ^:export read-draft [account-id]
       (if-let [key (draft-key account-id)]
         (try (or (.getItem js/localStorage key) "")
              (catch :default _ ""))
         ""))

     (defn ^:export save-draft [account-id text]
       (if-let [key (draft-key account-id)]
         (if (and (string? text) (<= (count text) 1000000))
           (try (.setItem js/localStorage key text)
                (= text (.getItem js/localStorage key))
                (catch :default _ false))
           false)
         false))

     (defn ^:export Bunsho [props]
       (let [account-id (.-accountDid props)
             text-state (react/useState (fn [] (read-draft account-id)))
             text (aget text-state 0)
             set-text (aget text-state 1)
             status-state (react/useState "")
             status (aget status-state 0)
             set-status (aget status-state 1)]
         (react/createElement
           "main" #js {:className "chat account-view" :data-app-view "bunsho"}
           (react/createElement
             "div" #js {:className "account-body"}
             (react/createElement "h1" nil "Bunsho")
             (react/createElement "p" #js {:className "muted"} "A local document draft for this account. Nothing is sent to a server.")
             (react/createElement "label" #js {:className "field"}
               "Document"
               (react/createElement "textarea" #js {:value text :rows 18 :aria-label "Document"
                 :onChange (fn [event] (set-text (.. event -target -value)) (set-status ""))}))
             (react/createElement "button" #js {:type "button" :className "secondary"
               :onClick (fn [] (set-status (if (save-draft account-id text) "Saved on this device." "Could not save on this device.")))}
               "Save document")
             (react/createElement "p" #js {:role "status"} status)))))))
