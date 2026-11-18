(ns shell.awai-support
  "Awai support panel (AWAI-3170), inside the Itonami context. Figma proposal:
  https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=304-939

  States: ready, card, busy, denied, received, unknown, error. Every request goes through the shared
  consent broker; the card is approved on screen first, then signed with the support approval key.
  devnet only: nothing here is money, revenue or a donation."
  (:require ["react" :refer [useState]]
            ["../awai-support.js" :refer [approvalKey prepareSupport readReceipt sendSupport signApproval]]))

(def amount 1)

(defn- denied? [error] (boolean (re-find #"not approved|cancelled" (or (some-> error .-message) ""))))

(defn- row [label value]
  [:div.support-row [:dt label] [:dd value]])

(defn- notice []
  [:div.support-notice {:role "note" :data-value-class "devnet"}
   [:strong "devnet：実際のお金・寄付ではありません"]
   [:p "EN devnet の記録だけが動きます。寄付金控除の対象ではありません。"]])

(defn- expires [ms]
  (let [minutes (max 0 (js/Math.round (/ (- ms (.now js/Date)) 60000)))]
    (str minutes " 分後")))

(defn panel [broker desk-origin]
  (let [[state set-state] (useState "ready")
        [prepared set-prepared] (useState nil)
        [result set-result] (useState nil)
        [message set-message] (useState nil)
        trusted? (fn [e] (.-isTrusted (.-nativeEvent e)))
        fail (fn [error]
               (cond (denied? error) (do (set-state "denied") (set-message "承認されなかったため、何も送っていません。"))
                     (.-unknown error) (set-state "unknown")
                     :else (do (set-state "error")
                               (set-message (str "送れませんでした（" (or (.-cause error) (.-message error)) "）。")))))
        review (fn [e]
                 (when (trusted? e)
                   (set-state "busy") (set-message "支援の内容を受け取っています…")
                   (-> (prepareSupport broker desk-origin amount)
                       (.then (fn [p] (set-prepared p) (set-message nil) (set-state "card")))
                       (.catch fail))))
        approve (fn [e]
                  (when (and (trusted? e) prepared)
                    (set-state "busy") (set-message "送っています。")
                    (-> (approvalKey)
                        (.then (fn [pair] (signApproval pair (.-cardText prepared))))
                        (.then (fn [approval] (sendSupport broker desk-origin (.-cardText prepared) approval)))
                        (.then (fn [_] (readReceipt broker desk-origin (.. prepared -card -transferId))))
                        (.then (fn [r] (set-result r) (set-state (if (.-received r) "received" "unknown"))))
                        (.catch fail))))
        cancel (fn [e] (when (trusted? e) (set-prepared nil) (set-state "denied")
                         (set-message "承認されなかったため、何も送っていません。")))
        check (fn [e]
                (when (and (trusted? e) prepared)
                  (set-state "busy") (set-message "受け取りを確認しています…")
                  (-> (readReceipt broker desk-origin (.. prepared -card -transferId))
                      (.then (fn [r] (set-result r) (set-state (if (.-received r) "received" "unknown"))))
                      (.catch fail))))
        card (some-> prepared .-card)]
    [:section.awai-support {:aria-labelledby "awai-support-title" :data-support-state state}
     [:h2#awai-support-title "Awai を支援する"]
     [notice]
     (cond
       (empty? desk-origin)
       [:p.muted {:data-support-unavailable true} "この build には devnet の支援 desk が設定されていません。"]

       (= state "ready")
       [:<>
        [:dl.support-details
         [row "受け取り" "Awai Network LLC"]
         [row "使い道" "node 運用・Itonami dapps 開発・創作・資源提供"]
         [row "受け取る bot" "awai-support"]
         [row "金額" (str amount " EN（devnet）")]]
        [:h3 "支援の方法"]
        [:dl.support-details
         [row "EN devnet" "使えます"] [row "暗号資産" "準備中"] [row "カード" "準備中"] [row "計算資源" "準備中"]]
        [:button.primary {:type "button" :data-support-action "review" :on-click review} "内容を確認する"]]

       (and (= state "card") card)
       [:<>
        [:p "この内容に承認すると、この端末の承認鍵で署名します。"]
        [:dl.support-details {:data-support-card (.-transferId card)}
         [row "受け取り" (.-recipient card)]
         [row "bot" (.-bot card)]
         [row "金額" (str (.-amount card) " EN")]
         [row "種類" "devnet（実際のお金ではありません）"]
         [row "chain" (.-chainId card)]
         [row "期限" (expires (.-expiresMs card))]
         [row "送信先" (str desk-origin "（devnet desk）")]]
        [:p.muted "承認の後に、送信先の確認がもう一度表示されます。"]
        [:button.primary {:type "button" :data-support-action "approve" :on-click approve} "承認して送る"]
        [:button.secondary {:type "button" :data-support-action "cancel" :on-click cancel} "やめる"]]

       (= state "busy")
       [:<> [:p {:role "status"} message]
        [:button.primary {:type "button" :disabled true} "送っています…"]]

       (= state "denied")
       [:<> [:p {:role "status" :data-support-outcome "nothing-sent"} message]
        [:button.primary {:type "button" :data-support-action "review" :on-click review} "内容をもう一度確認する"]]

       (= state "received")
       [:<>
        [:p {:role "status" :data-support-outcome "received"} "Awai Network LLC の bot が受け取りました。"]
        [:dl.support-details
         [row "transfer" (.-transferId result)]
         [row "height" (str (.-height result))]
         [row "金額" (str (.-amount result) " EN（devnet）")]
         [row "確定" "単一 operator の devnet"]]
        [:button.secondary {:type "button" :data-support-action "close"
                            :on-click #(do (set-prepared nil) (set-result nil) (set-state "ready"))} "閉じる"]]

       (= state "unknown")
       [:<>
        [:p {:role "status" :data-support-outcome "unknown"}
         "desk から返事がありません。送られたかどうか分からないため、もう一度は送りません。"]
        [:button.primary {:type "button" :data-support-action "check" :on-click check} "受け取りを確認する"]
        [:p.muted "確認でも分からないときは、時間をおいてもう一度確認してください。"]]

       :else
       [:<> [:p.problem {:role "alert" :data-support-outcome "error"} message]
        [:button.primary {:type "button" :data-support-action "review" :on-click review} "内容をもう一度確認する"]])]))
