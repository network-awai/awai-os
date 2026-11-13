(ns shell.fleet-goals (:require [shell.ui-copy :as ui]))
(defn panel [scope on-open & [locale]]
  (when-let [goal (:goal scope)]
    [:section.fleet-goal {:aria-label (ui/t locale :goal)}
     [:div.fleet-card-heading [:span.fleet-goal-eyebrow (ui/t locale :goal)] [:span.fleet-status (ui/t locale :draft)]]
     [:h4 (:title goal)]
     [:span.fleet-status {:data-state "unknown"} (ui/t locale :notMeasured)]
     [:dl.fleet-goal-metrics
      (for [[key field] [[:actors :actors] [:configured :configured] [:held :held] [:issueBound :issueBound]]]
       ^{:key key} [:div [:dt (ui/t locale key)] [:dd (if (= field :issueBound) (str (get-in goal [:metrics field]) "/" (get-in goal [:metrics :actors])) (get-in goal [:metrics field]))]])]
     (when (= "stale" (get-in goal [:metrics :observation])) [:p.problem {:role "status"} (ui/t locale :stale)])
     [:details.fleet-disclosure [:summary (ui/t locale :resultIndicators)]
      [:ul.fleet-key-results
       (for [kr (:keyResults goal)] ^{:key (:id kr)}
        [:li [:strong (case (:id kr) "outcome" (ui/t locale :goalOutcome) "recovery" (ui/t locale :goalRecovery) (:title kr))]
         [:span.fleet-status (ui/t locale :notMeasured)]])]
      [:dl.fleet-facts (for [key [:goalOwner :goalPeriod :goalTarget]] ^{:key key} [:div [:dt (ui/t locale key)] [:dd (ui/t locale :unassigned)]])]]
     [:details.fleet-disclosure [:summary (ui/t locale :issueCount {:count (count (:issueKeys goal))})]
      [:div.fleet-issue-links (for [issue (:issueKeys goal)] ^{:key issue} [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} issue])]]
     (when on-open [:button.secondary {:type "button" :on-click on-open} (ui/t locale :openCircle)])]))
