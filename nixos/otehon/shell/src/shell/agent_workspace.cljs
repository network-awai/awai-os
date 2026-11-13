(ns shell.agent-workspace
 (:require ["react" :refer [useState useEffect]] [shell.ui-copy :as ui] [shell.bot-chat :as chat]
  ["../agent-directory.js" :refer [directoryRows directoryState]]
  ["../agent-ui-state.js" :refer [readAgentSelection chooseAgent subscribeAgentSelection]]))
(defn panel [bots presence catalog-sha stale? now locale]
 (let [[selection set-selection] (useState readAgentSelection) [query set-query] (useState "")
       [filter set-filter] (useState "scheduled") [limit set-limit] (useState 20)
       _ (useEffect (fn [] (subscribeAgentSelection set-selection)) #js [])
       result (js->clj (directoryRows (clj->js bots) (clj->js presence) catalog-sha
                    #js {:now now :stale stale? :filter filter :query query :limit limit :recent (.-recent selection)}) :keywordize-keys true)
       selected (some #(when (= (:id %) (.-botId selection)) %) bots)]
  [:div.agent-workspace
   [:section.agent-directory {:aria-label (ui/t locale :agentPicker)}
    [:h3 (ui/t locale :agentPicker)]
    [:div.agent-presence-counts
     [:span (ui/t locale :residentCount {:count (or (get-in result [:counts :resident]) (ui/t locale :unknown))})]
     [:span (ui/t locale :observedRunningCount {:count (get-in result [:counts :running])})]]
    [:label.soshiki-field [:span.sr-only (ui/t locale :search)]
     [:input {:type "search" :aria-label (ui/t locale :agentSearch) :placeholder (ui/t locale :agentSearch) :value query :on-change #(do (set-query (.. % -target -value)) (set-limit 20))}]]
    [:div.agent-filter-tabs {:aria-label (ui/t locale :status)}
     (for [[id label] [["scheduled" :scheduledAgents] ["running" :processingAgents] ["resident" :residentAgents] ["conversation" :conversationAgents] ["recent" :recentAgents] ["all" :all]]]
      ^{:key id} [:button.secondary {:type "button" :aria-pressed (= id filter) :on-click #(do (set-filter id) (set-limit 20))} (ui/t locale label)])]
    [:p.agent-result-count (ui/t locale :directoryShown {:shown (count (:rows result)) :total (:total result)})]
    (when (empty? (:rows result)) [:p.muted (ui/t locale (if (= filter "resident") :residentUnobserved :noAgentMatch))])
    [:ul.agent-picker-list
     (for [row (:rows result) :let [bot (:bot row)]] ^{:key (:id bot)}
      [:li [:button.agent-picker-row {:type "button" :aria-pressed (= (:id bot) (.-botId selection))
                                    :on-click #(chooseAgent (:id bot))}
       [:strong (:name bot)] [:span (ui/t locale (case (:state row) "responding" :responding "resident" :residentAgents "waiting" :scheduledAgents "held" :held "running" :processingAgents "unknown" :unknown :attention))]
       [:small (:repository bot)]]])]
    (when (< (count (:rows result)) (:total result)) [:button.secondary {:type "button" :on-click #(set-limit (+ limit 20))} (ui/t locale :showMore)])]
   [:section.agent-workspace-conversation {:aria-label (ui/t locale :conversation)}
    (if selected [:<> [:h3 (:name selected)] ^{:key (:id selected)} [:f> chat/panel selected locale]]
     [:div.fleet-empty [:span {:aria-hidden true} "◎"] [:strong (ui/t locale :selectAgent)]])]]))
