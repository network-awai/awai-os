(ns shell.bot-chat
 (:require ["react" :refer [useState useEffect useRef]] [shell.ui-copy :as ui] [shell.screen-tools :as screen]
  ["../screen-tools.js" :refer [screenTool]]
  ["../agent-ui-state.js" :refer [readAgentSelection chooseAgent]]
  ["../bot-chat.js" :refer [CHAT_ORIGIN CHAT_MODEL chatRequest sendChat readChat agentSessions recordChatImage]]
  ["../voice-channel.js" :refer [openVoiceChannel]]
  ["../local-speech.js" :refer [speechAvailable speechStatus beginSpeech listenSpeech speakSpeech stopSpeech]]
  ["../android-inference.js" :refer [localInference androidInferenceAvailable]]))
(defn image-card [image scope prompt initial]
 (let [[result set-result] (useState initial) [status set-status] (useState nil)]
  [:figure {:data-conversation-image (:imageId image)}
   (if result [:img {:src (.-dataUrl result) :alt prompt :width 512 :height 512 :style {:max-width "100%" :height "auto"}}]
    [:button.secondary {:type "button" :on-click #(-> (.readImage localInference (:imageId image) (clj->js scope) (:sha256 image))
      (.then set-result) (.catch (fn [_] (set-status "この端末に一致する画像を確認できません。"))))} "端末内の画像を表示"])
   (when result [:button.secondary {:type "button" :on-click #(-> (.saveImage localInference (:imageId image))
    (.then (fn [_] (set-status "画像の保存と読み戻しを確認しました。")))
    (.catch (fn [_] (set-status "保存は未確認です。キャンセルした場合は保存されません。"))))} "画像を保存"])
   (when status [:figcaption {:role "status"} status])]))


(defn voice-panel [bot session-id ensure-session set-busy set-messages set-store locale blocked]
 (let [tr #(ui/t locale %) [state set-state] (useState "ready")
       [input set-input] (useState nil)
       refresh-input (fn [] (-> (speechStatus) (.then #(set-input (.-microphoneAvailable %))) (.catch (fn [_] (set-input "unknown")))))
       _ (useEffect (fn [] (refresh-input) js/undefined) #js [])
       [remaining-text set-remaining-text] (useState false) [heard-text set-heard-text] (useState "") active (useRef nil)
       stop (fn [next-state]
        (when-let [run (.-current active)]
         (set! (.-current active) nil) (.abort (.-controller run))
         (when (.-timer run) (js/clearTimeout (.-timer run)))
         (when (.-channel run) (.close (.-channel run)))
        (-> (stopSpeech) (.catch (fn [_] nil)))
         (set-busy false))
        (set-state next-state))
       _ (useEffect (fn []
        (let [hide #(when (= "hidden" (.-visibilityState js/document)) (stop "ended"))]
         (.addEventListener js/document "visibilitychange" hide)
         (fn [] (.removeEventListener js/document "visibilitychange" hide) (stop "ended")))) #js [(:id bot) session-id])
       start (fn []
        (when-not (.-current active)
         (let [run #js {:controller (js/AbortController.) :channel nil :timer nil}]
          (set! (.-current active) run) (set-busy true) (set-state "preparing") (set-remaining-text false)
          (letfn [(current? [] (identical? run (.-current active)))
                  (live! [] (when-not (current?) (throw (js/Error. "speech-session-ended"))))
                  (cycle [local channel n]
                   (live!)
                   (if (>= n 12) (do (stop "ended") (js/Promise.resolve nil))
                    (do (set-state "listening") (set-heard-text "")
                     (-> (listenSpeech local)
                      (.then (fn [heard]
                       (live!)
                       (if (empty? (.trim (.-text heard))) (cycle local channel (inc n))
                        (let [text (.-text heard)]
                         (set-heard-text text) (set-state "waiting")
                         (-> (.send channel text)
                          (.then (fn [r]
                           (live!)
                           (set-messages (fn [rows] (conj rows
                            {:id (.-requestId r) :role "user" :text text}
                            {:id (str (.-requestId r) ":reply") :role "assistant" :text (.-text r) :runId (.-runId r) :model (.-model r)})))
                           (set-store (.-store r)) (set-state "speaking")
                           (set-remaining-text (> (count (.-text r)) 512))
                           (speakSpeech local (.slice (.-text r) 0 512))))
                          (.then (fn [_] (live!) (cycle local channel (inc n)))))))))))))]
           (-> (speechStatus)
            (.then (fn [r] (live!) (set-input (.-microphoneAvailable r)) (when-not (.-microphoneAvailable r) (throw (js/Error. "microphone-input-unavailable"))) (ensure-session)))
            (.then (fn [_] (live!) (beginSpeech #js {:botId (:id bot) :sessionId session-id})))
            (.then (fn [local]
             (live!) (set-state "connecting")
             (set! (.-timer run) (js/setTimeout #(when (current?) (stop "ended")) (.-durationMs local)))
             (-> (openVoiceChannel #js {:botId (:id bot) :sessionId session-id} #js {:signal (.-signal (.-controller run))})
              (.then (fn [channel] (live!) (set! (.-channel run) channel) (cycle local channel 0))))))
            (.catch (fn [_] (when (current?) (stop "error")))))))))]
  [:article.manimani-voice {:data-voice-state state :aria-label (tr :voiceConversation)}
   [:div.agent-session-toolbar
    [:strong (tr :voiceConversation)]
    (if (.-current active)
     [:button.secondary {:type "button" :on-click #(stop "ended")} (tr :voiceStop)]
     [:button.primary {:type "button" :disabled (or blocked (not= true input) (not (speechAvailable)) (= session-id "default")) :on-click start} (tr :voiceStart)])]
   (when (= false input) [:p {:role "status" :data-voice-input-missing true} (tr :voiceInputMissing)])
   (when (= "unknown" input) [:p {:role "status"} (tr :voiceInputUnknown)])
   (when-not (.-current active) [:button.secondary {:type "button" :disabled (or blocked (not (speechAvailable))) :on-click refresh-input} (tr :voiceInputRefresh)])
   [:p (tr :voiceScopeInfo)] [:p (tr :voice-local-remote)]
   (when (or (= true input) (not= state "ready")) [:p {:role (when (contains? #{"ended" "error"} state) "status")} (tr (keyword (str "voice-" state)))])
   (when (contains? #{"ready" "ended" "error"} state) [:p (tr :voiceConsentInfo)])
   (when (seq heard-text) [:p {:data-voice-transcript true :role "status"} heard-text])
   (when remaining-text [:p (tr :voiceRemainingText)])]))

(defn panel [bot & [locale draft-id]]
 (let [tr (fn [key & [parameters]] (ui/t locale key parameters))
       [messages set-messages] (useState []) [text set-text] (useState "") [busy set-busy] (useState false)
       history-node (useRef nil)
       _ (useEffect (fn [] (when (.-current history-node) (set! (.-scrollTop (.-current history-node)) (.-scrollHeight (.-current history-node)))) js/undefined) #js [(:id (last messages))])
       [mode set-mode] (useState "text") [pending set-pending] (useState nil)
       [created set-created] (useState (not draft-id))
       _ (useEffect (fn [] (let [guard (fn [event] (when (or busy pending) (.preventDefault event)))]
        (.addEventListener js/window "awai-request-new-conversation" guard)
        (fn [] (.removeEventListener js/window "awai-request-new-conversation" guard)))) #js [busy pending])
       [sessions set-sessions] (useState []) [session-info set-session-info] (useState nil)
       [session-id set-session-id] (useState (fn [] (let [s (readAgentSelection)] (or draft-id (if (= (:id bot) (.-botId s)) (.-sessionId s) "default")))))
       _ (useEffect (fn [] (chooseAgent (:id bot) session-id) js/undefined) #js [(:id bot)])
       [message set-message] (useState nil) [screen-state set-screen-state] (useState nil) [store set-store] (useState nil) [cursor set-cursor] (useState nil)
       failure (fn [e] (set-message (if (= "client operation was not approved" (.-message e)) :chatDenied :chatUnavailable)))
       history (fn [id before]
        (set-busy true) (set-message nil)
        (-> (readChat (:id bot) before js/undefined id)
         (.then (fn [result] (let [rows (js->clj (.-messages result) :keywordize-keys true)]
          (set-messages (if before (vec (concat rows messages)) rows)) (set-session-id id) (chooseAgent (:id bot) id) (set-session-info (js->clj (.-session result) :keywordize-keys true))
          (set-created true) (set-pending nil) (set-cursor (.-nextCursor result)) (set-store (.-store result)))))
         (.catch failure) (.finally #(set-busy false))))
       list-sessions (fn [] (set-busy true) (set-message nil)
        (-> (agentSessions (:id bot))
         (.then #(do (set-sessions (js->clj (.-sessions %) :keywordize-keys true)) (set-store (.-store %))))
         (.catch failure) (.finally #(set-busy false))))
       new-session (fn [] (set-busy true) (set-message nil)
        (let [id (.randomUUID js/crypto)]
         (-> (agentSessions (:id bot) #js {:action "create" :sessionId id :title (tr :newConversation)})
          (.then (fn [r] (set-created true) (set-pending nil) (set-session-id id) (chooseAgent (:id bot) id) (set-session-info (js->clj (.-session r) :keywordize-keys true)) (set-messages []) (set-text "") (set-cursor nil)
                   (set-sessions (conj sessions (js->clj (.-session r) :keywordize-keys true))) (set-store (.-store r))))
          (.catch failure) (.finally #(set-busy false)))))
       ensure-session (fn [] (if created (js/Promise.resolve nil)
        (-> (agentSessions (:id bot) #js {:action "create" :sessionId session-id :title (tr :newConversation)})
         (.then (fn [r] (set-created true) (set-session-info (js->clj (.-session r) :keywordize-keys true)) (set-store (.-store r)))))))
       record-image (fn [item]
        (-> (recordChatImage (:request item))
         (.then (fn [r] (set-messages (conj messages {:id (.-requestId r) :role "user" :text (:prompt item)}
          (assoc (js->clj (.-message r) :keywordize-keys true) :local-result (:result item))))
          (set-pending nil) (set-message nil) (set-store (.-store r)) (set-text "")))))
       device-action (fn [action clear-draft?]
        (set-busy true)
        (set-screen-state nil)
        (-> (screenTool action)
         (.then (fn [_] (set-screen-state :screenAccepted) (when clear-draft? (set-text ""))))
         (.catch (fn [_] (set-screen-state :screenUnavailable)))
         (.finally #(set-busy false))))
       send (fn [event] (.preventDefault event)
        (when-not (or busy pending (empty? (.trim text)))
         (if-let [[action _] (when (= mode "text") (screen/command text))]
          (device-action action true)
          (do
           (set-busy true) (set-message nil)
           (-> (ensure-session)
          (.then (fn [_]
           (if (= mode "image")
            (-> (.generate localInference #js {:prompt text :modality "image" :conversation #js {:botId (:id bot) :sessionId session-id}})
             (.then (fn [r]
              (let [image (select-keys (js->clj r :keywordize-keys true) [:imageId :sha256 :bytes :width :height :modelSet :engine])
                    item {:prompt text :result r :request #js {:botId (:id bot) :sessionId session-id :requestId (.-imageId r) :text text :image (clj->js image)}}]
               (set-pending item) (record-image item)))))
            (let [value text]
             (-> (sendChat (chatRequest (clj->js bot) value (.randomUUID js/crypto) session-id))
              (.then (fn [r] (set-messages (conj messages {:id (.-requestId r) :role "user" :text value}
               {:id (str (.-requestId r) ":reply") :role "assistant" :text (.-text r) :runId (.-runId r) :model (.-model r)}))
               (set-store (.-store r)) (set-text ""))))))))
          (.catch failure) (.finally #(set-busy false)))))))]
  [:section.bot-conversation {:aria-label (tr :conversation) :data-agent-session session-id}
   [:div.agent-session-toolbar
    [:button.secondary {:type "button" :disabled (or busy (some? pending)) :on-click list-sessions} (tr :conversationSessions)]
    [:button.secondary {:type "button" :disabled (or busy (some? pending)) :on-click new-session} (tr :newConversation)]
    [:button.secondary {:type "button" :disabled (or busy (some? pending) (not created)) :on-click #(history session-id nil)} (tr :chatLoadHistory)]]
   (when (seq sessions)
    [:label.soshiki-field [:span.sr-only (tr :conversationSessions)]
     [:select {:aria-label (tr :conversationSessions) :value session-id :disabled (or busy (some? pending)) :on-change #(history (.. % -target -value) nil)}
      (when-not (some #(= session-id (:sessionId %)) sessions) [:option {:value session-id} (tr :defaultConversation)])
      (for [s sessions] ^{:key (:sessionId s)} [:option {:value (:sessionId s)} (str (if (empty? (:title s)) (tr :newConversation) (:title s)) " · " (ui/stamp locale (:updatedAt s)))])]])
   (when (contains? #{"peer" "circle-work"} (:kind session-info)) [:article.agent-peer-cycle [:strong (tr :peerDialogue)] [:h4 (:goal session-info)] [:span (if (= "circle-work" (:kind session-info)) (tr :proposalCount {:count (:completedTurns session-info)}) (tr :peerProgress {:done (:completedTurns session-info) :total (:maxTurns session-info)}))]])
   (when cursor [:button.secondary {:type "button" :disabled busy :on-click #(history session-id cursor)} (tr :chatEarlier)])
   (when store [:span.bot-chat-saved {:title "Itonami Agent · AwaiFS · Kotobase"} (tr :chatSaved)])
   [:details [:summary (tr :chatDetails)] [:p (tr :chatModelInfo {:model CHAT_MODEL})] [:p CHAT_ORIGIN]
    [:p (tr :chatDataInfo)] [:p (tr :chatStoreInfo)] [:dl [:dt (tr :conversationSessions)] [:dd session-id]]]
   [:ol.bot-conversation-history {:aria-label (tr :chatLoadHistory) :ref history-node :style (when (some #(= "local-image" (:kind %)) messages) {:max-height "56dvh"})}
    (for [m messages] ^{:key (:id m)} [:li {:data-chat-role (:role m)}
      [:strong (or (:speakerName m) (if (= "user" (:role m)) (tr :chatYou) (:name bot)))]
      (if (and (= "user" (:role m)) (or (:peer m) (:work m))) [:details [:summary (tr :peerReceived)] [:p (:text m)]] [:p (:text m)])
      (when (:localOnly m) [:p {:role "status"} "端末内のみ・Agent の会話には未記録です。履歴の再取得では表示されません。"] )
      (when (= "local-image" (:kind m)) [:f> image-card (:image m) {:botId (:id bot) :sessionId session-id}
       (or (:text (first (filter #(= (:id %) (:parentId m)) messages))) "会話で生成した画像") (:local-result m)])])]
   (when pending [:article {:data-image-record-pending true}
    [:p {:role "status"} "画像は端末内に生成済みです。会話への記録は未確認です。"]
    [:f> image-card (js->clj (.-image (:request pending)) :keywordize-keys true) {:botId (:id bot) :sessionId session-id} (:prompt pending) (:result pending)]
    [:button.secondary {:type "button" :disabled busy :on-click #(do (set-busy true) (-> (record-image pending) (.catch failure) (.finally (fn [] (set-busy false)))))} "この画像を会話に記録"]
    [:button.secondary {:type "button" :disabled busy :on-click
     #(do (set-messages (conj messages {:id (.-requestId (:request pending)) :role "user" :text (:prompt pending) :localOnly true}
          {:id (str (.-requestId (:request pending)) ":local") :role "assistant" :text "" :kind "local-image" :localOnly true
           :parentId (.-requestId (:request pending)) :image (js->clj (.-image (:request pending)) :keywordize-keys true) :local-result (:result pending)}))
          (set-pending nil) (set-text ""))} "会話に記録せず続ける"]])
   (when-not (contains? #{"peer" "circle-work"} (:kind session-info))
    [:f> voice-panel bot session-id ensure-session set-busy set-messages set-store locale (or busy (some? pending))])
   (when-let [[action label] (when (and (not busy) (nil? pending)
                                       (= "assistant" (:role (last messages)))
                                       (not (contains? #{"peer" "circle-work"} (:kind session-info))))
                              (screen/command (:text (last messages))))]
    [:button.secondary {:type "button" :on-click #(device-action action false)}
     (tr :screenBotProposal {:action (tr label)})])
   (when screen-state [:p {:role "status"} (tr screen-state)])
   (when message [:p.problem {:role "status"} (tr message)])
   (when-not (contains? #{"peer" "circle-work"} (:kind session-info)) [:form {:on-submit send}
    [:div.agent-session-toolbar
     [:button.secondary {:type "button" :disabled (or busy (some? pending)) :aria-pressed (= mode "text") :on-click #(set-mode "text")} "会話"]
     [:button.secondary {:type "button" :disabled (or busy (some? pending) (not (androidInferenceAvailable)) (= session-id "default")) :aria-pressed (= mode "image") :on-click #(set-mode "image")} "画像生成"]]
    [:label.soshiki-field [:span (if (= mode "image") "作りたい画像" (tr :chatMessage))] [:textarea {:aria-label (tr :chatMessage) :value text :max-length 8192 :rows 3 :disabled (or busy (some? pending)) :on-change #(set-text (.. % -target -value))}]]
    [:button.secondary {:type "submit" :disabled (or busy (some? pending) (empty? (.trim text)))} (if busy (tr :chatBusy) (if (= mode "image") "画像を生成" (tr :chatSend)))]])]))
