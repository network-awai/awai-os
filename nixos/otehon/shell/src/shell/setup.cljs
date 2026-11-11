(ns shell.setup
  (:require ["react" :refer [useEffect useMemo useRef useState]]
            ["qrcode-generator" :default qrcode]
            ["../identity/link.js" :refer [REQUEST_MS SESSION_MS checksumAddress confirmationCode
                                           createLinkRequest linkUrl openResponse siweMessage verifyLink]]
            ["../identity/wallet.js" :refer [signWithProvider]]
            ["../identity/device.js" :refer [saveSession]]
            ["../runtime.js" :refer [awaitPhoneApproval]]
            ["../trust.js" :refer [POINTS]]))

(def text
  {"en" {:hello "Hello"
         :getStarted "Get Started"
         :next "Continue"
         :back "Back"
         :languageTitle "Choose your language"
         :networkTitle "Network"
         :networkOnline "This device reports a network connection."
         :networkOffline "This device reports no network connection."
         :networkNote "A wallet sign-in on this device needs no network. Phone sign-in does. Network settings are not available here yet."
         :signInTitle "Sign In"
         :signInBody "Use a Web3 wallet on this device, or approve with a passkey or wallet on your phone. There is no password or guest option."
         :signInAgain "Sign in to open this device."
         :localStart "Sign In with a Wallet"
         :linkStart "Link with Phone"
         :useWallet "Use the Wallet in This Browser"
         :addressLabel "Your wallet address"
         :signThis "Sign this message with your wallet (personal_sign):"
         :signatureLabel "Signature"
         :verify "Verify and Sign In"
         :chooseOther "Choose Another Way"
         :scan "Scan this code with your phone."
         :checkCode "Check that your phone shows this code:"
         :waiting "Waiting for your phone…"
         :denied "Nothing was sent. Choose Link with Phone to try again."
         :failed "The relay could not be reached. Check the network and try again."
         :expired "This code expired. Choose Link with Phone to try again."
         :refused "An answer was refused"
         :trustTitle "Trust Score"
         :trustBody "Some apps and operations ask for a minimum score. The score is not a verdict on you, and you can raise it later in Account."
         :yourScore "Your score"
         :later "Set Up Later"
         :doneTitle "You're all set"
         :doneBody "Your apps are in the sidebar. Each one has its own conversation."
         :enter "Open Itonami"}
   "ja" {:hello "こんにちは"
         :getStarted "はじめる"
         :next "続ける"
         :back "戻る"
         :languageTitle "言語を選択"
         :networkTitle "ネットワーク"
         :networkOnline "この端末はネットワークに接続されています。"
         :networkOffline "この端末はネットワークに接続されていません。"
         :networkNote "この端末のウォレットでのサインインにネットワークは不要です。スマートフォンでのサインインには必要です。ここではまだネットワークを設定できません。"
         :signInTitle "サインイン"
         :signInBody "この端末で Web3 ウォレットを使うか、スマートフォンでパスキーかウォレットを使って承認します。パスワードとゲストの利用はできません。"
         :signInAgain "この端末を開くには、サインインしてください。"
         :localStart "ウォレットでサインイン"
         :linkStart "スマートフォンとリンク"
         :useWallet "このブラウザーのウォレットを使う"
         :addressLabel "ウォレットのアドレス"
         :signThis "このメッセージをウォレットで署名してください（personal_sign）:"
         :signatureLabel "署名"
         :verify "確認してサインイン"
         :chooseOther "別の方法を選ぶ"
         :scan "このコードをスマートフォンで読み取ってください。"
         :checkCode "スマートフォンに同じコードが出ていることを確認してください:"
         :waiting "スマートフォンの承認を待っています…"
         :denied "何も送信していません。もう一度試すには「スマートフォンとリンク」を選んでください。"
         :failed "中継に接続できません。ネットワークを確認して、もう一度お試しください。"
         :expired "コードの期限が切れました。もう一度「スマートフォンとリンク」を選んでください。"
         :refused "受け取った応答を拒否しました"
         :trustTitle "Trust Score"
         :trustBody "App や操作によっては、最低点が必要です。この点数はあなたへの評価ではありません。あとで「アカウント」から上げられます。"
         :yourScore "現在の点数"
         :later "あとで設定"
         :doneTitle "準備ができました"
         :doneBody "App はサイドバーにあります。App ごとに専用の会話があります。"
         :enter "Itonami を開く"}})

(def languages #js [#js ["en" "English"] #js ["ja" "日本語"]])
(def steps #js ["hello" "language" "network" "signin" "trust" "done"])
(def language-key "otehon.language.v1")

(defn- saved-language []
  (try
    (let [saved (.getItem js/localStorage language-key)]
      (if (or (= saved "ja") (= saved "en")) saved "en"))
    (catch :default _ "en")))

(defn qr-code [url]
  (let [{:keys [size path]} (useMemo
                             (fn []
                               (let [code (qrcode 0 "M")
                                     count (do (.addData code url)
                                               (.make code)
                                               (.getModuleCount code))]
                                 {:size (+ count 8)
                                  :path (loop [row 0 d ""]
                                          (if (>= row count)
                                            d
                                            (recur (inc row)
                                                   (loop [column 0 d d]
                                                     (if (>= column count)
                                                       d
                                                       (recur (inc column)
                                                              (if (.isDark code row column)
                                                                (str d "M" (+ column 4) " " (+ row 4) "h1v1h-1z")
                                                                d)))))))}))
                             #js [url])]
    [:svg.qr {:viewBox (str "0 0 " size " " size) :role "img" :aria-label url :data-link-url url}
     [:rect {:width size :height size :fill "#fff"}]
     [:path {:d path :fill "#000"}]]))

(defn local-wallet [t did on-linked on-back]
  (let [[request set-request] (useState nil)
        [address set-address] (useState "")
        [signature set-signature] (useState "")
        [refusal set-refusal] (useState nil)]
    (useEffect
     (fn []
       (-> (createLinkRequest did)
           (.then (fn [created] (set-request (.-request created))))) js/undefined)
     #js [did])
    (let [valid (boolean (re-find #"^0x[0-9a-fA-F]{40}$" (.trim address)))
          draft (useMemo
                 (fn []
                   (when (and request valid)
                     (let [now (.now js/Date)]
                       #js {:method "wallet"
                            :address (checksumAddress (.trim address))
                            :chainId 1
                            :issuedAt (.toISOString (js/Date. now))
                            :expiresAt (.toISOString (js/Date. (+ now SESSION_MS)))})))
                 #js [request valid address])
          finish (fn [response]
                   (try
                     (let [account (verifyLink #js {:request request :response response :deviceDid did})]
                       (saveSession request response)
                       (on-linked account))
                     (catch :default error
                       (set-refusal (.-message error)))))]
      [:<>
       [:h1 (:localStart t)]
       (when (.-ethereum js/window)
         [:button.primary {:type "button" :id "local-provider" :disabled (not request)
                            :on-click (fn []
                                        (set-refusal nil)
                                        (-> (signWithProvider (.-ethereum js/window) request)
                                            (.then (fn [response] (finish response)))
                                            (.catch (fn [error] (set-refusal (.-message error))))))}
          (:useWallet t)])
       [:label.field
        [:span (:addressLabel t)]
        [:input {:id "local-address" :value address :spell-check false :auto-complete "off"
                  :placeholder "0x…" :on-change #(set-address (.. % -target -value))}]]
       (when draft
         [:<>
          [:label.field
           [:span (:signThis t)]
           [:textarea {:id "local-message" :read-only true :rows 9
                        :value (siweMessage #js {:address (.-address draft)
                                                 :chainId (.-chainId draft)
                                                 :device (.-device request)
                                                 :nonce (.-nonce request)
                                                 :issuedAt (.-issuedAt draft)
                                                 :expiresAt (.-expiresAt draft)})}]]
          [:label.field
           [:span (:signatureLabel t)]
           [:input {:id "local-signature" :value signature :spell-check false :auto-complete "off"
                     :placeholder "0x…" :on-change #(set-signature (.. % -target -value))}]]
          [:button.primary {:type "button" :id "local-verify" :disabled (empty? (.trim signature))
                             :on-click (fn []
                                         (set-refusal nil)
                                         (finish (js/Object.assign #js {} draft
                                                                   #js {:signature (.trim signature)})))}
           (:verify t)]])
       (when refusal
         [:p.problem {:data-link-error refusal} (str (:refused t) ": " refusal)])
       [:button.secondary {:type "button" :on-click on-back} (:chooseOther t)]])))

(defn sign-in [t returning broker relay-origin did on-linked]
  (let [[local set-local] (useState false)
        [state set-state] (useState "idle")
        [pending set-pending] (useState nil)
        [refusal set-refusal] (useState nil)
        abort (useRef nil)]
    (useEffect
     (fn [] (fn [] (some-> abort .-current .abort)))
     #js [])
    (letfn [(pump [iter request private-key]
              (-> (.next iter)
                  (.then (fn [res]
                           (if (.-done res)
                             (set-state "failed")
                             (-> (openResponse request private-key (.-value res))
                                 (.then (fn [response]
                                          (let [account (verifyLink #js {:request request
                                                                          :response response
                                                                          :deviceDid did})]
                                            (saveSession request response)
                                            (on-linked account))))
                                 (.catch (fn [error]
                                           ;; Anyone with the topic can post. Keep waiting.
                                           (set-refusal (.-message error))
                                           (pump iter request private-key)))))))))]
      (let [start (fn []
                    (set-refusal nil)
                    (set-pending nil)
                    (set-state "asking")
                    (let [controller (js/AbortController.)]
                      (set! (.-current abort) controller)
                      (let [timer (js/setTimeout #(.abort controller) REQUEST_MS)]
                        (-> (createLinkRequest did)
                            (.then (fn [created]
                                     (let [request (.-request created)
                                           private-key (.-privateKey created)]
                                       (-> (awaitPhoneApproval broker relay-origin
                                                               (.-topic request) (.-signal controller))
                                           (.then (fn [stream]
                                                    (set-pending #js {:url (linkUrl request)
                                                                      :code (confirmationCode request)})
                                                    (set-state "waiting")
                                                    (pump (.messages stream) request private-key)))))))
                            (.catch (fn [error]
                                      (cond
                                        (.-aborted (.-signal controller)) (set-state "expired")
                                        (re-find #"not approved" (or (.-message error) "")) (set-state "denied")
                                        :else (set-state "failed"))
                                      (set-pending nil)))
                            (.finally (fn [] (js/clearTimeout timer)))))))]
        (if local
          [:f> local-wallet t did on-linked #(set-local false)]
          [:<>
           [:h1 (:signInTitle t)]
           [:p (if returning (:signInAgain t) (:signInBody t))]
           (when pending
             [:div.link-pending
              [:f> qr-code (.-url pending)]
              [:p (:scan t)]
              [:p (:checkCode t) " " [:strong.code (.-code pending)]]
              [:p.muted (:waiting t)]])
           (when (= state "denied") [:p {:data-link-state "denied"} (:denied t)])
           (when (= state "failed") [:p.problem {:data-link-state "failed"} (:failed t)])
           (when (= state "expired") [:p.problem {:data-link-state "expired"} (:expired t)])
           (when refusal
             [:p.problem {:data-link-error refusal} (str (:refused t) ": " refusal)])
           (when-not (or pending (= state "asking"))
             [:<>
              [:button.primary {:type "button" :id "local-start" :on-click #(set-local true)}
               (:localStart t)]
              [:button.secondary {:type "button" :id "link-start" :on-click start}
               (:linkStart t)]])])))))

(defn setup [broker relay-origin did account returning on-linked score on-finish]
  (let [[language set-language] (useState saved-language)
        [step set-step] (useState (if returning "signin" (if account "trust" "hello")))
        t (get text language)
        index (.indexOf steps step)
        next-step (fn [] (set-step (aget steps (inc index))))]
    (useEffect
     (fn []
       (set! (.-lang js/document.documentElement) language)
       (try
         (.setItem js/localStorage language-key language)
         (catch :default _ nil)) js/undefined)
     #js [language])
    [:div.setup {:data-step step}
     [:div.setup-card
      (when (= step "hello")
        [:<>
         [:h1.hello (:hello t)]
         [:button.primary {:type "button" :data-next true :on-click next-step} (:getStarted t)]])
      (when (= step "language")
        [:<>
         [:h1 (:languageTitle t)]
         [:ul.choices
          (map (fn [[code label]]
                 [:li {:key code}
                  [:button {:type "button" :data-language code :aria-pressed (= language code)
                             :on-click #(set-language code)}
                   [:span label]
                   (when (= language code) [:span {:aria-hidden "true"} "✓"])]])
               languages)]
         [:button.primary {:type "button" :data-next true :on-click next-step} (:next t)]])
      (when (= step "network")
        [:<>
         [:h1 (:networkTitle t)]
         [:p (if (.-onLine js/navigator) (:networkOnline t) (:networkOffline t))]
         [:p.muted (:networkNote t)]
         [:button.primary {:type "button" :data-next true :on-click next-step} (:next t)]])
      (when (= step "signin")
        [:f> sign-in t returning broker relay-origin did
         (fn [linked]
           (on-linked linked)
           (if returning (on-finish) (next-step)))])
      (when (= step "trust")
        [:<>
         [:h1 (:trustTitle t)]
         [:p (:trustBody t)]
         [:p (:yourScore t) ": " [:strong {:data-score score} score]
          " / " (+ (.-login POINTS) (.-passport POINTS) (.-worldId POINTS))]
         [:button.primary {:type "button" :data-next true :on-click next-step} (:later t)]])
      (when (= step "done")
        [:<>
         [:h1 (:doneTitle t)]
         [:p (:doneBody t)]
         [:p.muted.account-id (some-> account (.-accountDid))]
         [:button.primary {:type "button" :data-finish true :on-click on-finish} (:enter t)]])
      (when (and (pos? index) (< index 3))
        [:button.secondary {:type "button"
                             :on-click #(set-step (aget steps (dec index)))}
         (:back t)])]
     (when-not returning
       [:ol.progress {:aria-label (str (inc index) " / " (.-length steps))}
        (map (fn [step-name]
               [:li {:key step-name :class (when (= step-name step) "current")}])
             steps)])]))
