(ns shell.display
  (:require ["react" :refer [useEffect useState]]
            ["../display.js" :refer [brightnessError setBrightness useDisplayStatus]]))

(def error-text
  {"bad-brightness" "Brightness is 0 to 100."
   "bad-json" "The request was not understood."
   "no-adapter" "This device has no brightness control."
   "brightness-failed" "The brightness did not change."
   "unreachable" "The display service is not reachable."})

(defn problem [error]
  [:p.net-error (get error-text error "Something went wrong.")])

(defn display-panel []
  (let [status (useDisplayStatus)
        [level set-level] (useState 80)
        [busy set-busy] (useState false)
        [result set-result] (useState nil)]
    (useEffect
     (fn []
       (when (number? (some-> status (.-brightness)))
         (set-level (.-brightness status))) js/undefined)
     #js [(some-> status (.-brightness))])
    (let [invalid (brightnessError level)
          apply-fn (fn [value]
                     (when-not (or invalid busy)
                       (set-busy true)
                       (set-result nil)
                       (-> (setBrightness value)
                           (.then (fn [done]
                                    (set-busy false)
                                    (set-result (if (.-ok done) nil done))
                                    (when (.-ok done)
                                      (set-level (.-brightness done))))))))]
      [:main.chat.net-view {:data-net "display"}
       [:div.net-body
        [:h1 "Display"]
        (when-not status [:p.muted "Checking…"])
        (when (some-> status (.-error)) (problem (.-error status)))
        (when (and status (not (.-error status)) (not (.-available status)))
          [:p.muted "This device has no brightness control. The last setting stays saved."])
        (when (some-> status (.-available))
          [:<>
           [:p.muted {:data-net-device (or (.-device status) "unknown")}
            (str (or (.-device status) "Output") " · Brightness " (.-brightness status))]
           [:div.net-form
            [:label
             "Brightness"
             [:input {:aria-label "Brightness" :type "range" :min "0" :max "100"
                       :value level :disabled busy
                       :on-change #(set-level (js/Number (.. % -target -value)))
                       :on-mouse-up #(apply-fn level)
                       :on-touch-end #(apply-fn level)}]]
            [:button.primary {:type "button" :disabled (or (some? invalid) busy) :on-click #(apply-fn level)}
             (if busy "Setting…" "Set brightness")]]
           (when (and result (not (.-ok result)))
             (problem (.-error result)))])]])))
