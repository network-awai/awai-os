(ns shell.fleet-overview
 (:require [clojure.string :as str] ["react" :refer [useState useEffect]]
           [shell.bot-chat :as bot-chat] [shell.agent-workspace :as workspace]
           ["../agent-directory.js" :refer [decodeAgentPresence directoryState]]
           [shell.fleet-circles :as circles] [shell.fleet-activity :as activity] [shell.ui-copy :as ui]
           ["../ui-copy.js" :refer [initialLocale saveLocale]]
           ["../fleet-projection.js" :refer [decodeFleetEnvelope]]))
(def groups {"source" :sourceGroup "solver" :solverGroup "executor" :executorGroup "schedule" :scheduleGroup "paused" :pausedGroup "mapping" :mappingGroup "event" :eventGroup})
(defn value-text [locale value] (if (nil? value) (ui/t locale :unknown) (str value)))
(defn metric [locale label value]
 [:li [:strong (value-text locale value)] [:span (ui/t locale label)]])
(defn panel [& [initial-view]]
 (let [[report set-report] (useState nil) [error set-error] (useState false) [locale set-locale] (useState initialLocale)
       [query set-query] (useState "") [view set-view] (useState (or initial-view "circle")) [presence set-presence] (useState nil) [filter-state set-filter] (useState "all") [group set-group] (useState "all") [now set-now] (useState (js/Date.now))]
  (useEffect
   (fn []
    (let [controller (js/AbortController.) busy (atom false) live (atom true)
          refresh (fn []
           (when-not @busy
            (reset! busy true)
            (-> (js/fetch "./fleet-state.json" #js {:cache "no-store" :credentials "omit" :redirect "error" :signal (.-signal controller)})
             (.then (fn [response] (if (.-ok response) (.json response) (throw (js/Error. "artifact unavailable")))))
             (.then #(decodeFleetEnvelope % js/crypto))
             (.then (fn [r] (when @live (set-report (js->clj r :keywordize-keys true)) (set-now (js/Date.now)) (set-error false))))
             (.catch (fn [_] (when @live (set-error true))))
             (.finally #(reset! busy false)))))
          clock (js/setInterval #(set-now (js/Date.now)) 5000)
          timer (js/setInterval refresh 30000)]
      (refresh)
      (fn [] (reset! live false) (.abort controller) (js/clearInterval timer) (js/clearInterval clock)))) #js [])
  (useEffect (fn [] (let [live (atom true) controller (js/AbortController.)
    refresh (fn [] (-> (js/fetch "./agent-presence.json" #js {:cache "no-store" :credentials "omit" :redirect "error" :signal (.-signal controller)})
      (.then #(if (.-ok %) (.json %) (throw (js/Error. "presence unavailable"))))
      (.then decodeAgentPresence) (.then #(when @live (set-presence (js->clj % :keywordize-keys true))))
      (.catch (fn [_] (when @live (set-presence nil)))))) timer (js/setInterval refresh 5000)]
    (refresh) (fn [] (reset! live false) (.abort controller) (js/clearInterval timer)))) #js [])
  (let [age (when report (- now (js/Date.parse (:observedAt report)))) stale? (or (nil? age) (< age 0) (> age 180000))
        all-bots (mapv (fn [bot] (let [d (directoryState (clj->js bot) (clj->js presence) (:catalogSha256 report) now stale?) observation (.-observation d)]
          (cond-> bot observation (assoc :agentPresence (js->clj observation :keywordize-keys true) :state "running" :cronState (:state bot))))) (:bots report))
        q (str/lower-case query)
        bots (filter #(and (or (= filter-state "all") (= filter-state (:state %)))
                           (or (= group "all") (and (not (:configured %)) (= group (get-in % [:stabilization :group]))))
                           (str/includes? (str/lower-case (str (:name %) " " (:repository %) " " (get-in % [:linear :project]) " " (get-in % [:stabilization :issueId]))) q)) all-bots)
        totals (:totals report)]
   [:section {:data-fleet-overview true :lang locale}
    [:div.fleet-overview-heading [:h2 (ui/t locale :title)]
     [:label.fleet-language [:span.sr-only (ui/t locale :language)]
      [:select {:aria-label (ui/t locale :language) :value locale :on-change #(set-locale (saveLocale (.. % -target -value)))}
       [:option {:value "ja"} "日本語"] [:option {:value "en"} "English"]]]]
    (when error [:p.net-error {:role "alert"} (ui/t locale :refreshFailed)])
    (if-not report [:p (ui/t locale :loading)]
     [:<>
      [:div.fleet-overview-toolbar
       [:div.fleet-circle-path {:aria-label (ui/t locale :title)}
        [:button.secondary {:type "button" :aria-pressed (= view "agents") :on-click #(set-view "agents")} (ui/t locale :agentsView)]
        [:button.secondary {:type "button" :aria-pressed (= view "circle") :on-click #(set-view "circle")} (ui/t locale :circleView)]
        [:button.secondary {:type "button" :aria-pressed (= view "list") :on-click #(set-view "list")} (ui/t locale :listView)]]
       [:span.fleet-status {:role (when stale? "status") :data-state (if stale? "unknown" "waiting") :title (ui/stamp locale (:observedAt report))}
        (ui/t locale (if stale? :stale :fresh))]]
      [:ul.soshiki-totals.fleet-primary-totals
       [metric locale :registered (:registered totals)] [metric locale :configured (:configured totals)]
       [metric locale :held (:held totals)] [metric locale :attention (when-not stale? (:attention totals))]]
      (when (= view "agents") [:f> workspace/panel all-bots presence (:catalogSha256 report) stale? now locale])
      (when (= view "circle")
       [:f> circles/panel all-bots stale? now query set-query
        (fn [name] (set-query name) (set-view "list")) locale bot-chat/panel])
      (when (= view "list")
       [:<>
        [:div.fleet-list-filters
         [:label.soshiki-field [:span (ui/t locale :search)] [:input {:type "search" :aria-label (ui/t locale :search) :placeholder (ui/t locale :searchPlaceholder) :value query :on-change #(set-query (.. % -target -value))}]]
         [:label.soshiki-field [:span (ui/t locale :holdingGroup)]
          [:select {:aria-label (ui/t locale :holdingGroup) :value group :on-change #(set-group (.. % -target -value))}
           [:option {:value "all"} (ui/t locale :all)]
           (for [g ["executor" "solver" "source" "schedule" "paused" "mapping" "event"]]
            ^{:key g} [:option {:value g} (str (ui/t locale (get groups g)) " · " (get-in report [:stabilization :groups (keyword g)] 0))])]]
         [:label.soshiki-field [:span (ui/t locale :status)]
          [:select {:aria-label (ui/t locale :status) :value filter-state :on-change #(set-filter (.. % -target -value))}
           [:option {:value "all"} (ui/t locale :all)]
           (for [state ["running" "recovering" "queued" "waiting" "attention" "held"]]
            ^{:key state} [:option {:value state} (ui/state-label locale state)])]]]
        [:p (ui/t locale :shownCount {:shown (count bots) :total (:registered totals)})]
        [:ul.soshiki-bots
         (for [bot bots] ^{:key (:id bot)}
          [:li {:data-fleet-bot (:id bot)}
           [:div.fleet-card-heading [:strong (:name bot)] [:span.fleet-status {:data-state (if (and stale? (:configured bot)) "unknown" (:state bot))} (ui/state-label locale (if (and stale? (:configured bot)) "unknown" (:state bot)))]]
           [:p (:repository bot)]
           [:div.fleet-issue-links (for [issue (get-in bot [:linear :issues])] ^{:key issue} [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} issue])]
           [:details.fleet-disclosure [:summary (ui/t locale :details)]
            (when-let [step (:stabilization bot)] [:a {:href (str "https://linear.app/kotobalabs/issue/" (:issueId step))} (str (:issueId step) " · " (ui/t locale (get groups (:group step))))])
            (when (seq (:holds bot)) [:dl.fleet-facts [activity/fact locale :holds (str/join " · " (map #(ui/hold-label locale %) (:holds bot))) ]])
            [:dl.fleet-facts [activity/fact locale :repositoryAccess (get-in bot [:app :repositoryConnection :state])]
             [activity/fact locale :service (get-in bot [:app :service])]
             (when (not= (:repository bot) (:sourceRepository bot)) [activity/fact locale :oldRepository (:sourceRepository bot)])]
            (for [job (:jobs bot)] ^{:key (:jobId job)} [activity/job-card job locale])
            [:details.fleet-disclosure [:summary (ui/t locale :sourceJobs {:count (count (:sourceJobs bot))})]
             (for [job (:sourceJobs bot)] ^{:key (:id job)} [:p (str (:name job) " · " (if (:enabled job) (ui/t locale :configured) (str/join " · " (map #(ui/hold-label locale %) (:holds job)))))])]]])]])
      [:details.fleet-disclosure.fleet-observation-details [:summary (ui/t locale :inspectObservation)]
       [:dl.fleet-facts [activity/fact locale :observed (ui/stamp locale (:observedAt report))]
        [activity/fact locale :configuredJobs (:jobsConfigured totals)] [activity/fact locale :vmJobs (:vmJobsConfigured totals)]
        [activity/fact locale :latestReceipts (when-not stale? (str (:confirmedRuns totals) "/" (:jobsConfigured totals))) ]
        [activity/fact locale :replicaCoverage (when-not stale? (str (:vmReplicasHealthy totals) "/" (:vmJobsConfigured totals))) ]
        [activity/fact locale :issueCoverage (str (get-in report [:stabilization :heldLinked]) "/" (:held totals))]
        [activity/fact locale :unknownSlo (ui/t locale :notMeasuredValue)]]]])])))
