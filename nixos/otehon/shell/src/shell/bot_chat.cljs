(ns shell.bot-chat
 (:require ["react" :refer [useState]] [shell.ui-copy :as ui]
           ["../bot-chat.js" :refer [CHAT_ORIGIN CHAT_MODEL chatRequest sendChat readChat]]))
(defn panel [bot & [locale]]
 (let [tr (fn [key & [parameters]] (ui/t locale key parameters))
       [messages set-messages] (useState []) [text set-text] (useState "") [busy set-busy] (useState false)
       [message set-message] (useState nil) [store set-store] (useState nil) [cursor set-cursor] (useState nil)
       history (fn [before]
         (set-busy true) (set-message nil)
         (-> (readChat (:id bot) before)
          (.then (fn [result] (let [rows (js->clj (.-messages result) :keywordize-keys true)]
                               (set-messages (if before (vec (concat rows messages)) rows))
                               (set-cursor (.-nextCursor result)) (set-store (.-store result)))))
          (.catch #(set-message (if (= "client operation was not approved" (.-message %)) :chatDenied :chatUnavailable))) (.finally #(set-busy false))))
       send (fn [event] (.preventDefault event)
         (when-not busy
          (try
           (let [request (chatRequest (clj->js bot) text (.randomUUID js/crypto)) value text]
            (set-busy true) (set-message nil)
            (-> (sendChat request)
             (.then (fn [result]
              (set-messages (conj messages {:id (.-requestId result) :role "user" :text value}
                {:id (str (.-requestId result) ":reply") :role "assistant" :text (.-text result) :runId (.-runId result) :model (.-model result)}))
              (set-store (.-store result)) (set-text "")))
             (.catch #(set-message (if (= "client operation was not approved" (.-message %)) :chatDenied :chatUnavailable)))
             (.finally #(set-busy false))))
           (catch :default _ (set-message :chatInvalid)))))]
  [:section.bot-conversation {:aria-label (ui/t locale :conversation)}
   [:div.fleet-circle-path [:button.secondary {:type "button" :disabled busy :on-click #(history nil)} (tr :chatLoadHistory)]
    (when cursor [:button.secondary {:type "button" :disabled busy :on-click #(history cursor)} (tr :chatEarlier)])]
   (when store [:span.bot-chat-saved {:title "Itonami Agent · AwaiFS · Kotobase"} (tr :chatSaved)])
   [:details [:summary (tr :chatDetails)]
    [:p (tr :chatModelInfo {:model CHAT_MODEL})]
    [:p CHAT_ORIGIN]
    [:p (tr :chatDataInfo)]
    [:p (tr :chatStoreInfo)]]
   [:ol.bot-conversation-history {:aria-label (tr :chatLoadHistory)}
    (when (empty? messages) [:li.muted (tr :chatEmpty)])
    (for [m messages] ^{:key (:id m)} [:li {:data-chat-role (:role m)} [:strong (if (= "user" (:role m)) (tr :chatYou) (:name bot))] [:p (:text m)]])]
   (when message [:p.problem {:role "status"} (tr message)])
   [:form {:on-submit send}
    [:label.soshiki-field [:span (tr :chatMessage)] [:textarea {:aria-label (tr :chatMessage) :value text :max-length 8192 :rows 3 :disabled busy :on-change #(set-text (.. % -target -value))}]]
    [:button.secondary {:type "submit" :disabled (or busy (empty? (.trim text)))} (if busy (tr :chatBusy) (tr :chatSend))]]]))
