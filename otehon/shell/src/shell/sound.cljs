(ns shell.sound
  (:require ["react" :refer [useEffect useState]]
            ["../sound.js" :refer [setMuted setVolume useSoundStatus volumeError]]))

(def error-text
  {"bad-volume" "Volume is 0 to 100."
   "bad-mute" "The switch was not understood."
   "bad-json" "The request was not understood."
   "no-adapter" "This device has no sound output."
   "no-session" "Nobody is signed in to play sound."
   "volume-failed" "The volume did not change."
   "mute-failed" "The switch did not change."
   "unreachable" "The sound service is not reachable."})

(defn problem [error]
  [:p.net-error (get error-text error "Something went wrong.")])

(defn sound-panel []
  (let [status (useSoundStatus)
        [level set-level] (useState 50)
        [busy set-busy] (useState false)
        [result set-result] (useState nil)]
    (useEffect
     (fn []
       (when (number? (some-> status (.-volume)))
         (set-level (.-volume status))) js/undefined)
     #js [(some-> status (.-volume))])
    (let [invalid (volumeError level)
          apply-fn (fn [volume]
                     (when-not (or invalid busy)
                       (set-busy true)
                       (set-result nil)
                       (-> (setVolume volume)
                           (.then (fn [done]
                                    (set-busy false)
                                    (set-result (if (.-ok done) nil done))
                                    (when (.-ok done)
                                      (set-level (.-volume done))))))))
          flip (fn []
                 (when-not (or busy (not (boolean? (.-muted status)))))
                 (set-busy true)
                 (set-result nil)
                 (-> (setMuted (not (.-muted status)))
                     (.then (fn [done]
                              (set-busy false)
                              (set-result (if (.-ok done) nil done))))))]
      [:main.chat.net-view {:data-net "sound"}
       [:div.net-body
        [:h1 "Sound"]
        (when-not status [:p.muted "Checking…"])
        (when (some-> status (.-error)) (problem (.-error status)))
        (when (and status (not (.-error status)) (not (.-available status)))
          [:p.muted "This device has no sound output. The last setting stays saved."])
        (when (some-> status (.-available))
          [:<>
           [:p.muted {:data-net-sink (or (.-sink status) "unknown")}
            (str (or (.-sink status) "Output") " · "
                 (if (.-muted status) "Muted" (str "Volume " (.-volume status))))]
           [:div.net-form
            [:label
             "Volume"
             [:input {:aria-label "Volume" :type "range" :min "0" :max "100"
                       :value level :disabled busy
                       :on-change #(set-level (js/Number (.. % -target -value)))
                       :on-mouse-up #(apply-fn level)
                       :on-touch-end #(apply-fn level)}]]
            [:button.primary {:type "button" :disabled (or (some? invalid) busy) :on-click #(apply-fn level)}
             (if busy "Setting…" "Set volume")]
            [:button {:type "button" :disabled busy :on-click flip}
             (if (.-muted status) "Unmute" "Mute")]]
           (when (and result (not (.-ok result)))
             (problem (.-error result)))])]])))
