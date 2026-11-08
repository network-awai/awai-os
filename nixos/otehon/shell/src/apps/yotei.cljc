(ns awai.apps.yotei
  #?(:cljs (:require ["react" :as react])))

#?(:cljs
   (do
     (defn key-for [account]
       (when (and (string? account) (.startsWith account "did:") (<= (count account) 512))
         (str "otehon.yotei.v1:" (js/encodeURIComponent account))))
     (defn valid-entry? [entry]
       (and (some? entry) (string? (.-title entry)) (<= 1 (count (.-title entry)) 200)
            (string? (.-date entry)) (boolean (re-matches #"\d{4}-\d{2}-\d{2}" (.-date entry)))
            (let [d (js/Date. (str (.-date entry) "T00:00:00Z"))]
              (and (not (js/Number.isNaN (.getTime d))) (= (.-date entry) (.slice (.toISOString d) 0 10))))))
     (defn read-events [account]
       (if-let [key (key-for account)]
         (try
           (let [raw (.getItem js/localStorage key)]
             (if (nil? raw)
               #js {:ok true :events #js []}
               (let [events (js/JSON.parse raw)]
                 (if (and (<= (count raw) 200000) (js/Array.isArray events)
                          (<= (.-length events) 500) (.every events valid-entry?))
                   #js {:ok true :events events}
                   #js {:ok false :events #js []}))))
           (catch :default _ #js {:ok false :events #js []}))
         #js {:ok false :events #js []}))
     (defn save-events [account events]
       (if-let [key (key-for account)]
         (try
           (let [raw (js/JSON.stringify events)]
             (if (and (<= (.-length events) 500) (<= (count raw) 200000))
               (do (.setItem js/localStorage key raw) (= raw (.getItem js/localStorage key)))
               false))
           (catch :default _ false))
         false))
     (defn ^:export Yotei [props]
       (let [account (.-accountDid props)
             initial (react/useMemo (fn [] (read-events account)) #js [account])
             events-state (react/useState (.-events initial)) events (aget events-state 0) set-events (aget events-state 1)
             title-state (react/useState "") title (aget title-state 0) set-title (aget title-state 1)
             date-state (react/useState "") date (aget date-state 0) set-date (aget date-state 1)
             note-state (react/useState "") note (aget note-state 0) set-note (aget note-state 1)
             persist (fn [next]
                       (if (save-events account next)
                         (do (set-events next) (set-note "Saved on this device."))
                         (set-note "Could not save on this device.")))]
         (react/createElement "main" #js {:className "chat account-view" :data-app-view "yotei"}
           (react/createElement "div" #js {:className "account-body"}
             (react/createElement "h1" nil "Yotei")
             (react/createElement "p" nil "A local schedule for this account. Events stay on this device.")
             (if-not (.-ok initial)
               (react/createElement "p" #js {:role "alert"} "The saved schedule could not be read. It has not been changed.")
               (react/createElement "div" nil
                 (react/createElement "label" #js {:className "field"} "Event"
                   (react/createElement "input" #js {:aria-label "Event" :value title :maxLength 200
                     :onChange (fn [e] (set-title (.. e -target -value)))}))
                 (react/createElement "label" #js {:className "field"} "Date"
                   (react/createElement "input" #js {:aria-label "Date" :type "date" :value date
                     :onChange (fn [e] (set-date (.. e -target -value)))}))
                 (react/createElement "button" #js {:type "button" :className "secondary"
                   :onClick (fn []
                     (let [event #js {:title (.trim title) :date date}]
                       (if (valid-entry? event)
                         (let [next (.concat events #js [event])]
                           (if (save-events account next)
                             (do (set-events next) (set-title "") (set-date "") (set-note "Saved on this device."))
                             (set-note "Could not save on this device.")))
                         (set-note "Enter an event and a date."))))} "Add event")
                 (react/createElement "ul" #js {:aria-label "Events"}
                   (into-array
                     (map-indexed (fn [index event]
                       (react/createElement "li" #js {:key (str index ":" (.-date event) ":" (.-title event))}
                         (react/createElement "span" nil (str (.-date event) " — " (.-title event) " "))
                         (react/createElement "button" #js {:type "button" :aria-label (str "Remove " (.-title event))
                           :onClick (fn [] (persist (.filter events (fn [_ i] (not= i index)))))} "Remove")))
                       (array-seq events))))))
             (react/createElement "p" #js {:role "status"} note)))))))
