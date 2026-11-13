(ns shell.fleet-cooperation (:require [shell.ui-copy :as ui]))
(defn panel [cycles on-circle on-bot locale & [compact]]
 (when (seq cycles)
  [:section.fleet-cooperation {:aria-label (ui/t locale :cooperation)}
   (for [cycle cycles] ^{:key (:cycleKey cycle)}
    [:article.agent-peer-cycle {:data-peer-state (:state cycle)}
     [:div.fleet-card-heading [:strong (ui/t locale :goal)]
      [:span.fleet-status {:data-state (if (:live cycle) "running" "waiting")}
       (ui/t locale (if (:live cycle) :processingAgents (if (= "completed" (:state cycle)) :dialogueCompleted :unknown)))]]
     [:h4 (:goal cycle)]
     (when-not compact [:button.secondary {:type "button" :on-click #(on-circle (:circleId cycle))} (:circleLabel cycle)])
     [:div.fleet-peer-members
      (for [[i p] (map-indexed vector (:participants cycle))] ^{:key (:id p)}
       [:<> (when (pos? i) [:span {:aria-hidden true} "↔"])
        [:button.secondary {:type "button" :on-click #(on-bot (:id p)) :data-active (boolean (some #{(:id p)} (:active cycle)))}
         [:strong (:name p)] [:small (:role p)]]])]
     [:div.fleet-card-heading [:span (ui/t locale :peerProgress {:done (:completedTurns cycle) :total (:maxTurns cycle)})]
      [:a {:href (str "https://linear.app/kotobalabs/issue/" (:issueId cycle))} (:issueId cycle)]]
     [:ol.fleet-peer-turns {:aria-label (ui/t locale :peerDialogue)}
      (for [turn (:turns cycle)] ^{:key (:turn turn)}
       [:li [:button.secondary {:type "button" :on-click #(on-bot (:speaker turn))}
        [:span (if (= "completed" (:state turn)) "✓" "○")]
        [:span (str (inc (:turn turn)) " · " (:name (first (filter #(= (:speaker turn) (:id %)) (:participants cycle)))))]]])]])]))

(defn mission-detail [selected on-circle locale]
 (when selected
  [:article.fleet-mission-detail
   [:div.fleet-card-heading [:strong (ui/t locale :goal)] [:span.fleet-status (ui/t locale :plannedGoal)] [:a {:href (get-in selected [:linear :url])} (get-in selected [:linear :id])]]
   [:h4 (:summary selected)]
   [:span.fleet-status (ui/t locale :notMeasured)]
   [:div.fleet-mission-assignments
    (for [[id lead?] (cons [(:lead selected) true] (map #(vector % false) (:support selected)))] ^{:key id}
     [:button.secondary {:type "button" :on-click #(on-circle id)}
      [:small (ui/t locale (if lead? :leadCircle :supportCircle))] [:strong (get-in selected [:circleLabels (keyword id)] id)]])]]))
(defn missions-panel [missions selected on-select on-circle locale]
 [:section.fleet-missions {:aria-label (ui/t locale :goals)}
  [:div.fleet-mission-options
   (for [goal missions] ^{:key (:key goal)}
    [:button.secondary {:type "button" :aria-pressed (= (:key goal) (:key selected)) :on-click #(on-select goal)}
     [:small (get-in goal [:linear :id])] [:strong (:name goal)]])]])
