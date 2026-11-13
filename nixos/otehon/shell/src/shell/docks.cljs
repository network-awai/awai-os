(ns shell.docks
  (:require ["react" :refer [useState]]
            [shell.manimani :refer [status-text use-manimani]]
            ["../trust.js" :refer [POINTS]]
            ["../status.js" :refer [formatKiB memUsedPercent portRows summarizeSystem
                                    useHttpPorts useSystem useZenohRouters]]))

(defn- short-did [did]
  (if (> (count did) 26) (str (subs did 0 14) "…" (subs did (- (count did) 8))) did))

(defn- manimani-status [state]
  (if-not state "stopped" (if (.-paused state) "paused" (.-status state))))

(defn dock-button [active label value toggle panel]
  [:button {:type "button"
             :class (if active "dock-button active" "dock-button")
             :aria-expanded active
             :data-dock-toggle panel
             :on-click toggle}
   [:span.dock-label label]
   (when value [:span.dock-value value])])

(defn dock [side & children]
  (into [:div {:class (str "dock-cluster dock-" side) :data-dock side}] children))

(defn panel [panel-name title on-close & children]
  (into [:section.dock-panel {:aria-label title :data-dock-panel panel-name}
         [:div.dock-panel-head
          [:h2 title]
          [:button.dock-close {:type "button" :aria-label "Close panel" :on-click on-close} "×"]]]
        children))

(defn state-dot [state]
  [:span {:class (str "dot dot-" state) :data-state state :aria-hidden "true"}])

(defn device-dock [account score wallet-balance proofs capabilities zenoh matter on-account]
  (let [[open set-open] (useState nil)
        [manimani] (use-manimani)
        toggle (fn [panel-name] (set-open (fn [current] (if (= current panel-name) nil panel-name))))
        services [{:name "Speech" :up (pos? (.-length (.-speech capabilities)))}
                  {:name "Images" :up (.-image capabilities)}
                  {:name "Manimani" :up (= "ready" (manimani-status manimani))}
                  {:name "Zenoh" :up zenoh}
                  {:name "Matter" :up matter}]
        provided (count (filter :up services))
        activity (-> (or (some-> manimani (.-activity)) #js []) (.slice -5) (.reverse))
        address (let [m (.exec #"^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$" (or (.-accountDid account) ""))]
                  (when m (aget m 1)))]
    [dock "left"
     (when (= open "wallet")
       [panel "wallet" "Wallet" #(set-open nil)
        [:p.account-id {:data-dock-wallet (.-accountDid account)} (short-did (.-accountDid account))]
        [:dl.dock-facts
         [:dt "Method"]
         [:dd (if (= "wallet" (.-method account)) "Web3 wallet" "Passkey")]
         (when address [:<> [:dt "Address"] [:dd.account-id address]])
         [:dt "Link expires"]
         [:dd (.toLocaleDateString (js/Date. (.-expiresAt account)))]
         [:dt "Trust score"]
         [:dd {:data-dock-trust score}
          (str score " (sign-in +" (.-login POINTS)
               (when (= (some-> proofs (.-passport) (.-account)) (.-accountDid account))
                 (str ", passport +" (.-passport POINTS)))
               (when (= (some-> proofs (.-worldId) (.-account)) (.-accountDid account))
                 (str ", World ID +" (.-worldId POINTS)))
               ")")]]
        [:p.muted (if address
                      "アカウントで接続先を確認してから ETH 残高を取得できます。"
                      "残高の確認には Wallet でのサインインが必要です。")]
        [:button.secondary {:type "button" :on-click on-account} "Open Account"]])
     (when (= open "providing")
       [panel "providing" "Providing on this device" #(set-open nil)
        [:ul.dock-list
         (map (fn [service]
                [:li {:key (:name service)}
                 [state-dot (if (:up service) "up" "down")]
                 [:span (:name service)]
                 [:span.muted (if (:up service) "Running" "Not reachable")]])
              services)]
        [:p.muted "Every service above listens on loopback only."]])
     (when (= open "activity")
       [panel "activity" "Activity" #(set-open nil)
        (when (zero? (.-length activity)) [:p.muted (get status-text (manimani-status manimani))])
        [:ul.dock-list
         (map (fn [item]
                 [:li {:key (str (.-at item) "-" (.-kind item))}
                  [:span.muted (.toLocaleTimeString (js/Date. (.-at item)))]
                  [:span (str (.-kind item) (if (.-detail item) (str ": " (.-detail item)) ""))]]) activity)]])
     [:div.dock-buttons {:data-dock-left true}
      [dock-button (= open "wallet") "Wallet"
       (if (nil? wallet-balance) "ETH —" (str wallet-balance " ETH"))
       #(toggle "wallet") "wallet"]
      [dock-button (= open "providing") "Providing" (str provided "/" (count services)) #(toggle "providing") "providing"]
      [dock-button (= open "activity") "Activity"
       (let [n (.-length (or (some-> manimani (.-activity)) #js []))] (when (pos? n) (str n)))
       #(toggle "activity") "activity"]]]))

(defn node-dock [did zenoh matter]
  (let [[open set-open] (useState nil)
        [manimani] (use-manimani)
        system (useSystem)
        ports (useHttpPorts)
        routers (useZenohRouters zenoh)
        toggle (fn [panel-name] (set-open (fn [current] (if (= current panel-name) nil panel-name))))
        agents (or (some-> manimani (.-agents)) #js [])
        rows (portRows ports #js {:zenoh zenoh :matter matter})
        summary (summarizeSystem system)
        mem (if system (memUsedPercent system) nil)]
    [dock "right"
     (when (= open "hosts")
       [panel "hosts" "Connected hosts" #(set-open nil)
        [:ul.dock-list
         [:li
          [state-dot "up"]
          [:span "This device"]
          [:span.muted {:data-dock-device did} (short-did did)]]
         (map (fn [agent]
                 [:li {:key (.-id agent)}
                  [state-dot "up"]
                  [:span (.-name agent)]
                  [:span.muted (if (= "auto" (.-approval agent)) "Runs on its own" "Asks first")]]) (or agents #js []))]
        (when (zero? (.-length agents)) [:p.muted "No agents connected yet."])
        [:p.muted "Zenoh routers seen: " (or routers (if zenoh "…" "0"))]])
     (when (= open "resources")
       [panel "resources" "Resources" #(set-open nil)
        (if summary
          [:dl.dock-facts
           [:dt "CPU"]
           [:dd {:data-dock-cpu (.-cpu_percent system)} (.-cpu summary)]
           [:dt "Memory"]
           [:dd {:data-dock-mem mem} (.-mem summary)]]
          [:p.muted "Usage is unavailable: the status service is not reachable."])
        [:div.meter {:aria-hidden "true"}
         [:span {:style {:width (str (or mem 0) "%")}}]]
        [:p.muted (if system
                    (str (formatKiB (.-mem_available_kb system)) " available")
                    "Resident services stay on loopback.")]])
     (when (= open "ports")
       [panel "ports" "Ports" #(set-open nil)
        [:ul.dock-list
         (map (fn [row]
                 [:li {:key (.-port row) :data-dock-port (.-port row) :data-port-state (.-state row)}
                  [state-dot (.-state row)]
                  [:span (.-port row)]
                  [:span (.-service row)]
                  [:span.muted (cond
                                 (= "internal" (.-state row)) "Internal"
                                 (= "up" (.-state row)) "Open on loopback"
                                 :else "Not reachable")]]) rows)]
        [:p.muted "The OS's own inventory. Nothing is scanned."]])
     [:div.dock-buttons {:data-dock-right true}
      [dock-button (= open "hosts") "Hosts" (str (inc (.-length agents))) #(toggle "hosts") "hosts"]
      [dock-button (= open "resources") "Resources" (when summary (.-cpu summary)) #(toggle "resources") "resources"]
      [dock-button (= open "ports") "Ports" nil #(toggle "ports") "ports"]]]))
