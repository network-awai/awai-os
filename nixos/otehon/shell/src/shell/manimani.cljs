(ns shell.manimani
  (:require ["react" :refer [useCallback useEffect useRef useState]]
            ["../muse-chat.js" :refer [requestMuseChat conversationFor]]
            ["../voice-input.js" :refer [createLocalDictation]]))

(def MANIMANI "manimani")
(def MANIMANI-ORIGIN "http://127.0.0.1:8771")
(def poll-ms 2000)

(defn- post [path & [body]]
  (js/fetch (str MANIMANI-ORIGIN path)
            #js {:method "POST"
                 :headers #js {"content-type" "application/json"}
                 :body (.stringify js/JSON (clj->js (or body {})))}))

(defn use-manimani []
  (let [[state set-state] (useState nil)
        read (useCallback
              (fn []
                (-> (js/fetch (str MANIMANI-ORIGIN "/v1/state"))
                    (.then (fn [response] (.json response)))
                    (.then (fn [body] (set-state body)))
                    (.catch (fn [_] (set-state nil)))))
              #js [])]
    (useEffect
     (fn []
       (read)
       (let [timer (js/setInterval read poll-ms)]
         (fn [] (js/clearInterval timer))))
     #js [read])
    [state read]))

(defn- status-of [state]
  (if-not state "stopped" (if (.-paused state) "paused" (.-status state))))

(def status-text
  {"stopped" "The Manimani service is not running."
   "paused" "Paused. Scheduled work and tools are stopped."
   "ready" "Running on this device."
   "model-unavailable" "The local model is not available. Nothing is sent elsewhere."})

(defn manimani-link [active on-select]
  [:button {:type "button" :class (if active "new-chat manimani-link active" "new-chat manimani-link")
            :aria-current (when active "page") :data-manimani-link true :on-click on-select}
   "Bots · Muse / Manimani"])

(def launchers [["wifi" "Wi-Fi"] ["bluetooth" "Bluetooth"] ["sound" "Sound"] ["display" "Display"]])

(defn local-manimani [on-select on-open-wallet]
  (let [[state read] (use-manimani)
        [text set-text] (useState "")
        [voice-state set-voice-state] (useState "idle")
        [voice-level set-voice-level] (useState 0)
        voice (useRef nil)
        bottom (useRef nil)
        count (or (some-> state (.-messages) (.-length)) 0)]
    (useEffect
     (fn []
       (some-> bottom .-current (.scrollIntoView)) js/undefined)
     #js [count])
    (useEffect
     (fn []
       (set! (.-current voice)
             (createLocalDictation #js {:Recognition (or (.-SpeechRecognition js/window)
                                                        (.-webkitSpeechRecognition js/window))
                                        :mediaDevices (.-mediaDevices js/navigator)
                                        :AudioContext (.-AudioContext js/window)
                                        :onText (fn [next]
                                                  (set-text (fn [previous]
                                                              (str previous
                                                                   (if (empty? previous) "" " ")
                                                                   next))))
                                        :onState set-voice-state
                                        :onLevel set-voice-level}))
       (fn [] (some-> voice .-current (.stop))) js/undefined)
     #js [])
    (let [act (fn [promise]
                (-> promise
                    (.then (fn [_] (read)))
                    (.catch (fn [_] (read)))))
          send (fn [event]
                 (.preventDefault event)
                 (some-> voice .-current (.stop))
                 (let [value (.trim text)]
                   (when-not (empty? value)
                     (set-text "")
                     (act (post "/v1/messages" {:text value})))))]
      [:div.manimani {:data-manimani true}
       (when (= voice-state "listening")
         [:div.voice-bezel {:aria-hidden "true" :style {:opacity (+ 0.2 (* voice-level 0.7))}}])
       [:main.manimani-chat
        [:div.manimani-messages {:aria-live "polite"}
         (when (zero? count) [:p "Manimani keeps running on this device, and coordinates your other agents."])
         (map (fn [message]
                 [:div.manimani-message {:key (str (.-at message) "-" (.-role message))
                                         :data-role (.-role message)}
                  (.-text message)]) (or (some-> state (.-messages)) #js []))
         [:div {:ref bottom}]]
        [:form.manimani-composer {:on-submit send}
         [:input {:aria-label "Message Manimani" :placeholder "Message Manimani"
                   :value text :disabled (not state)
                   :on-change #(set-text (.. % -target -value))}]
         [:button {:type "button"
                    :aria-pressed (= voice-state "listening")
                    :disabled (or (not state) (= voice-state "checking"))
                    :on-click #(if (= voice-state "listening")
                                 (some-> voice .-current (.stop))
                                 (some-> voice .-current (.start)))}
          (if (= voice-state "listening") "音声を停止" "音声入力")]
         [:button {:type "submit" :disabled (or (not state) (empty? (.trim text)))}
          "Send"]]
        [:p.voice-status {:role "status"}
         (when (= voice-state "listening") "聞いています。内容は送信前に確認できます。")
         (when (= voice-state "checking") "端末内の音声認識を確認しています。")
         (when (= voice-state "unavailable") "端末内の日本語音声認識を利用できません。文字入力をご利用ください。")
         (when (= voice-state "error") "音声入力を開始できませんでした。マイクの設定を確認してください。")]]
       [:aside.manimani-side {:aria-label "What Manimani is doing"}
        [:section
         [:h2 "Dapp と Wallet"]
         [:p "会話しながら、この端末の機能を開けます。"]
         [:div.manimani-actions.manimani-launchers
          [:button {:type "button" :on-click on-open-wallet} "Wallet / アカウント"]
          (map (fn [[id label]]
                 [:button {:key id :type "button" :on-click #(on-select id)} label])
               launchers)]]
        [:section
         [:h2 "Status"]
         [:p {:data-manimani-status (status-of state)} (get status-text (status-of state))]
         (when state
           [:div.manimani-actions
            [:button {:type "button" :on-click #(act (post "/v1/pause" {:paused (not (.-paused state))}))}
             (if (.-paused state) "Resume" "Pause")]])]
        (when (pos? (.-length (or (some-> state (.-approvals)) #js [])))
          [:section
           [:h2 "Needs your approval"]
           [:ul
            (map (fn [item]
                    [:li {:key (.-id item)}
                     [:strong (.-name item)] ": " (.-prompt item)
                     [:div.manimani-actions
                      [:button {:type "button"
                                 :on-click #(act (post (str "/v1/approvals/" (.-id item)) {:approve true}))}
                       "Approve"]
                      [:button {:type "button"
                                 :on-click #(act (post (str "/v1/approvals/" (.-id item)) {:approve false}))}
                       "Decline"]]]) (or (.-approvals state) #js []))]])
        [:section
         [:h2 "Agents"]
         (if (pos? (.-length (or (some-> state (.-agents)) #js [])))
           [:ul
            (map (fn [agent]
                    [:li {:key (.-id agent)}
                     (str (.-name agent) ": "
                          (if (= "auto" (.-approval agent)) "runs on its own" "asks you first"))]) (or (.-agents state) #js []))]
           [:p "None connected yet."])]
        [:section
         [:h2 "Scheduled"]
         (if (pos? (.-length (or (some-> state (.-tasks)) #js [])))
           [:ul
            (map (fn [task]
                    [:li {:key (.-id task)}
                     (str (.-title task) ", every " (aget task "every-minutes") " min ")
                     [:button {:type "button"
                                :on-click #(act (post (str "/v1/tasks/" (.-id task) "/delete")))}
                      "Remove"]]) (or (.-tasks state) #js []))]
           [:p "Nothing scheduled."])]
        [:section
         [:h2 "Remembered"]
         (if (pos? (.-length (or (some-> state (.-memory)) #js [])))
           [:<>
            [:ul
             (map (fn [fact] [:li {:key fact} fact]) (or (.-memory state) #js []))]
            [:div.manimani-actions
             [:button {:type "button" :on-click #(act (post "/v1/memory/clear"))} "Forget all"]]]
           [:p "Nothing yet."])]
        [:section
         [:h2 "Activity"]
         [:ul
          (map (fn [item]
                  [:li {:key (str (.-at item) "-" (.-kind item))}
                   (str (.toLocaleTimeString (js/Date. (.-at item))) " " (.-kind item)
                        (if (.-detail item) (str ": " (.-detail item)) ""))]) (reverse (take-last 12 (or (some-> state (.-activity)) #js []))))]]]])))


(def muse-chat-key "otehon.muse.chat.v1")
(defn muse-chat [broker]
  (let [[messages set-messages] (useState (fn [] (try (let [value (.parse js/JSON (.getItem js/localStorage muse-chat-key))]
                                                       (if (array? value) value #js [])) (catch :default _ #js []))))
        [text set-text] (useState "")
        [pending set-pending] (useState false)
        [error set-error] (useState nil)
        [model set-model] (useState "")
        active (useRef nil)]
    (useEffect (fn [] (fn [] (some-> active .-current (.abort)))) #js [])
    (let [send (fn [event]
                 (.preventDefault event)
                 (when (and (not pending) (not (empty? (.trim text))))
                   (let [controller (js/AbortController.)
                         conversation (conversationFor messages text)]
                     (set! (.-current active) controller)
                     (set-pending true) (set-error nil)
                     (-> (requestMuseChat broker conversation (.-signal controller))
                         (.then (fn [reply]
                           (let [next (.concat messages #js [#js {:role "user" :content (.trim text)} #js {:role "assistant" :content (.-text reply)}])]
                             (set-messages next) (set-text "") (set-model (.-model reply))
                             (try (.setItem js/localStorage muse-chat-key (.stringify js/JSON next))
                                  (catch :default _ (set-error "会話を端末に保存できませんでした。"))))))
                         (.catch (fn [_] (set-error "送信を許可していないか、Muse が応答できませんでした。入力は保持しています。")))
                         (.finally (fn [] (set-pending false)))))))]
      [:main.muse-chat {:data-muse-chat true}
       [:header
        [:h1 "Muse と会話"]
        [:p.muted (if (empty? model) "Muse · 接続確認前" (str "Muse · " model " · 応答確認済み"))]
        [:p.muted "Muse の既存ログインを使用します。送信時に入力とこの会話の履歴（長い場合は直近の範囲）を Muse へ渡します。ファイルの変更・コマンド実行は無効です。"]
        [:button.soshiki-quiet {:type "button" :disabled pending :on-click (fn [] (set-messages #js []) (set-error nil) (.removeItem js/localStorage muse-chat-key))} "新しい会話"]]
       [:ol.muse-messages {:aria-label "Museとの会話" :aria-live "polite"}
        (when (zero? (.-length messages)) [:li.muted "話しかけてください。"])
        (map-indexed (fn [i message]
                       [:li {:key i :data-speaker (.-role message)}
                        [:strong (if (= "user" (.-role message)) "あなた" "Muse")]
                        [:p (.-content message)]]) messages)]
       (when error [:p.net-error {:role "alert"} error])
       [:form.muse-composer {:on-submit send}
        [:textarea {:aria-label "Museへのメッセージ" :placeholder "Muse にメッセージを送る" :value text
                    :max-length 8000 :disabled pending :on-change #(set-text (.. % -target -value))}]
        [:button {:type "submit" :disabled (or pending (empty? (.trim text)))} (if pending "Muse の応答を待っています…" "Muse に送信")]]])))

(defn manimani [on-select on-open-wallet broker]
  (let [[provider set-provider] (useState "muse")]
    [:section.bot-conversations
     [:nav.soshiki-legend {:aria-label "会話するBot"}
      [:button.soshiki-legend-btn {:type "button" :aria-pressed (= provider "muse") :on-click #(set-provider "muse")} "Muse"]
      [:button.soshiki-legend-btn {:type "button" :aria-pressed (= provider "local") :on-click #(set-provider "local")} "Manimani（ローカル）"]]
     (if (= provider "muse") [:f> muse-chat broker] [:f> local-manimani on-select on-open-wallet])]))
