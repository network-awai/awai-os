(ns shell.bot-chat
 (:require ["react" :refer [useState useEffect useLayoutEffect useRef]] [clojure.string :as str]
  [shell.ui-copy :as ui] [shell.screen-tools :as screen]
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
   [:details.chat-connection [:summary (tr :chatVoiceDetails)]
    [:div.chat-connection-body
     (when (= false input) [:p {:role "status" :data-voice-input-missing true} (tr :voiceInputMissing)])
     (when (= "unknown" input) [:p {:role "status"} (tr :voiceInputUnknown)])
     (when-not (.-current active)
      [:button.secondary {:type "button" :disabled (or blocked (not (speechAvailable))) :on-click refresh-input} (tr :voiceInputRefresh)])
     [:p (tr :voiceScopeInfo)] [:p (tr :voice-local-remote)] [:p (tr :voiceConsentInfo)]]]
   (when (not= state "ready")
    [:p {:role "status"} (tr (keyword (str "voice-" state)))])
   (when (seq heard-text) [:p {:data-voice-transcript true :role "status"} heard-text])
   (when remaining-text [:p (tr :voiceRemainingText)])]))

(defn- local-voice [scope busy set-busy set-text reply]
 (let [active (useRef nil)
       [action set-action] (useState nil)
       [status set-status] (useState nil)
       stop (fn []
              (when-let [run (.-current active)]
               (vreset! run true)
               (-> (stopSpeech) (.catch (fn [_] nil)))))
       run (fn [kind]
             (when-not (or busy (.-current active))
              (let [turn (volatile! false)]
               (set! (.-current active) turn)
               (set-busy true) (set-action kind) (set-status nil)
               (-> (beginSpeech scope)
                (.then (fn [session]
                         (when-not @turn
                          (if (= kind "listen") (listenSpeech session)
                           (speakSpeech session (.slice reply 0 512))))))
                (.finally stopSpeech)
                (.then (fn [result]
                         (when (and (not @turn) (= kind "listen"))
                          (if-let [heard (not-empty (.trim (.-text result)))]
                           (set-text (fn [draft] (if (seq draft) (str draft "\n" heard) heard)))
                           (set-status "音声を認識できませんでした。")))))
                (.catch (fn [_]
                          (when-not @turn
                           (set-status "端末内の音声機能を使えませんでした。マイクの許可と音声モデルを確認してください。"))))
                (.finally (fn [] (set! (.-current active) nil) (set-action nil) (set-busy false)))))))]
  (useEffect
   (fn []
    (let [hide #(when (= "hidden" (.-visibilityState js/document)) (stop))]
     (.addEventListener js/document "visibilitychange" hide)
     (fn [] (.removeEventListener js/document "visibilitychange" hide) (stop)))) #js [])
  [:div.agent-session-toolbar
   (if action
    [:button.secondary {:type "button" :on-click stop} "停止"]
    [:<>
     [:button.secondary {:type "button" :disabled (or busy (not (speechAvailable))) :on-click #(run "listen")}
      "マイクで入力"]
     (when (seq reply)
      [:button.secondary {:type "button" :disabled (or busy (not (speechAvailable))) :on-click #(run "speak")}
       (if (> (count reply) 512) "応答の冒頭を読み上げる" "応答を読み上げる")])])
   (when status [:p {:role "status"} status])]))

(defn- message-copy [text locale]
 (let [[status set-status] (useState nil)
       copy (fn []
              (set-status nil)
              (if-let [clipboard (.-clipboard js/navigator)]
                (-> (.writeText clipboard text)
                    (.then #(set-status :chatCopied))
                    (.catch #(set-status :chatCopyUnavailable)))
                (set-status :chatCopyUnavailable)))]
  [:div.chat-message-actions
   [:button.secondary {:type "button" :on-click copy} (ui/t locale :chatCopy)]
   [:span {:role "status"} (when status (ui/t locale status))]]))

(defn- at-latest? [node]
 (<= (- (.-scrollHeight node) (.-clientHeight node) (.-scrollTop node)) 32))

(defn- search-text [value]
 (str/lower-case (.normalize value)))

(defn- composing? [event]
 (let [native (.-nativeEvent event)]
  (or (.-isComposing native) (= 229 (.-keyCode native)))))

(defn- local-prompt [messages text]
 (let [prior (->> messages (filter #(seq (:text %))) (take-last 6))
       prompt (str "会話の続きとして、最後の利用者のメッセージに応答してください。\n"
                   (str/join "\n" (map #(str (if (= "user" (:role %)) "利用者: " "Murakumo: ") (:text %)) prior))
                   "\n利用者: " text)]
  (if (and (seq prior) (<= (.-length (.encode (js/TextEncoder.) prompt)) 8192)) prompt text)))

(defn panel [bot & [locale draft-id local?]]
 (let [tr (fn [key & [parameters]] (ui/t locale key parameters))
       [messages set-messages] (useState []) [text set-text] (useState "") [busy set-busy] (useState false)
       history-node (useRef nil) history-anchor (useRef nil) follow-history (useRef true)
       search-input (useRef nil) search-toggle (useRef nil) search-row (useRef nil)
       composition (useRef false) shortcut-armed (useRef false) submit-lock (useRef false)
       [search-open set-search-open] (useState false) [query set-query] (useState "")
       [selected-match set-selected-match] (useState nil)
       search-term (search-text (str/trim query))
       matches (when (and search-open (seq search-term))
                 (into [] (comp (filter #(str/includes? (search-text (or (:text %) "")) search-term))
                                (map :id)) messages))
       match-count (count matches)
       match-index (or (first (keep-indexed #(when (= %2 selected-match) %1) matches)) 0)
       match-id (get matches match-index)
       shift-match (fn [direction]
                     (when (pos? match-count)
                      (set-selected-match (nth matches (mod (+ match-index direction) match-count)))))
       close-search (fn []
                      (set-search-open false)
                      (set-query "")
                      (set-selected-match nil)
                      (when-let [toggle (.-current search-toggle)] (.focus toggle)))
       [at-latest set-at-latest] (useState true)
       _ (useLayoutEffect
          (fn []
           (if-let [node (.-current history-node)]
            (do
             (if-let [old (.-current history-anchor)]
              (do (set! (.-current history-anchor) nil)
                  (when (identical? node (:node old))
                   (set! (.-scrollTop node) (+ (:top old) (- (.-scrollHeight node) (:height old))))))
              (when (.-current follow-history)
               (set! (.-scrollTop node) (.-scrollHeight node))))
             (let [latest (at-latest? node)]
              (set! (.-current follow-history) latest)
              (set-at-latest latest)))
            (do (set! (.-current follow-history) true)
                (set-at-latest true)))
           js/undefined)
          #js [messages])
       _ (useLayoutEffect (fn []
           (when search-open
            (when-let [input (.-current search-input)] (.focus input)))
           js/undefined) #js [search-open])
       _ (useLayoutEffect (fn []
           (when-let [row (.-current search-row)]
            (when-let [node (.-current history-node)]
             (when-let [details (.querySelector row "details")] (set! (.-open details) true))
             (let [row-rect (.getBoundingClientRect row)
                   view-rect (.getBoundingClientRect node)]
              (when (or (< (.-top row-rect) (.-top view-rect))
                        (> (.-bottom row-rect) (.-bottom view-rect)))
               (set! (.-scrollTop node) (+ (.-scrollTop node) (- (.-top row-rect) (.-top view-rect)) -4))))))
           js/undefined) #js [match-id search-term])
       track-history (fn [event]
                       (let [latest (at-latest? (.-currentTarget event))]
                        (set! (.-current follow-history) latest)
                        (set-at-latest latest)))
       jump-latest (fn []
                     (when-let [node (.-current history-node)]
                      (.focus node)
                      (set! (.-scrollTop node) (.-scrollHeight node))
                      (set! (.-current follow-history) true)
                      (set-at-latest true)))
       [mode set-mode] (useState "text") [pending set-pending] (useState nil)
       [last-reply set-last-reply] (useState nil)
       [created set-created] (useState (or local? (not draft-id)))
       _ (useEffect (fn [] (let [guard (fn [event] (when (or busy pending) (.preventDefault event)))]
        (.addEventListener js/window "awai-request-new-conversation" guard)
        (fn [] (.removeEventListener js/window "awai-request-new-conversation" guard)))) #js [busy pending])
       [sessions set-sessions] (useState []) [session-info set-session-info] (useState nil)
       [session-id set-session-id] (useState (fn [] (or draft-id (when local? (.randomUUID js/crypto))
                                      (let [s (readAgentSelection)]
                                       (if (= (:id bot) (.-botId s)) (.-sessionId s) "default")))))
       _ (useEffect (fn [] (when-not local? (chooseAgent (:id bot) session-id)) js/undefined) #js [(:id bot)])
       [message set-message] (useState nil) [screen-state set-screen-state] (useState nil) [store set-store] (useState nil) [cursor set-cursor] (useState nil)
       failure (fn [e] (set-message (if (= "client operation was not approved" (.-message e)) :chatDenied :chatUnavailable)))
       history (fn [id before]
        (set-busy true) (set-message nil)
        (-> (readChat (:id bot) before js/undefined id)
         (.then (fn [result] (let [rows (js->clj (.-messages result) :keywordize-keys true)]
          (if before
           (when-let [node (.-current history-node)]
            (set! (.-current history-anchor) {:node node :top (.-scrollTop node) :height (.-scrollHeight node)}))
           (do (set! (.-current follow-history) true) (set-last-reply nil) (set-search-open false)
               (set-query "") (set-selected-match nil)))
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
                   (set-search-open false) (set-query "") (set-selected-match nil)
                   (set-sessions (conj sessions (js->clj (.-session r) :keywordize-keys true))) (set-store (.-store r))))
          (.catch failure) (.finally #(set-busy false)))))
       ensure-session (fn [] (if created (js/Promise.resolve nil)
        (-> (agentSessions (:id bot) #js {:action "create" :sessionId session-id :title (tr :newConversation)})
         (.then (fn [r] (set-created true) (set-session-info (js->clj (.-session r) :keywordize-keys true)) (set-store (.-store r)))))))
       record-image (fn [item]
        (-> (recordChatImage (:request item))
         (.then (fn [r] (set-messages (conj messages {:id (.-requestId r) :role "user" :text (:prompt item)}
          (assoc (js->clj (.-message r) :keywordize-keys true) :local-result (:result item))))
          (set-last-reply (.. r -message -id))
          (set-pending nil) (set-message nil) (set-store (.-store r)) (set-text "")))))
       device-action (fn [action clear-draft?]
        (set-busy true)
        (set-screen-state nil)
        (-> (screenTool action)
         (.then (fn [_] (set-screen-state :screenAccepted) (when clear-draft? (set-text ""))))
         (.catch (fn [_] (set-screen-state :screenUnavailable)))
         (.finally #(set-busy false))))
       scope #js {:botId (:id bot) :sessionId session-id}
       [local-status set-local-status] (useState nil)
       [readiness set-readiness] (useState nil)
       refresh-local (fn []
                      (-> (.info localInference)
                       (.then (fn [info]
                                (set-readiness (when (and (= "awai.inference.client.v1" (.-schema info))
                                                          (= "network.awai.murakumo" (.-provider info))
                                                          (= false (.-remote info))) info))))
                       (.catch (fn [_] (set-readiness nil)))))
       _ (useEffect
          (fn []
           (when local?
            (refresh-local)
            (.addEventListener js/window "focus" refresh-local))
           (fn [] (when local? (.removeEventListener js/window "focus" refresh-local)))) #js [local?])
       ready? (and (some-> readiness .-installed)
                   (if (= mode "image") (some-> readiness .-status .-image .-imported)
                    (some-> readiness .-status .-loaded)))
       local-submit (fn []
                      (set-local-status nil)
                      (-> (.generate localInference #js {:prompt (if (= mode "image") text (local-prompt messages text))
                                                          :modality (if (= mode "image") "image" "text")
                                                          :conversation scope})
                       (.then (fn [result]
                                (let [id (.-requestId result)
                                      reply (str id ":reply")]
                                 (set! (.-current follow-history) true)
                                 (set-messages (conj messages {:id id :role "user" :text text}
                                                 (if (= mode "image")
                                                  {:id reply :role "assistant" :kind "local-image" :parentId id
                                                   :image {:imageId (.-imageId result) :sha256 (.-sha256 result)}
                                                   :local-result result}
                                                  {:id reply :role "assistant" :text (.-text result)})))
                                 (set-last-reply reply)
                                 (set-text ""))))
                       (.catch (fn [_] (set-local-status "生成を完了できませんでした。Murakumo の許可とモデルを確認してください。")))))
       finish-submit (fn [] (set! (.-current submit-lock) false) (set-busy false))
       send (fn [event] (.preventDefault event)
        (when-not (or busy pending (.-current composition) (.-current submit-lock)
                      (and local? (not ready?)) (empty? (.trim text)))
         (if local?
          (do (set! (.-current submit-lock) true) (set-busy true)
              (-> (local-submit) (.finally finish-submit)))
          (if-let [[action _] (when (= mode "text") (screen/command text))]
          (device-action action true)
          (do
           (set! (.-current submit-lock) true)
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
              (.then (fn [r]
               (let [reply-id (str (.-requestId r) ":reply")]
                (set-messages (conj messages {:id (.-requestId r) :role "user" :text value}
                 {:id reply-id :role "assistant" :text (.-text r) :runId (.-runId r) :model (.-model r)}))
                (set-last-reply reply-id))
               (set-store (.-store r)) (set-text ""))))))))
          (.catch failure) (.finally finish-submit)))))))]
  [:section.bot-conversation {:aria-label (tr :conversation)
                             :data-agent-session (when-not local? session-id)
                             :data-local-conversation (when local? true)}
   [:header.bot-conversation-header
    [:strong (:name bot)]
    (when store [:span.bot-chat-saved {:title "Itonami Agent · AwaiFS · Kotobase"} (tr :chatSaved)])]
   (when-not local?
    [:div.agent-session-toolbar
    [:button.secondary {:type "button" :disabled (or busy (some? pending)) :on-click list-sessions} (tr :conversationSessions)]
    [:button.secondary {:type "button" :disabled (or busy (some? pending)) :on-click new-session} (tr :newConversation)]
    [:button.secondary {:type "button" :disabled (or busy (some? pending) (not created)) :on-click #(history session-id nil)} (tr :chatLoadHistory)]])
   (when (seq sessions)
    [:label.soshiki-field [:span.sr-only (tr :conversationSessions)]
     [:select {:aria-label (tr :conversationSessions) :value session-id :disabled (or busy (some? pending)) :on-change #(history (.. % -target -value) nil)}
      (when-not (some #(= session-id (:sessionId %)) sessions) [:option {:value session-id} (tr :defaultConversation)])
      (for [s sessions] ^{:key (:sessionId s)} [:option {:value (:sessionId s)} (str (if (empty? (:title s)) (tr :newConversation) (:title s)) " · " (ui/stamp locale (:updatedAt s)))])]])
   (when (contains? #{"peer" "circle-work"} (:kind session-info)) [:article.agent-peer-cycle [:strong (tr :peerDialogue)] [:h4 (:goal session-info)] [:span (if (= "circle-work" (:kind session-info)) (tr :proposalCount {:count (:completedTurns session-info)}) (tr :peerProgress {:done (:completedTurns session-info) :total (:maxTurns session-info)}))]])
   (if local?
    [:div
     [:p.muted {:role "status"}
      (cond ready? "Murakumo · この端末のみ"
            (some-> readiness .-installed) "Murakumo で対応するモデルを準備してください。"
            :else "この端末で使える Murakumo を確認できません。")]
     (when (and (some-> readiness .-installed) (not ready?))
      [:button.secondary {:type "button" :disabled busy :on-click
                          #(-> (.open localInference) (.catch (fn [_] (set-local-status "Murakumo を開けませんでした。"))))}
       "Murakumo を開く"])]
    [:details.chat-connection [:summary (tr :chatDetails)]
     [:div.chat-connection-body
      [:p (tr :chatModelInfo {:model CHAT_MODEL})] [:p CHAT_ORIGIN]
      [:p (tr :chatDataInfo)] [:p (tr :chatStoreInfo)] [:dl [:dt (tr :conversationSessions)] [:dd session-id]]]])
   (when (or local? (seq messages))
    [:div.chat-search
     [:button.secondary {:type "button" :ref search-toggle :aria-expanded search-open
                         :on-click #(if search-open (close-search) (set-search-open true))}
      (tr :chatFind)]
     (when search-open
      [:div.chat-search-controls
       {:on-key-down (fn [event]
                       (when (and (= "Escape" (.-key event)) (not (composing? event)))
                        (.preventDefault event) (.stopPropagation event) (close-search)))}
       [:label.soshiki-field
        [:span (tr :chatFindLoaded)]
        [:input {:type "search" :name "query" :ref search-input :value query
                 :auto-complete "off" :auto-capitalize "none" :auto-correct "off" :spell-check false
                 :on-change #(do (set-query (.. % -target -value)) (set-selected-match nil))
                 :on-key-down (fn [event]
                                (when (and (= "Enter" (.-key event)) (not (composing? event)))
                                 (.preventDefault event)
                                 (shift-match (if (.-shiftKey event) -1 1))))}]]
       [:div.chat-search-navigation
        [:button.secondary {:type "button" :disabled (< match-count 2) :on-click #(shift-match -1)} (tr :chatFindPrevious)]
        [:button.secondary {:type "button" :disabled (< match-count 2) :on-click #(shift-match 1)} (tr :chatFindNext)]
        [:span {:role "status"}
         (when (seq search-term)
          (if (pos? match-count)
           (tr :chatFindPosition {:current (inc match-index) :total match-count})
           (tr :chatFindNone)))]]])])
   (when cursor [:button.secondary {:type "button" :disabled busy :on-click #(history session-id cursor)} (tr :chatEarlier)])
   (if (empty? messages)
    [:p.chat-empty (if local? "この端末の新しい会話です。" (tr (if (or (not created) store) :chatEmptyDraft :chatEmpty)))]
    [:ol.bot-conversation-history {:aria-label (tr :chatTranscript) :ref history-node :tab-index 0 :on-scroll track-history
                                    :style (when (some #(= "local-image" (:kind %)) messages) {:max-height "56dvh"})}
     (for [m messages :let [received? (and (= "user" (:role m)) (or (:peer m) (:work m)))]]
      ^{:key (:id m)} [:li {:data-chat-role (:role m) :data-chat-new (when (= (:id m) last-reply) "true")
                           :ref (when (= (:id m) match-id) search-row)
                           :aria-current (when (= (:id m) match-id) "true")}
       [:strong (or (:speakerName m) (if (= "user" (:role m)) (tr :chatYou) (:name bot)))]
       (if received?
        [:details [:summary (tr :peerReceived)] [:p.chat-message-text (:text m)]
         (when (seq (:text m)) [:f> message-copy (:text m) locale])]
        (when (seq (:text m))
         [:<> [:p.chat-message-text (:text m)] [:f> message-copy (:text m) locale]]))
       (when (:localOnly m) [:p {:role "status"} "端末内のみ・Agent の会話には未記録です。履歴の再取得では表示されません。"])
       (when (= "local-image" (:kind m)) [:f> image-card (:image m) {:botId (:id bot) :sessionId session-id}
        (or (:text (first (filter #(= (:id %) (:parentId m)) messages))) "会話で生成した画像") (:local-result m)])])])
   (when-not at-latest
    [:button.secondary.chat-latest {:type "button" :on-click jump-latest} (tr :chatLatest)])
   (when busy [:p.chat-waiting {:role "status"} (tr :chatBusy)])
   (when pending [:article {:data-image-record-pending true}
    [:p {:role "status"} "画像は端末内に生成済みです。会話への記録は未確認です。"]
    [:f> image-card (js->clj (.-image (:request pending)) :keywordize-keys true) {:botId (:id bot) :sessionId session-id} (:prompt pending) (:result pending)]
    [:button.secondary {:type "button" :disabled busy :on-click #(do (set-busy true) (-> (record-image pending) (.catch failure) (.finally (fn [] (set-busy false)))))} "この画像を会話に記録"]
    [:button.secondary {:type "button" :disabled busy :on-click
     #(do (set-messages (conj messages {:id (.-requestId (:request pending)) :role "user" :text (:prompt pending) :localOnly true}
          {:id (str (.-requestId (:request pending)) ":local") :role "assistant" :text "" :kind "local-image" :localOnly true
           :parentId (.-requestId (:request pending)) :image (js->clj (.-image (:request pending)) :keywordize-keys true) :local-result (:result pending)}))
          (set-pending nil) (set-text ""))} "会話に記録せず続ける"]])
   (when-let [[action label] (when (and (not local?) (not busy) (nil? pending)
                                       (= "assistant" (:role (last messages)))
                                       (not (contains? #{"peer" "circle-work"} (:kind session-info))))
                              (screen/command (:text (last messages))))]
    [:button.secondary {:type "button" :on-click #(device-action action false)}
     (tr :screenBotProposal {:action (tr label)})])
   (when screen-state [:p {:role "status"} (tr screen-state)])
   (when message [:p.problem {:role "status"} (tr message)])
   (when local-status [:p {:role "status"} local-status])
   (when-not (contains? #{"peer" "circle-work"} (:kind session-info))
    [:form.chat-composer {:on-submit send}
     [:div.agent-session-toolbar {:role "group" :aria-label (tr :conversation)}
      [:button.secondary {:type "button" :disabled (or busy (some? pending)) :aria-pressed (= mode "text") :on-click #(set-mode "text")} (tr :chatTextMode)]
      [:button.secondary {:type "button" :disabled (or busy (some? pending) (not (androidInferenceAvailable)) (= session-id "default")) :aria-pressed (= mode "image") :on-click #(set-mode "image")} (tr :chatImageMode)]
      (when local?
       [:button.secondary {:type "button" :disabled busy :aria-pressed (= mode "voice") :on-click #(set-mode "voice")} (tr :voiceConversation)])]
     (let [label (tr (if (= mode "image") :chatImagePrompt :chatMessage))]
      [:label.soshiki-field [:span.sr-only label]
       [:textarea {:placeholder label :value text :max-length 8192 :rows 2
                   :read-only (or busy (some? pending))
                   :on-change #(set-text (.. % -target -value))
                   :on-blur #(do (set! (.-current composition) false) (set! (.-current shortcut-armed) false))
                   :on-composition-start #(do (set! (.-current composition) true) (set! (.-current shortcut-armed) false))
                   :on-composition-end #(set! (.-current composition) false)
                   :on-key-down (fn [event]
                                 (when (= "Enter" (.-key event))
                                  (let [shortcut? (or (.-ctrlKey event) (.-metaKey event))
                                        editing? (or (.-current composition) (composing? event))]
                                   (when (and shortcut? (not editing?)) (.preventDefault event))
                                   (set! (.-current shortcut-armed)
                                         (boolean (and shortcut? (not editing?) (not (.-repeat event))))))))
                   :on-key-up (fn [event]
                                (when (= "Enter" (.-key event))
                                 (let [submit? (.-current shortcut-armed)]
                                  (set! (.-current shortcut-armed) false)
                                  (when (and submit? (not (composing? event))) (send event)))))}]])
     (when (and local? (= mode "voice"))
      [:f> local-voice scope busy set-busy set-text
       (some->> messages (filter #(and (= "assistant" (:role %)) (seq (:text %)))) last :text)])
     [:div.chat-composer-actions
      [:button.primary {:type "submit" :disabled (or busy (some? pending) (and local? (not ready?)) (empty? (.trim text)))}
       (tr (if (= mode "image") :chatImageSend :chatSend))]]])
   (when (and (not local?) (not (contains? #{"peer" "circle-work"} (:kind session-info))))
    [:f> voice-panel bot session-id ensure-session set-busy set-messages set-store locale (or busy (some? pending))])]))
