(ns shell.fleet-activity
  (:require ["react" :refer [useState]] [shell.ui-copy :as ui]))
(defn fact [locale label value]
  [:div [:dt (ui/t locale label)] [:dd (or value (ui/t locale :unknown))]])
(defn job-card [job & [locale]]
  (let [run (:lastRun job)]
   [:article.fleet-activity-job
    [:div.fleet-card-heading
     [:strong (ui/t locale (case (:scope job) "readiness" :readiness "adapted" :adapted "original" :original :otherScope))]
     [:span.fleet-status {:data-state (if (:confirmed run) "waiting" "unknown")} (ui/t locale (if (:confirmed run) :confirmed :unconfirmed))]]
    [:dl.fleet-facts [fact locale :nextRun (ui/stamp locale (:nextSlot job))]
     [fact locale :model (when run (str (or (:provider run) (ui/t locale :unknown)) " / " (or (:model run) (ui/t locale :unknown))))]]
    (when-let [issue (:issueId job)] [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} issue])
    [:details.fleet-disclosure [:summary (ui/t locale :details)]
     [:dl.fleet-facts
      [fact locale :run (:id run)] [fact locale :owner (:owner job)]
      [fact locale :observed (ui/stamp locale (:sourceObservedAt job))]
      [fact locale :completed (ui/stamp locale (:completedAt run))]
      [fact locale :firstObserved (ui/stamp locale (:firstObservedAt run))]
      [fact locale :inputTokens (:inputTokens run)] [fact locale :outputTokens (:outputTokens run)]
      [fact locale :artifact (:artifactCid run)]
      (when-let [execution (:execution job)] [fact locale :heartbeat (str (:node execution) " · " (ui/stamp locale (:heartbeatAt execution)))])]]]))
(defn panel [selection on-select on-close on-details & [locale chat-component]]
  (let [[limit set-limit] (useState 20) [tab set-tab] (useState "activity") bot (when (= "bot" (:kind selection)) (first (:agents selection)))]
    [:aside.fleet-activity-panel {:aria-label (ui/t locale :inspector) :data-open (boolean selection) :data-tab tab}
     [:div.fleet-activity-heading [:h3 (ui/t locale :inspector)]
      (when selection [:button.secondary {:type "button" :on-click on-close :aria-label (ui/t locale :close)} "×"])]
     (if-not selection
       [:div.fleet-empty [:span {:aria-hidden true} "◎"] [:strong (ui/t locale :selectCircle)]]
       [:<>
        [:h4 (:label selection)]
        [:div.fleet-card-heading [:span (ui/t locale :agentCount {:count (:total selection)})]
         [:span.fleet-status {:data-state (get-in selection [:summary :state])} (ui/state-label locale (get-in selection [:summary :state]))]]
        [:dl.fleet-facts [fact locale :execution (if (pos? (get-in selection [:summary :executionObserved] 0))
          (ui/t locale :executionObserved {:count (get-in selection [:summary :executionObserved]) :total (:total selection)}) (ui/t locale :unknown))]]
        (when (and bot chat-component)
         [:div.fleet-inspector-tabs {:role "tablist" :aria-label (ui/t locale :inspector)}
          (for [[id label] [["activity" :activity] ["conversation" :conversation]]]
           ^{:key id} [:button.secondary {:type "button" :role "tab" :aria-selected (= tab id) :on-click #(set-tab id)} (ui/t locale label)])])
        (if (and bot chat-component (= tab "conversation"))
         [:f> chat-component bot locale]
         [:div.fleet-activity-scroll
          (if bot
           [:div
            [:dl.fleet-facts [fact locale :app (:repository bot)]]
            (when (empty? (:jobs bot)) [:span.fleet-status (ui/t locale :noJobs)])
            (for [job (:jobs bot)] ^{:key (:jobId job)} [job-card job locale])
            [:details.fleet-disclosure [:summary (ui/t locale :sourceSchedule {:count (count (:sourceJobs bot))})]
             (for [job (:sourceJobs bot)] ^{:key (:id job)} [:p (str (or (get-in job [:schedule :display]) (get-in job [:schedule :expr]) (get-in job [:schedule :minutes]) (ui/t locale :unassigned)) " · " (:timezone job))])]
            [:div.fleet-issue-links (for [issue (get-in bot [:linear :issues])] ^{:key issue} [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} issue])]
            [:button.secondary {:type "button" :on-click #(on-details (:name bot))} (ui/t locale :openDetails)]]
           [:<>
            [:ul.fleet-activity-agents
             (for [agent (take limit (:agents selection))] ^{:key (:id agent)}
              [:li [:button.secondary {:type "button" :on-click #(on-select (:id agent))}
                [:strong (:name agent)] [:span.fleet-status {:data-state (get-in agent [:activity :state])} (ui/state-label locale (get-in agent [:activity :state]))]]])]
            (when (< limit (:total selection)) [:button.secondary {:type "button" :on-click #(set-limit (+ limit 20))} (ui/t locale :moreAgents)])])
          [:h4 (ui/t locale :recentResults)]
          (if (empty? (:events selection)) [:span.fleet-status (ui/t locale :none)]
           [:ol.fleet-activity-events
            (for [event (:events selection)] ^{:key (str (:botId event) "/" (:jobId event) "/" (:runId event))}
             [:li [:div.fleet-card-heading [:button.secondary {:type "button" :on-click #(on-select (:botId event))} (:botName event)]
               [:span.fleet-status (ui/t locale (if (:confirmed event) :confirmed :unconfirmed))]]
              [:p (ui/stamp locale (:observedAt event))]
              [:details.fleet-disclosure [:summary (ui/t locale (if (:baseline event) :existingResult :details))]
               [:dl.fleet-facts [fact locale :run (:runId event)] [fact locale :model (str (or (:provider event) (ui/t locale :unknown)) " / " (or (:model event) (ui/t locale :unknown)))]]]])])])])]))
