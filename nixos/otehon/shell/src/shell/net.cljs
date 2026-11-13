(ns shell.net
  (:require ["react" :refer [useState]]
            ["../net.js" :refer [forgetWifi joinWifi macError nameError pairBluetooth
                                 pskError setBluetoothPower ssidError useBluetoothDevices
                                 useNetStatus useWifiKnown useWifiNetworks]]))

(def error-text
  {"bad-ssid" "The network name is empty or too long."
   "bad-psk" "The key is 8 to 63 characters, or 64 hex digits."
   "bad-name" "That saved connection cannot be named here."
   "bad-mac" "That is not a device address like AA:BB:CC:DD:EE:FF."
   "bad-json" "The request was not understood."
   "no-adapter" "This device has no such adapter."
   "no-network" "No network with that name answered."
   "auth-failed" "The key was refused."
   "join-failed" "Joining failed. Check the name and try again."
   "unknown-connection" "That saved connection is already gone."
   "power-failed" "The adapter did not switch."
   "pair-failed" "Pairing failed. Keep the device close and discoverable."
   "scan-failed" "Scanning failed. Try again."
   "unreachable" "The network service is not reachable."})

(defn problem [error]
  [:p.net-error (get error-text error "Something went wrong.")])

(defn dot [up]
  [:span {:class (if up "net-dot net-up" "net-dot net-down") :aria-hidden "true"}])

(defn- network-row [ssid signal security on-join]
  [:li {:key ssid}
   [dot true]
   [:span ssid]
   [:span.muted (str signal "%" (if security (str " · " security) ""))]
   [:button {:type "button" :on-click on-join} "Join"]])

(defn wifi-panel []
  (let [status (useNetStatus)
        wifi (some-> status (.-wifi))
        networks (useWifiNetworks (boolean (some-> wifi (.-available))))
        known (useWifiKnown (boolean (some-> wifi (.-available))))
        [ssid set-ssid] (useState "")
        [psk set-psk] (useState "")
        [busy set-busy] (useState false)
        [result set-result] (useState nil)
        invalid (or (ssidError ssid) (pskError psk))
        join-fn (fn [event]
                  (.preventDefault event)
                  (when-not (or invalid busy)
                    (set-busy true)
                    (set-result nil)
                    (-> (joinWifi (.trim ssid) (if (empty? psk) js/undefined psk))
                        (.then (fn [done]
                                 (set-busy false)
                                 (set-result done))))))
        forget (fn [network-name]
                 (when-not (nameError network-name)
                   (-> (forgetWifi network-name)
                       (.then (fn [done] (set-result done))))))
        found (or (some-> networks (.-networks)) #js [])
        saved (or (some-> known (.-known)) #js [])]
    [:main.chat.net-view {:data-net "wifi"}
     [:div.net-body
      [:h1 "Wi-Fi"]
      [:p.muted {:data-net-link (or (some-> status (.-link)) "unknown")}
       [dot (= "up" (some-> status (.-link)))] " "
       (cond
         (nil? status) "Checking…"
         (.-error status) "Unknown"
         (= "up" (some-> status (.-link))) "Connected"
         :else "Not connected")]
      (when-not status [:p.muted "Checking…"])
      (when (some-> status (.-error)) (problem (.-error status)))
      (when (and status (not (.-error status)) (not (some-> wifi (.-available))))
        [:p.muted "This device has no Wi-Fi adapter. Saved networks stay saved."])
      (when (some-> wifi (.-available))
        [:<>
         [:h2 "Networks"]
         (when (some-> networks (.-error)) (problem (.-error networks)))
         (when (and networks (not (some-> networks (.-error))) (zero? (.-length found)))
           [:p.muted "No networks found."])
         [:ul.net-list
          (map (fn [item]
                  [network-row (.-ssid item) (.-signal item) (.-security item)
                   #(set-ssid (.-ssid item))]) found)]
         [:h2 "Join a network"]
         [:form.net-form {:on-submit join-fn}
          [:label
           "Network name"
           [:input {:aria-label "Network name" :value ssid
                     :on-change #(set-ssid (.. % -target -value))}]]
          [:label
           "Key, when the network needs one"
           [:input {:aria-label "Network key" :type "password" :auto-complete "off"
                     :value psk :on-change #(set-psk (.. % -target -value))}]]
          [:button.primary {:type "submit" :disabled (or (some? invalid) busy)}
           (if busy "Joining…" "Join")]]
         (when (and result (not (.-ok result))) (problem (.-error result)))
         (when (some-> result (.-ok))
           [:p {:data-net-joined (.-connected result)}
            (str "Joined " (.-connected result) ".")])
         [:h2 "Saved networks"]
         (when (some-> known (.-error)) (problem (.-error known)))
         (when (and (zero? (.-length saved)) (not (some-> known (.-error))))
           [:p.muted "None saved."])
         [:ul.net-list
          (map (fn [item]
                  [:li {:key (.-name item)}
                   [:span (.-name item)]
                   [:button {:type "button" :on-click #(forget (.-name item))} "Forget"]]) saved)]])]]))

(defn bluetooth-panel []
  (let [status (useNetStatus)
        bluetooth (some-> status (.-bluetooth))
        devices (useBluetoothDevices (boolean (some-> bluetooth (.-available))))
        [mac set-mac] (useState "")
        [busy set-busy] (useState nil)
        [result set-result] (useState nil)
        power (fn [on]
                (set-busy "power")
                (set-result nil)
                (-> (setBluetoothPower on)
                    (.then (fn [done]
                             (set-busy nil)
                             (set-result (if (.-ok done) nil done))))))
        pair (fn [address]
               (when-not (or (macError address) busy)
                 (set-busy address)
                 (set-result nil)
                 (-> (pairBluetooth address)
                     (.then (fn [done]
                              (set-busy nil)
                              (set-result (if (.-ok done)
                                            #js {:ok true :paired (.-paired done)}
                                            done)))))))
        found (or (some-> devices (.-devices)) #js [])]
    [:main.chat.net-view {:data-net "bluetooth"}
     [:div.net-body
      [:h1 "Bluetooth"]
      (when-not status [:p.muted "Checking…"])
      (when (some-> status (.-error)) (problem (.-error status)))
      (when (and status (not (.-error status)) (not (.-available bluetooth)))
        [:p.muted "This device has no Bluetooth adapter."])
      (when (some-> bluetooth (.-available))
        [:<>
         [:p
          [dot (.-powered bluetooth)] " " (if (.-powered bluetooth) "On" "Off") " "
          [:button {:type "button"
                     :on-click #(power (not (.-powered bluetooth)))
                     :disabled (= busy "power")}
           (str "Turn " (if (.-powered bluetooth) "off" "on"))]]
         (when (.-powered bluetooth)
           [:<>
            [:h2 "Devices"]
            (when (some-> devices (.-error)) (problem (.-error devices)))
            (when (and (zero? (.-length found)) (not (some-> devices (.-error))))
              [:p.muted "Nothing nearby. Keep the device discoverable."])
            [:ul.net-list
             (map (fn [item]
                     [:li {:key (.-mac item)}
                      [dot (.-connected item)]
                      [:span (.-name item)]
                      [:span.muted (str (.-mac item) (if (.-paired item) " · paired" ""))]
                      (when-not (.-paired item)
                        [:button {:type "button"
                                   :disabled (= busy (.-mac item))
                                   :on-click #(pair (.-mac item))}
                         (if (= busy (.-mac item)) "Pairing…" "Pair")])]) found)]
            [:h2 "Pair by address"]
            [:form.net-form {:on-submit (fn [event]
                                          (.preventDefault event)
                                          (pair (.trim mac)))}
             [:label
              "Device address"
              [:input {:aria-label "Device address" :value mac
                        :on-change #(set-mac (.. % -target -value))}]]
             [:button.primary {:type "submit" :disabled (or (some? (macError mac)) (some? busy))}
              "Pair"]]])
         (when (and result (not (.-ok result))) (problem (.-error result)))
         (when (some-> result (.-ok))
           [:p {:data-net-paired (.-paired result)}
            (str "Paired " (.-paired result) ".")])])]]))
