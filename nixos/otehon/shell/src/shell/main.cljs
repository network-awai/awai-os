(ns shell.main
  (:require [reagent.dom.client :as rdom]
            ["react" :as react :refer [useEffect useMemo useRef useState]]
            [shell.manimani :refer [MANIMANI manimani manimani-link]]
            [shell.net :refer [bluetooth-panel wifi-panel]]
            [shell.sound :refer [sound-panel]]
            [shell.display :refer [display-panel]]
            [shell.soshiki :refer [soshiki]]
            [shell.docks :refer [device-dock node-dock]]
            [shell.setup :refer [setup]]
            ["../identity/device.js" :refer [clearSession deviceDid loadProofs loadSession saveProof]]
            ["../runtime.js" :refer [createBroker osOperations readPassport readWalletBalance]]
            ["../media.js" :refer [MEDIA_ORIGIN describeMessage requestImage requestSpeech
                                   settleSavedItem useMediaCapabilities]]
            ["../theme.js" :refer [readTheme saveTheme THEMES]]
            ["../trust.js" :refer [POINTS accountAddress dappMinimum operationMinimum
                                   parsePassportResponse passportCall trustScore]]))

(def catalog
  (.parse js/JSON (.-textContent (.getElementById js/document "dapps-catalog"))))

(def relay-origin
  (some-> (.getElementById js/document "root") (.-dataset) (.-relayOrigin)))

(def poll-ms 3000)
(def sections #js ["Core" "Apps" "System"])
(def HOME "home")
(def ACCOUNT "account")
(def threads-key "otehon.threads.v1")
(def setup-key "otehon.setup.v1")

(defn- zenoh-up []
  (-> (js/fetch "http://127.0.0.1:8000/@/*/router")
      (.then (fn [response]
               (if (.-ok response)
                 (-> (.json response)
                     (.then (fn [body] (boolean (and (array? body) (pos? (.-length body)))))))
                 false)))))

(defn- matter-up []
  (js/Promise.
   (fn [resolve]
     (let [socket (js/WebSocket. "ws://127.0.0.1:5580/ws")
           finish (fn [up] (.close socket) (resolve up))]
       (set! (.-onmessage socket)
             (fn [event]
               (finish (string? (.-sdk_version (.parse js/JSON (.-data event)))))))
       (set! (.-onerror socket) (fn [] (finish false)))))))

(defn- use-service [check]
  (let [[up set-up] (useState false)]
    (useEffect
     (fn []
       (let [live (volatile! true)
             run (fn []
                   (-> (check)
                       (.catch (fn [_] false))
                       (.then (fn [next] (when @live (set-up next))))))]
         (run)
         (let [timer (js/setInterval run poll-ms)]
           (fn []
             (vreset! live false)
             (js/clearInterval timer)))))
     #js [check])
    up))

(defn- use-now []
  (let [[now set-now] (useState (fn [] (js/Date.)))]
    (useEffect
     (fn []
       (let [timer (js/setInterval #(set-now (js/Date.)) 1000)]
         (fn [] (js/clearInterval timer))))
     #js [])
    now))

(defn- load-threads []
  (try
    (let [saved (.parse js/JSON (.getItem js/localStorage threads-key))]
      (if (nil? saved)
        #js {}
        (let [out #js {}]
          (.forEach (js/Object.entries saved)
                    (fn [entry]
                      (aset out (aget entry 0) (.map (aget entry 1) settleSavedItem))))
          out)))
    (catch :default _ #js {})))

(defn- use-threads []
  (let [[threads set-threads] (useState load-threads)]
    (useEffect
     (fn []
       (try
         (.setItem js/localStorage threads-key (.stringify js/JSON threads))
         (catch :default _ nil)) js/undefined)
     #js [threads])
    (let [add (fn [context item]
                (set-threads
                 (fn [current]
                   (let [out (js/Object.assign #js {} current)]
                     (aset out context (.concat (or (aget current context) #js []) item))
                     out))))
          update (fn [context id changes]
                   (set-threads
                    (fn [current]
                      (let [out (js/Object.assign #js {} current)]
                        (aset out context
                              (.map (or (aget current context) #js [])
                                    (fn [item]
                                      (if (= (.-id item) id)
                                        (js/Object.assign #js {} item changes)
                                        item))))
                        out))))]
      [threads add update])))

(defn- setup-finished []
  (try
    (= (.getItem js/localStorage setup-key) "done")
    (catch :default _ false)))

(defn- short-did [did]
  (if (> (.-length did) 26)
    (str (subs did 0 14) "…" (subs did (- (.-length did) 8)))
    did))

(defn service [service-name up]
  [:li {:class (if up "service up" "service down")}
   [:span service-name]
   [:span (if up "Running" "Not reachable")]])

(defn sidebar [context on-select threads now zenoh matter account score]
  [:nav.sidebar {:aria-label "Contexts"}
   [:div.brand "Itonami"]
   [:f> manimani-link (= context MANIMANI) #(on-select MANIMANI)]
   [:div.contexts
    (map (fn [section]
            [:section {:key section}
             [:h2 section]
             [:ul
              (map (fn [dapp]
                      (let [n (some-> (aget threads (.-id dapp)) (.-length))]
                        [:li {:key (.-id dapp)}
                         [:button {:type "button"
                                    :class (if (= context (.-id dapp)) "dapp active" "dapp")
                                    :data-dapp (.-id dapp)
                                    :aria-current (when (= context (.-id dapp)) "page")
                                    :on-click #(on-select (.-id dapp))}
                          [:span.mark {:aria-hidden "true"} (aget (.-title dapp) 0)]
                          [:span.title (.-title dapp)]
                          (when (and n (pos? n)) [:span.count n])]])) (.filter (.-dapps catalog) (fn [dapp] (= (.-section dapp) section))))]]) sections)]
   [:button {:type "button"
              :class (if (= context ACCOUNT) "account-button active" "account-button")
              :data-account (.-accountDid account)
              :on-click #(on-select ACCOUNT)}
    [:span.title (short-did (.-accountDid account))]
    [:span.count {:data-score score} (str "Trust " score)]]
   [:footer
    [:ul.services
     [service "Zenoh" zenoh]
     [service "Matter" matter]]
    [:time (.toLocaleTimeString now #js [] #js {:hour "2-digit" :minute "2-digit"})]]])

(defn composer [context on-send on-image on-speech capabilities placeholder]
  (let [[text set-text] (useState "")
        input (useRef nil)]
    (useEffect
     (fn []
       (set-text "")
       (some-> input .-current (.focus)) js/undefined)
     #js [context])
    (let [submit (fn [action]
                   (let [trimmed (.trim text)]
                     (when-not (empty? trimmed)
                       (action trimmed)
                       (set-text ""))))
          send (fn [] (submit on-send))]
      [:form.composer {:on-submit (fn [event] (.preventDefault event) (send))}
       [:textarea {:ref input :rows 1 :value text :placeholder placeholder :aria-label placeholder
                    :on-change #(set-text (.. % -target -value))
                    :on-key-down (fn [event]
                                   (when (and (= (.-key event) "Enter")
                                              (not (.-shiftKey event))
                                              (not (.-isComposing (.-nativeEvent event))))
                                     (.preventDefault event)
                                     (send)))}]
       [:button.tool {:type "button" :data-generate "speech"
                       :disabled (or (empty? (.trim text))
                                     (zero? (.-length (.-speech capabilities))))
                       :on-click #(submit on-speech)}
        "Speak"]
       [:button.tool {:type "button" :data-generate "image"
                       :title (when-not (.-image capabilities)
                                "The image model is not available on this device")
                       :disabled (or (empty? (.trim text)) (not (.-image capabilities)))
                       :on-click #(submit on-image)}
        "Image"]
       [:button {:type "submit" :disabled (empty? (.trim text))} "Send"]])))

(defn message [item]
  (let [msg (describeMessage item)]
    (if (= "text" (.-kind msg))
      [:li (.-text msg)]
      [:li.media {:data-media (.-kind msg) :data-state (.-state msg)}
       [:span.prompt (.-text msg)]
       (when (and (= "done" (.-state msg)) (= "speech" (.-kind msg)))
         [:audio {:controls true :preload "metadata" :src (str MEDIA_ORIGIN (.-url msg))}])
       (when (and (= "done" (.-state msg)) (= "image" (.-kind msg)))
         [:img {:alt (.-text msg) :src (str MEDIA_ORIGIN (.-url msg))}])
       (when (= "working" (.-state msg))
         [:span.muted (if (= "image" (.-kind msg))
                        "Generating on this device. This can take a long time."
                        "Generating…")])
       (when (= "failed" (.-state msg))
         [:span.problem (str "Could not generate this: " (.-reason msg))])
       (when (and (= "done" (.-state msg)) (some? (.-seconds msg)))
         [:span.muted (str "Generated on this device in " (.-seconds msg) " s")])])))

(defn chat [dapp context messages on-send on-image on-speech capabilities]
  (let [end (useRef nil)]
    (useEffect
     (fn []
       (some-> end .-current (.scrollIntoView)) js/undefined)
     #js [(.-length messages) context])
    [:main.chat
     [:div.thread
      (if (zero? (.-length messages))
        [:div.empty
         [:h1 (if dapp (.-title dapp) "What should we work on?")]
         (if dapp [:p (.-summary dapp)] [:p "Pick an app in the sidebar to work in its context."])]
        [:ol.messages
         (map-indexed (fn [index item]
                 ^{:key (or (some-> item (.-id)) index)} [message item]) messages)])
      [:div {:ref end}]]
     [:div.dock
      [:f> composer
       context on-send on-image on-speech capabilities
       (if dapp (str "Message " (.-title dapp)) "Message Itonami")]
      [:p.notice "No agent is connected in this image, so nothing answers yet. Messages stay on this device."]]]))

(defn locked [dapp minimum score on-raise]
  [:main.chat
   [:div.empty {:data-dapp-locked (.-id dapp)}
    [:h1 (.-title dapp)]
    [:p (str "This app needs a trust score of " minimum ". Yours is " score ".")]
    [:button.primary {:type "button" :on-click on-raise} "Raise Your Score"]]])

(defn dapp-panel [dapp score on-raise]
  [:aside.panel {:aria-label (str (.-title dapp) " dapp")}
   [:div.panel-head
    [:h2 (.-title dapp)]
    [:span.tag "Not connected"]]
   [:p (.-summary dapp)]
   [:dl
    [:dt "Install"]
    [:dd (if (= "os-image" (.-install dapp)) "Included in the OS image" (.-install dapp))]
    [:dt "Offline"]
    [:dd (if (= "local-core" (.-offline dapp)) "The local core works offline" (.-offline dapp))]]
   [:h3 "Network operations"]
   (if (zero? (.-length (.-remoteOperations dapp)))
     [:p "None. This app does not use the network."]
     [:ul.operations
      (map (fn [operation]
              (let [minimum (operationMinimum (.-id dapp) (.-operation operation))
                    locked (< score minimum)]
                [:li {:key (.-operation operation)
                       :data-operation (.-operation operation)
                       :data-locked locked}
                 [:span.title (.-operation operation)]
                 [:span (.-service operation)]
                 [:span (if (= "each-operation" (.-consent operation))
                          "Asks each time" (.-consent operation))]
                 (when locked
                   [:button.locked {:type "button" :on-click on-raise}
                    (str "Needs trust " minimum ". Yours is " score ".")])])) (.-remoteOperations dapp))])])

(defn account [account score proofs on-check-passport passport-state on-read-balance balance-state on-sign-out]
  (let [address (accountAddress (.-accountDid account))]
    [:main.chat.account-view
     [:div.account-body
      [:h1 "Account"]
      [:p.account-id (.-accountDid account)]
      [:p.muted (str "Signed in with "
                     (if (= "wallet" (.-method account)) "a Web3 wallet" "a passkey")
                     " until "
                     (.toLocaleDateString (js/Date. (.-expiresAt account))) ".")]
      [:h2 "Wallet"]
      (if address
        [:<>
         [:p.muted "Optimism の ETH 残高。確認時に接続先と共有する情報を表示します。"]
         [:button.secondary {:type "button" :on-click on-read-balance
                              :disabled (some-> balance-state (.-loading))}
          (if (some-> balance-state (.-loading)) "確認中…" "ETH 残高を確認")]
         (when (some-> balance-state (.-text))
           [:p {:role "status"
                 :class (if (.-problem balance-state) "problem" "muted")}
            (.-text balance-state)])]
        [:p.muted "残高の確認には Wallet でのサインインが必要です。"])
      [:h2 "Trust score " [:span {:data-score score} score]]
      [:p.muted "A condition for some apps and operations. It does not mean goodwill, truth or a verified identity."]
      [:ul.sources
       [:li
        [:span "Signed in"]
        [:span (str "+" (.-login POINTS))]]
       [:li
        [:span "Human Passport"
         (if (= (some-> proofs (.-passport) (.-account)) (.-accountDid account))
           (str " (score " (.-score (.-passport proofs)) ")")
           "")]
        (if address
          [:button {:type "button" :on-click on-check-passport}
           (str "Check for +" (.-passport POINTS))]
          [:span.muted "Needs a wallet account"])]
       [:li
        [:span "World ID"]
        [:span.muted (str "Not available yet (+" (.-worldId POINTS) ")")]]]
      (when passport-state
        [:p {:class (if (.-problem passport-state) "problem" "muted")}
         (.-text passport-state)])
      [:button.secondary {:type "button" :data-sign-out true :on-click on-sign-out}
       "Sign Out of This Device"]]]))

(defn shell [did account proofs score broker zenoh matter on-proof on-sign-out]
  (let [now (use-now)
        [context set-context] (useState MANIMANI)
        [threads add-message update-message] (use-threads)
        capabilities (useMediaCapabilities)
        [passport-state set-passport-state] (useState nil)
        [balance-state set-balance-state] (useState nil)
        dapp (.find (.-dapps catalog) (fn [item] (= (.-id item) context)))
        minimum (if dapp (dappMinimum (.-id dapp)) 0)
        open-account (fn [] (set-context ACCOUNT))
        check-passport (fn []
                         (set-passport-state nil)
                         (let [address (accountAddress (.-accountDid account))]
                           (-> (readPassport broker (passportCall address))
                               (.then (fn [body]
                                        (let [passport-score (parsePassportResponse body)]
                                          (on-proof "passport" #js {:account (.-accountDid account)
                                                                     :score passport-score
                                                                     :checkedAt (.now js/Date)})
                                          (set-passport-state #js {:text (str "Human Passport score on Optimism: "
                                                                              passport-score ".")})))) 
                               (.catch (fn [error]
                                         (set-passport-state
                                          #js {:problem true
                                               :text (if (re-find #"not approved" (or (.-message error) ""))
                                                       "Nothing was sent."
                                                       "The chain could not be read. Try again later.")}))))))
        check-balance (fn []
                        (set-balance-state #js {:loading true})
                        (-> (readWalletBalance broker (accountAddress (.-accountDid account)))
                            (.then (fn [balance]
                                     (set-balance-state #js {:amount balance
                                                             :text (str "Optimism: " balance " ETH")})))
                            (.catch (fn [error]
                                      (set-balance-state
                                       #js {:problem true
                                            :text (if (re-find #"not approved" (or (.-message error) ""))
                                                    "承認されなかったため、リクエストは送信されませんでした。"
                                                    "残高を確認できませんでした。後でもう一度お試しください。")})))))]
    (let [body (cond
                 (= context ACCOUNT)
                 [:f> account account score proofs check-passport passport-state
                  check-balance balance-state on-sign-out]
                 (= context MANIMANI)
                 [:f> manimani set-context open-account broker]
                 (= context "wifi") [:f> wifi-panel]
                 (= context "bluetooth") [:f> bluetooth-panel]
                 (= context "sound") [:f> sound-panel]
                 (= context "display") [:f> display-panel]
                 (= context "soshiki") [:f> soshiki account score open-account broker]
                 (and dapp (< score minimum))
                 [locked dapp minimum score open-account]
                 :else
                 [:f> chat dapp context (or (aget threads context) #js [])
                  (fn [text] (add-message context text))
                  (fn [text] (requestImage text context add-message update-message))
                  (fn [text] (requestSpeech text context add-message update-message))
                  capabilities])

          panel (when (and dapp
                           (not (contains? #{"wifi" "bluetooth" "sound" "display"} context)))
                  dapp)]
      [:div {:class (if panel "shell with-panel" "shell")}
       [:f> sidebar context set-context threads now zenoh matter account score]
       body
       (when panel [:f> dapp-panel panel score open-account])
       [:f> device-dock account score
        (or (some-> balance-state (.-amount)) nil)
        proofs capabilities zenoh matter open-account]
       [:f> node-dock did zenoh matter]])))

(defn app []
  (let [zenoh (use-service zenoh-up)
        matter (use-service matter-up)
        broker (useMemo (fn [] (createBroker "index.html" (osOperations relay-origin))) #js [])
        [did set-did] (useState nil)
        [account set-account] (useState nil)
        [finished set-finished] (useState setup-finished)
        [proofs set-proofs] (useState loadProofs)
        score (trustScore #js {:accountDid (some-> account (.-accountDid)) :proofs proofs})
        open (boolean (and did account finished))]
    (useEffect
     (fn []
       (-> (deviceDid)
           (.then (fn [value]
                    (set-account (loadSession value))
                    (set-did value)))) js/undefined)
     #js [])
    (useEffect
     (fn []
       (let [dapps (.-length (.querySelectorAll js/document ".dapp"))]
         (set! (.-title js/document)
               (str "Awai Otehon zenoh=" (if zenoh 1 0)
                    " matter=" (if matter 1 0)
                    " gate=" (if open 0 1)
                    " dapps=" dapps))) js/undefined)
     #js [zenoh matter open did])
    (if-not did
      nil
      (if-not open
        [:f> setup broker relay-origin did account finished set-account score
         (fn []
           (try
             (.setItem js/localStorage setup-key "done")
             (catch :default _ nil))
           (set-finished true))]
        [:f> shell did account proofs score broker zenoh matter
         (fn [proof-name proof]
           (saveProof proof-name proof)
           (set-proofs (loadProofs)))
         (fn []
           (clearSession)
           (set-proofs #js {})
           (set-account nil))]))))

(defn theme-app []
  (let [[theme set-theme] (useState readTheme)]
    (useEffect
     (fn []
       (set! (.. js/document -documentElement -dataset -theme) theme)
       (saveTheme js/undefined theme) js/undefined)
     #js [theme])
    [:<>
     [:f> app]
     [:fieldset.theme-switcher {:aria-label "テーマ"}
      [:legend "テーマ"]
      (map (fn [theme-name]
             [:button {:key theme-name :type "button"
                        :aria-pressed (= theme theme-name)
                        :on-click #(set-theme theme-name)}
              theme-name])
           THEMES)]]))

(defn init []
  (let [root (rdom/create-root (.getElementById js/document "root"))]
    (rdom/render root [:f> theme-app])))
