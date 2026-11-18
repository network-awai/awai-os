(ns shell.awai-support
  "Awai support panel (AWAI-3170), inside the Itonami context. Figma proposal:
  https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=304-939

  States: ready, card, busy, denied, received, unknown, error. Every request goes through the shared
  consent broker; the card is approved on screen first, then signed with the support approval key.
  devnet only: nothing here is money, revenue or a donation."
  (:require ["react" :refer [useState]]
            ["../awai-support.js" :refer [RECIPIENT approvalKey prepareSupport readReceipt sendSupport signApproval]]
            ["../ui-copy.js" :refer [initialLocale]]
            [shell.ui-copy :as ui]))

(def amount 1)

(defn- denied? [error] (boolean (re-find #"not approved|cancelled" (or (some-> error .-message) ""))))

(defn- row [label value]
  [:div.support-row [:dt label] [:dd value]])

(defn- notice [locale]
  [:div.support-notice {:role "note" :data-value-class "devnet"}
   [:strong (ui/t locale :supportNoticeTitle)]
   [:p (ui/t locale :supportNoticeBody)]])

(defn- expires [locale ms]
  (ui/t locale :supportExpiresValue {:minutes (max 0 (js/Math.round (/ (- ms (.now js/Date)) 60000)))}))

(defn panel [broker desk-origin]
  (let [[locale] (useState initialLocale)
        [state set-state] (useState "ready")
        [prepared set-prepared] (useState nil)
        [result set-result] (useState nil)
        [message set-message] (useState nil)
        trusted? (fn [e] (.-isTrusted (.-nativeEvent e)))
        fail (fn [error]
               (cond (denied? error) (do (set-state "denied") (set-message (ui/t locale :supportNothingSent)))
                     (.-unknown error) (set-state "unknown")
                     :else (do (set-state "error")
                               (set-message (ui/t locale :supportFailed {:reason (or (.-cause error) (.-message error))})))))
        review (fn [e]
                 (when (trusted? e)
                   (set-state "busy") (set-message (ui/t locale :supportBusyPreparing))
                   (-> (prepareSupport broker desk-origin amount)
                       (.then (fn [p] (set-prepared p) (set-message nil) (set-state "card")))
                       (.catch fail))))
        approve (fn [e]
                  (when (and (trusted? e) prepared)
                    (set-state "busy") (set-message (ui/t locale :supportBusySending))
                    (-> (approvalKey)
                        (.then (fn [pair] (signApproval pair (.-cardText prepared))))
                        (.then (fn [approval] (sendSupport broker desk-origin (.-cardText prepared) approval)))
                        (.then (fn [_] (readReceipt broker desk-origin (.. prepared -card -transferId))))
                        (.then (fn [r] (set-result r) (set-state (if (.-received r) "received" "unknown"))))
                        (.catch fail))))
        cancel (fn [e] (when (trusted? e) (set-prepared nil) (set-state "denied")
                         (set-message (ui/t locale :supportNothingSent))))
        check (fn [e]
                (when (and (trusted? e) prepared)
                  (set-state "busy") (set-message (ui/t locale :supportBusyChecking))
                  (-> (readReceipt broker desk-origin (.. prepared -card -transferId))
                      (.then (fn [r] (set-result r) (set-state (if (.-received r) "received" "unknown"))))
                      (.catch fail))))
        card (some-> prepared .-card)]
    [:section.awai-support {:aria-labelledby "awai-support-title" :data-support-state state :lang locale}
     [:h2#awai-support-title (ui/t locale :supportTitle)]
     [notice locale]
     (cond
       (empty? desk-origin)
       [:p.muted {:data-support-unavailable true} (ui/t locale :supportUnavailable)]

       (= state "ready")
       [:<>
        [:dl.support-details
         [row (ui/t locale :supportRecipient) RECIPIENT]
         [row (ui/t locale :supportUse) (ui/t locale :supportUseValue)]
         [row (ui/t locale :supportBot) "awai-support"]
         [row (ui/t locale :supportAmount) (ui/t locale :supportAmountDevnet {:amount amount})]]
        [:h3 (ui/t locale :supportRoutes)]
        [:dl.support-details
         [row (ui/t locale :supportRouteDevnet) (ui/t locale :supportAvailable)]
         [row (ui/t locale :supportRouteCrypto) (ui/t locale :supportNotYet)]
         [row (ui/t locale :supportRouteCard) (ui/t locale :supportNotYet)]
         [row (ui/t locale :supportRouteCompute) (ui/t locale :supportNotYet)]]
        [:button.primary {:type "button" :data-support-action "review" :on-click review} (ui/t locale :supportReview)]]

       (and (= state "card") card)
       [:<>
        [:p (ui/t locale :supportCardIntro)]
        [:dl.support-details {:data-support-card (.-transferId card)}
         [row (ui/t locale :supportRecipient) (.-recipient card)]
         [row (ui/t locale :supportCardBot) (.-bot card)]
         [row (ui/t locale :supportAmount) (ui/t locale :supportAmountValue {:amount (.-amount card)})]
         [row (ui/t locale :supportKind) (ui/t locale :supportKindValue)]
         [row (ui/t locale :supportChain) (.-chainId card)]
         [row (ui/t locale :supportExpires) (expires locale (.-expiresMs card))]
         [row (ui/t locale :supportDestination) (ui/t locale :supportDestinationValue {:origin desk-origin})]]
        [:p.muted (ui/t locale :supportConfirmNext)]
        [:button.primary {:type "button" :data-support-action "approve" :on-click approve} (ui/t locale :supportApprove)]
        [:button.secondary {:type "button" :data-support-action "cancel" :on-click cancel} (ui/t locale :supportCancel)]]

       (= state "busy")
       [:<> [:p {:role "status"} message]
        [:button.primary {:type "button" :disabled true} (ui/t locale :supportBusyButton)]]

       (= state "denied")
       [:<> [:p {:role "status" :data-support-outcome "nothing-sent"} message]
        [:button.primary {:type "button" :data-support-action "review" :on-click review} (ui/t locale :supportReviewAgain)]]

       (= state "received")
       [:<>
        [:p {:role "status" :data-support-outcome "received"} (ui/t locale :supportReceived {:recipient RECIPIENT})]
        [:dl.support-details
         [row (ui/t locale :supportTransfer) (.-transferId result)]
         [row (ui/t locale :supportHeight) (str (.-height result))]
         [row (ui/t locale :supportAmount) (ui/t locale :supportAmountDevnet {:amount (.-amount result)})]
         [row (ui/t locale :supportFinality) (ui/t locale :supportFinalityValue)]]
        [:button.secondary {:type "button" :data-support-action "close"
                            :on-click #(do (set-prepared nil) (set-result nil) (set-state "ready"))} (ui/t locale :close)]]

       (= state "unknown")
       [:<>
        [:p {:role "status" :data-support-outcome "unknown"} (ui/t locale :supportUnknown)]
        [:button.primary {:type "button" :data-support-action "check" :on-click check} (ui/t locale :supportCheck)]
        [:p.muted (ui/t locale :supportCheckLater)]]

       :else
       [:<> [:p.problem {:role "alert" :data-support-outcome "error"} message]
        [:button.primary {:type "button" :data-support-action "review" :on-click review} (ui/t locale :supportReviewAgain)]])]))
