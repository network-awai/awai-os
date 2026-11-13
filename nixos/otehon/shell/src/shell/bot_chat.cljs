(ns shell.bot-chat
 (:require ["react" :refer [useState useEffect]] [shell.ui-copy :as ui]
  ["../agent-ui-state.js" :refer [readAgentSelection chooseAgent]]
  ["../bot-chat.js" :refer [CHAT_ORIGIN CHAT_MODEL chatRequest sendChat readChat agentSessions]]))
(defn panel [bot & [locale]]
 (let [tr (fn [key & [parameters]] (ui/t locale key parameters))
       [messages set-messages] (useState []) [text set-text] (useState "") [busy set-busy] (useState false)
       [sessions set-sessions] (useState []) [session-info set-session-info] (useState nil)
       [session-id set-session-id] (useState (fn [] (let [s (readAgentSelection)] (if (= (:id bot) (.-botId s)) (.-sessionId s) "default"))))
       _ (useEffect (fn [] (chooseAgent (:id bot) session-id) js/undefined) #js [(:id bot)])
       [message set-message] (useState nil) [store set-store] (useState nil) [cursor set-cursor] (useState nil)
       failure (fn [e] (set-message (if (= "client operation was not approved" (.-message e)) :chatDenied :chatUnavailable)))
       history (fn [id before]
        (set-busy true) (set-message nil)
        (-> (readChat (:id bot) before js/undefined id)
         (.then (fn [result] (let [rows (js->clj (.-messages result) :keywordize-keys true)]
          (set-messages (if before (vec (concat rows messages)) rows)) (set-session-id id) (chooseAgent (:id bot) id) (set-session-info (js->clj (.-session result) :keywordize-keys true))
          (set-cursor (.-nextCursor result)) (set-store (.-store result)))))
         (.catch failure) (.finally #(set-busy false))))
       list-sessions (fn [] (set-busy true) (set-message nil)
        (-> (agentSessions (:id bot))
         (.then #(do (set-sessions (js->clj (.-sessions %) :keywordize-keys true)) (set-store (.-store %))))
         (.catch failure) (.finally #(set-busy false))))
       new-session (fn [] (set-busy true) (set-message nil)
        (let [id (.randomUUID js/crypto)]
         (-> (agentSessions (:id bot) #js {:action "create" :sessionId id :title (tr :newConversation)})
          (.then (fn [r] (set-session-id id) (chooseAgent (:id bot) id) (set-session-info (js->clj (.-session r) :keywordize-keys true)) (set-messages []) (set-text "") (set-cursor nil)
                   (set-sessions (conj sessions (js->clj (.-session r) :keywordize-keys true))) (set-store (.-store r))))
          (.catch failure) (.finally #(set-busy false)))))
       send (fn [event] (.preventDefault event)
        (when-not busy
         (try
          (let [request (chatRequest (clj->js bot) text (.randomUUID js/crypto) session-id) value text]
           (set-busy true) (set-message nil)
           (-> (sendChat request)
            (.then (fn [r] (set-messages (conj messages {:id (.-requestId r) :role "user" :text value}
                  {:id (str (.-requestId r) ":reply") :role "assistant" :text (.-text r) :runId (.-runId r) :model (.-model r)}))
              (chooseAgent (:id bot) session-id) (set-store (.-store r)) (set-text "")))
            (.catch failure) (.finally #(set-busy false))))
          (catch :default _ (set-message :chatInvalid)))))]
  [:section.bot-conversation {:aria-label (tr :conversation) :data-agent-session session-id}
   [:div.agent-session-toolbar
    [:button.secondary {:type "button" :disabled busy :on-click list-sessions} (tr :conversationSessions)]
    [:button.secondary {:type "button" :disabled busy :on-click new-session} (tr :newConversation)]
    [:button.secondary {:type "button" :disabled busy :on-click #(history session-id nil)} (tr :chatLoadHistory)]]
   (when (seq sessions)
    [:label.soshiki-field [:span.sr-only (tr :conversationSessions)]
     [:select {:aria-label (tr :conversationSessions) :value session-id :disabled busy :on-change #(history (.. % -target -value) nil)}
      (when-not (some #(= session-id (:sessionId %)) sessions) [:option {:value session-id} (tr :defaultConversation)])
      (for [s sessions] ^{:key (:sessionId s)} [:option {:value (:sessionId s)} (str (if (empty? (:title s)) (tr :newConversation) (:title s)) " · " (ui/stamp locale (:updatedAt s)))])]])
   (when (contains? #{"peer" "circle-work"} (:kind session-info)) [:article.agent-peer-cycle [:strong (tr :peerDialogue)] [:h4 (:goal session-info)] [:span (if (= "circle-work" (:kind session-info)) (str (:completedTurns session-info) (if (= locale "ja") " 成果案" " proposals")) (tr :peerProgress {:done (:completedTurns session-info) :total (:maxTurns session-info)}))]])
   (when cursor [:button.secondary {:type "button" :disabled busy :on-click #(history session-id cursor)} (tr :chatEarlier)])
   (when store [:span.bot-chat-saved {:title "Itonami Agent · AwaiFS · Kotobase"} (tr :chatSaved)])
   [:details [:summary (tr :chatDetails)] [:p (tr :chatModelInfo {:model CHAT_MODEL})] [:p CHAT_ORIGIN]
    [:p (tr :chatDataInfo)] [:p (tr :chatStoreInfo)] [:dl [:dt (tr :conversationSessions)] [:dd session-id]]]
   [:ol.bot-conversation-history {:aria-label (tr :chatLoadHistory)}
    (for [m messages] ^{:key (:id m)} [:li {:data-chat-role (:role m)}
      [:strong (or (:speakerName m) (if (= "user" (:role m)) (tr :chatYou) (:name bot)))]
      (if (and (= "user" (:role m)) (or (:peer m) (:work m))) [:details [:summary (tr :peerReceived)] [:p (:text m)]] [:p (:text m)])])]
   (when message [:p.problem {:role "status"} (tr message)])
   (when-not (contains? #{"peer" "circle-work"} (:kind session-info)) [:form {:on-submit send}
    [:label.soshiki-field [:span (tr :chatMessage)] [:textarea {:aria-label (tr :chatMessage) :value text :max-length 8192 :rows 3 :disabled busy :on-change #(set-text (.. % -target -value))}]]
    [:button.secondary {:type "submit" :disabled (or busy (empty? (.trim text)))} (if busy (tr :chatBusy) (tr :chatSend))]])]))
