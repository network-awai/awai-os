(ns shell.awai-compute
  "Awai compute panel (AWAI-3115), inside the Itonami context.

  States: ready, card, busy, denied, received, unknown, error. Every request goes through the shared
  consent broker; the offer is approved on screen first, then signed with the provider key, and the
  work receipt is read back from the node's finalized readback. devnet only: nothing here is money,
  revenue, a deposit or a donation. The receipt carries hashes and measured counters only, never
  the prompt or the output body."
  (:require ["react" :refer [useState]]
            ["../awai-compute.js" :refer [prepareCompute providerKey readWorkReceipt runCompute signFundingPayload signOffer]]
            ["../ui-copy.js" :refer [initialLocale]]
            [shell.ui-copy :as ui]))

(def default-prompt "Write one short sentence saying hello.")

(defn- denied? [error] (boolean (re-find #"not approved|cancelled" (or (some-> error .-message) ""))))

(defn- row [label value]
  [:div.compute-row [:dt label] [:dd value]])

(defn- notice [locale]
  [:div.compute-notice {:role "note" :data-value-class "devnet"}
   [:strong (ui/t locale :computeNoticeTitle)]
   [:p (ui/t locale :computeNoticeBody)]])

(defn- expires [locale ms]
  (ui/t locale :computeExpiresValue {:minutes (max 0 (js/Math.round (/ (- ms (.now js/Date)) 60000)))}))

(defn panel [broker desk-origin provider-did]
  (let [[locale] (useState initialLocale)
        [state set-state] (useState "ready")
        [prepared set-prepared] (useState nil)
        [result set-result] (useState nil)
        [message set-message] (useState nil)
        [prompt set-prompt] (useState default-prompt)
        trusted? (fn [e] (.-isTrusted (.-nativeEvent e)))
        fail (fn [error]
               (cond (denied? error) (do (set-state "denied") (set-message (ui/t locale :computeNothingSent)))
                     (.-unknown error) (set-state "unknown")
                     :else (do (set-state "error")
                               (set-message (ui/t locale :computeFailed {:reason (or (.-cause error) (.-message error))})))))
        review (fn [e]
                 (when (trusted? e)
                   (set-state "busy") (set-message (ui/t locale :computeBusyPreparing))
                   (-> (prepareCompute broker desk-origin provider-did)
                       (.then (fn [p] (set-prepared p) (set-message nil) (set-state "card")))
                       (.catch fail))))
        approve (fn [e]
                  (when (and (trusted? e) prepared)
                    (set-state "busy") (set-message (ui/t locale :computeBusyRunning))
                    (-> (providerKey)
                        (.then (fn [pair]
                                 (-> (signOffer pair (.-offerText prepared))
                                     (.then (fn [offer-sig]
                                              (-> (signFundingPayload pair (.-fundingPayload prepared))
                                                  (.then (fn [funding-sig]
                                                           (runCompute broker desk-origin (.-offerText prepared)
                                                                       offer-sig funding-sig prompt)))))))))
                        (.then (fn [_] (readWorkReceipt broker desk-origin (.. prepared -offer -orderId))))
                        (.then (fn [r] (set-result r) (set-state (if (.-received r) "received" "unknown"))))
                        (.catch fail))))
        cancel (fn [e] (when (trusted? e) (set-prepared nil) (set-state "denied")
                         (set-message (ui/t locale :computeNothingSent))))
        check (fn [e]
                (when (and (trusted? e) prepared)
                  (set-state "busy") (set-message (ui/t locale :computeBusyChecking))
                  (-> (readWorkReceipt broker desk-origin (.. prepared -offer -orderId))
                      (.then (fn [r] (set-result r) (set-state (if (.-received r) "received" "unknown"))))
                      (.catch fail))))
        offer (some-> prepared .-offer)]
    [:section.awai-compute {:aria-labelledby "awai-compute-title" :data-compute-state state :lang locale}
     [:h2#awai-compute-title (ui/t locale :computeTitle)]
     [notice locale]
     (cond
       (or (empty? desk-origin) (empty? provider-did))
       [:p.muted {:data-compute-unavailable true} (ui/t locale :computeUnavailable)]

       (= state "ready")
       [:<>
        [:dl.compute-details
         [row (ui/t locale :computeProvider) provider-did]
         [row (ui/t locale :computeConsumer) (ui/t locale :computeConsumerValue)]
         [row (ui/t locale :computeAmount) (ui/t locale :computeAmountDevnet {:amount 1})]
         [row (ui/t locale :computeKind) (ui/t locale :computeKindValue)]]
        [:button.primary {:type "button" :data-compute-action "review" :on-click review} (ui/t locale :computeReview)]]

       (and (= state "card") offer)
       [:<>
        [:p (ui/t locale :computeCardIntro)]
        [:dl.compute-details {:data-compute-card (.-orderId offer)}
         [row (ui/t locale :computeProvider) (.-provider offer)]
         [row (ui/t locale :computeConsumer) (.-consumer offer)]
         [row (ui/t locale :computeAmount) (ui/t locale :computeAmountDevnet {:amount (.-amount offer)})]
         [row (ui/t locale :computeOrder) (.-orderId offer)]
         [row (ui/t locale :computeChain) (.-chainId offer)]
         [row (ui/t locale :computeExpires) (expires locale (.-expiresMs offer))]
         [row (ui/t locale :computeDestination) (ui/t locale :computeDestinationValue {:origin desk-origin})]]
        [:label.compute-prompt [:span (ui/t locale :computePromptLabel)]
         [:input {:type "text" :value prompt :maxLength 200
                  :on-change #(set-prompt (.. % -target -value))}]]
        [:p.muted (ui/t locale :computeConfirmNext)]
        [:button.primary {:type "button" :data-compute-action "approve" :on-click approve} (ui/t locale :computeApprove)]
        [:button.secondary {:type "button" :data-compute-action "cancel" :on-click cancel} (ui/t locale :computeCancel)]]

       (= state "busy")
       [:<> [:p {:role "status"} message]
        [:button.primary {:type "button" :disabled true} (ui/t locale :computeBusyButton)]]

       (= state "denied")
       [:<> [:p {:role "status" :data-compute-outcome "nothing-sent"} message]
        [:button.primary {:type "button" :data-compute-action "review" :on-click review} (ui/t locale :computeReviewAgain)]]

       (= state "received")
       [:<>
        [:p {:role "status" :data-compute-outcome "received"} (ui/t locale :computeReceived)]
        [:dl.compute-details
         [row (ui/t locale :computeOrder) (.-orderId result)]
         [row (ui/t locale :computeHeight) (str (.-height result))]
         [row (ui/t locale :computeAmount) (ui/t locale :computeAmountDevnet {:amount (.-amount result)})]
         [row (ui/t locale :computeFinality) (ui/t locale :computeFinalityValue)]
         [row (ui/t locale :computeReceiptInput) (.-input result)]
         [row (ui/t locale :computeReceiptOutput) (.-output result)]
         [row (ui/t locale :computeEngineCalls) (str (.-engineCalls result))]]
        [:button.secondary {:type "button" :data-compute-action "close"
                            :on-click #(do (set-prepared nil) (set-result nil) (set-state "ready"))} (ui/t locale :close)]]

       (= state "unknown")
       [:<>
        [:p {:role "status" :data-compute-outcome "unknown"} (ui/t locale :computeUnknown)]
        [:button.primary {:type "button" :data-compute-action "check" :on-click check} (ui/t locale :computeCheck)]
        [:p.muted (ui/t locale :computeCheckLater)]]

       :else
       [:<> [:p.problem {:role "alert" :data-compute-outcome "error"} message]
        [:button.primary {:type "button" :data-compute-action "review" :on-click review} (ui/t locale :computeReviewAgain)]])]))
