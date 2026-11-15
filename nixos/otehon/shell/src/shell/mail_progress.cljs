(ns shell.mail-progress (:require [shell.ui-copy :as ui]
 ["react" :refer [useState useEffect useId]]
 ["../mail-aliases.js" :refer [manageAliases manageIdentity]]
 ["../mail-alias-contract.js" :refer [MAIL_ORIGIN]]))
(defn manager [selected locale]
 (let [[view set-view] (useState nil) [busy set-busy] (useState false)
       [problem set-problem] (useState nil) [notice set-notice] (useState nil) [purpose set-purpose] (useState "") [party set-party] (useState "")
       [pending set-pending] (useState nil) [stop-id set-stop-id] (useState nil) id (useId)
       tr (fn [k] (ui/t locale k))
       _ (useEffect (fn [] (set-view nil) (set-pending nil) (set-problem nil) (set-purpose "") (set-party "") js/undefined) #js [selected])
       call (fn [action values]
        (set-busy true) (set-problem nil) (set-notice nil)
        (-> (manageAliases selected action (clj->js values))
         (.then #(do (set-view (js->clj % :keywordize-keys true)) (when (= "issue" action) (set-pending nil) (set-purpose "") (set-party "")) (set-stop-id nil)))
         (.catch #(set-problem (if (contains? #{"mailBindingRequired" "mailReloadRequired" "identityRecoveryRequired" "identityStoreStale"} (.-message %)) (keyword (.-message %)) :mailAliasUnavailable)))
         (.finally #(set-busy false))))
       submit (fn [e] (.preventDefault e)
        (when-not busy
         (let [request (or pending {:requestId (.randomUUID js/crypto) :basis (:basis view) :purpose purpose :counterparty party})]
          (set-pending request) (call "issue" request))))]
  [:div.mail-alias-manager
   [:button.secondary {:type "button" :disabled busy :on-click #(call "list" {})} (tr :mailManage)]
   (when problem [:p.problem {:role "status"} (tr problem)])
   (when notice [:p {:role "status"} (tr notice)])
   (when (= problem :identityRecoveryRequired)
    [:button.secondary {:type "button" :disabled busy :on-click
     #(do (set-busy true)
       (-> (manageIdentity selected "recover")
        (.then (fn [_] (set-problem nil) (set-notice :identityRecovered) (set-view nil)))
        (.catch (fn [_] (set-problem :identityRecoveryRequired))) (.finally (fn [] (set-busy false)))))} (tr :identityRecover)])
   (when view
    [:div
     [:details [:summary (tr :mailIdentity)] [:dl.fleet-facts [:dt "ID"] [:dd (:principalId view)] [:dt "DID"] [:dd {:style {:overflow-wrap "anywhere"}} (:did view)]]]
     [:form {:method "post" :action (str MAIL_ORIGIN "/v1/mail/aliases/issue") :aria-labelledby (str id "-heading") :on-submit submit}
      [:h4 {:id (str id "-heading")} (tr :mailNewAlias)]
      [:label.soshiki-field {:html-for (str id "-purpose")} (tr :mailPurpose)]
      [:input {:id (str id "-purpose") :name "purpose" :required true :max-length 120 :value purpose :disabled (or busy (some? pending)) :style {:font-size "1rem" :min-height "48px" :max-width "100%"} :on-change #(set-purpose (.. % -target -value))}]
      [:label.soshiki-field {:html-for (str id "-party")} (tr :mailCounterparty)]
      [:input {:id (str id "-party") :name "counterparty" :required true :max-length 254 :value party :disabled (or busy (some? pending)) :style {:font-size "1rem" :min-height "48px" :max-width "100%"} :on-change #(set-party (.. % -target -value))}]
      [:button.secondary {:type "submit" :disabled busy} (tr (if pending :mailCheckIssue :mailIssue))]]
     [:ul (for [a (:aliases view)] ^{:key (:aliasId a)}
      [:li [:strong (:purpose a)] [:span (str " · " (:counterparty a))]
       [:code {:style {:display "block" :overflow-wrap "anywhere"}} (:address a)]
       [:span (tr (case (:state a) "stopped" :mailStopped "expired" :mailExpired :mailRoutingPending))]
       (when (= "reserved" (:state a))
        (if (= stop-id (:aliasId a))
         [:span [:button.secondary {:type "button" :disabled busy :on-click #(call "stop" {:requestId (.randomUUID js/crypto) :basis (:basis view) :aliasId (:aliasId a)})} (tr :mailConfirmStop)]
          [:button.secondary {:type "button" :disabled busy :on-click #(set-stop-id nil)} (tr :mailCancel)]]
         [:button.secondary {:type "button" :disabled busy :on-click #(set-stop-id (:aliasId a))} (tr :mailStop)]))])]])]))
(defn panel [progress selected locale]
 (when progress
  (let [bot (first (filter #(= selected (:botId %)) (:entries progress)))]
   [:section.fleet-cooperation {:aria-labelledby "bot-mail-heading"}
    [:h3 {:id "bot-mail-heading"} (ui/t locale :botMail)]
    (when selected ^{:key selected} [:f> manager selected locale])
    [:p (ui/t locale :mailReservedCount {:count (count (:entries progress))})]
    [:ul [:li (ui/t locale :mailRoutingPending)] [:li (ui/t locale :mailKeysPending)] [:li (ui/t locale :mailSendNotGranted)]]
    [:a {:href "https://linear.app/kotobalabs/issue/AWAI-328"} "AWAI-328"]
    [:details.fleet-disclosure [:summary (ui/t locale :executionDetails)]
     (when bot [:dl.fleet-facts [:dt (ui/t locale :mailLegacyAddress)] [:dd [:code {:style {:overflow-wrap "anywhere"}} (:address bot)]]])
     [:p (ui/t locale :mailGatewayGoogle)]
     [:time (ui/stamp locale (:observedAt progress))]]])))
