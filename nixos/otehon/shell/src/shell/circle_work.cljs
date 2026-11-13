(ns shell.circle-work (:require [shell.ui-copy :as ui]))
(defn panel [progress selected locale now on-bot]
 (let [ja? (= locale "ja") age (- now (js/Date.parse (:observedAt progress))) fresh? (and (>= age 0) (< age 45000))
       rows (filter #(or (nil? selected) (= "fleet" selected) (= selected (:id %)) (some (fn [c] (= selected (:botId c))) (:contributions %))) (:circles progress))]
  (when progress
   [:section.fleet-cooperation {:aria-label (ui/t locale :goalActivity)}
    [:h3 (ui/t locale :goalActivity)]
    [:span.fleet-status {:data-state (if fresh? "waiting" "unknown")} (if fresh? (ui/t locale :controllerConnected) (ui/t locale :stale))]
    (for [c rows] ^{:key (:id c)}
     [:article.agent-peer-cycle [:strong (:name c)]
      [:span (ui/t locale :proposalToday {:count (:completedProposals c) :today (:todayProposals c)})]
      (for [r (take 3 (:contributions c))] ^{:key (:runId r)}
       [:div [:button.secondary {:type "button" :on-click #(on-bot (:botId r))} (:name r)] [:a {:href (str "https://linear.app/kotobalabs/issue/" (:issueId r)) :target "_blank" :rel "noreferrer"} (:issueId r)]
        [:time (ui/stamp locale (:completedAt r))]])])
    [:details.fleet-disclosure [:summary (ui/t locale :executionDetails)]
     [:p (ui/t locale :newStateHistory)]
     [:p (ui/t locale :proposalNotOutcome)]
     (for [r (get-in progress [:lastTick :results]) :when (not= "completed" (:state r))] ^{:key (:botId r)} [:p (str (:botId r) " · " (:state r))])]])))
