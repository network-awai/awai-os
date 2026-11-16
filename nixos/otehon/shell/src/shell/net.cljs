(ns shell.net
  (:require ["react" :refer [useState]]
            ["../net.js" :refer [requestIphoneTrust connectDevice forgetWifi joinWifi macError nameError pairBluetooth
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
   "auth-failed" "パスワードを確認して、もう一度お試しください。"
   "auth-required" "Wi-Fi パスワードを入力してください。"
   "unsupported-security" "この認証方式にはまだ対応していません。WPA2 Personal の Wi-Fi または有線をお使いください。"
   "join-timeout" "接続を確認できませんでした。電波とパスワードを確認してください。"
   "join-busy" "接続処理中です。しばらくお待ちください。"
   "join-failed" "Joining failed. Check the name and try again."
   "unknown-connection" "That saved connection is already gone."
   "power-failed" "The adapter did not switch."
   "pair-failed" "Pairing failed. Keep the device close and discoverable."
   "scan-failed" "Scanning failed. Try again."
   "unreachable" "The network service is not reachable."})

(defn problem [error]
  [:p.net-error {:role "status"} (get error-text error "Something went wrong.")])

(defn dot [up]
  [:span {:class (if up "net-dot net-up" "net-dot net-down") :aria-hidden "true"}])

(defn- network-row [ssid signal security on-join]
  [:li {:key ssid}
   [dot true]
   [:span ssid]
   [:span.muted (str signal "%" (if security (str " · " security) ""))]
   [:button {:type "button" :on-click on-join} "接続"]])

(defn wifi-panel [props]
  (let [embedded (boolean (:embedded props))
        status (useNetStatus)
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
                  (when invalid (set-result #js {:ok false :error invalid}))
                  (when-not (or invalid busy)
                    (set-busy true)
                    (set-result nil)
                    (-> (joinWifi ssid (if (empty? psk) js/undefined psk))
                        (.then (fn [done]
                                 (set-busy false)
                                 (set-result done)
                                 (when (.-ok done) (set-psk "")))))))
        forget (fn [network-name]
                 (when-not (nameError network-name)
                   (-> (forgetWifi network-name)
                       (.then (fn [done] (set-result done))))))
        found (or (some-> networks (.-networks)) #js [])
        saved (or (some-> known (.-known)) #js [])]
    [(if embedded :section :main.chat.net-view) {:data-net "wifi" :class (when embedded "setup-network") :lang "ja"}
     [:div.net-body
      [(if embedded :h2 :h1) "Wi-Fi"]
      [:p.muted {:data-net-link (or (some-> status (.-link)) "unknown")}
       [dot (= "up" (some-> status (.-link)))] " "
       (cond
         (nil? status) "確認しています…"
         (.-error status) "確認できません"
         (= "up" (some-> status (.-link))) "接続済み（インターネットは別途確認）"
         :else "未接続")]
      (when-not status [:p.muted "確認しています…"])
      (when (some-> status (.-error)) (problem (.-error status)))
      (when (and status (not (.-error status)) (not (some-> wifi (.-available))))
        [:p.muted "Wi-Fi アダプターが見つかりません。有線または USB 接続も利用できます。"])
      [:<>
         [:h2 "有線・USB 接続"]
         (when (some-> status (.-iphone) (.-attached))
           [:div
            [:p "iPhone のロックを解除し、インターネット共有を有効にしてください。"]
            [:button {:type "button" :disabled busy :on-click #(do (set-busy true)
              (-> (requestIphoneTrust) (.then (fn [done] (set-busy false) (set-result done)))))} "iPhone に信頼確認を表示"]
            (when (some-> result (.-trust))
              [:p {:role "status"}
               (if (= "paired" (.-trust result)) "信頼を確認しました。下の USB 接続を選んでください。"
                 "iPhone 側でロックを解除して、この PC を信頼してください。")])])
         [:ul.net-list
          (map (fn [device]
                 [:li {:key (.-name device)}
                  [:span (str (.-name device) " · " (.-route device))]
                  [:span.muted (if (.-connected device) "接続済み" (if (.-managed device) "未接続" "診断用 LAN・管理対象外"))]
                  (when (and (.-managed device) (not= "wifi" (.-route device)) (not= "bluetooth-pan" (.-route device)))
                    [:button {:type "button" :disabled busy
                              :on-click #(do (set-busy true) (-> (connectDevice (.-name device))
                                (.then (fn [done] (set-busy false) (set-result done)))))} "接続"])])
               (or (some-> status (.-devices)) #js []))]
         (when (some-> wifi (.-available))
          [:<>
         [:h2 "近くの Wi-Fi"]
         (when (some-> networks (.-error)) (problem (.-error networks)))
         (when (and networks (not (some-> networks (.-error))) (zero? (.-length found)))
           [:p.muted "Wi-Fi が見つかりません。スマートフォンの「インターネット共有」も確認してください。"])
         [:ul.net-list
          (map (fn [item]
                  [network-row (.-ssid item) (.-signal item) (.-security item)
                   #(do (set-ssid (.-ssid item))
                         (js/requestAnimationFrame (fn [] (some-> (.getElementById js/document "wifi-key") (.focus)))))]) found)]
         [:h2 "Wi-Fi に接続"]
         [:form.net-form {:on-submit join-fn}
          [:label {:for "wifi-ssid"}
           "ネットワーク名"
           [:input {:aria-label "ネットワーク名" :id "wifi-ssid" :required true :value ssid
                     :on-change #(set-ssid (.. % -target -value))}]]
          [:label {:for "wifi-key"}
           "パスワード（必要な場合）"
           [:input {:id "wifi-key" :aria-label "Wi-Fi パスワード" :type "password" :auto-complete "current-password"
                     :value psk :on-change #(set-psk (.. % -target -value))}]]
          [:button.primary {:type "submit" :disabled busy}
           (if busy "接続しています…" "接続")]]
         [:h2 "保存済み Wi-Fi"]
         (when (some-> known (.-error)) (problem (.-error known)))
         (when (and (zero? (.-length saved)) (not (some-> known (.-error))))
           [:p.muted "保存済みの接続はありません。"])
         [:ul.net-list
          (map (fn [item]
                  [:li {:key (.-name item)}
                   [:span (.-name item)]
                   [:button {:type "button" :on-click #(forget (.-name item))} "削除"]]) saved)]])
         (when (and result (not (.-ok result))) (problem (.-error result)))
         (when (some-> result (.-ok))
           [:p {:role "status" :data-net-joined (.-connected result)}
            (str (.-connected result) " に接続しました。")])
]]]))

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
      (when-not status [:p.muted "確認しています…"])
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
