(ns shell.fleet-goals)
(defn panel [scope on-open]
  (when-let [goal (:goal scope)]
    [:section.fleet-goal {:aria-label "CircleのGoalsと成果指標"}
     [:p.fleet-goal-eyebrow "GOAL · 成果目標案"]
     [:h4 (:title goal)]
     [:p.muted "Goal案 · 責任Roleの割当・観測期間・数値目標は未確定。達成度は未計測です。"]
     [:ul.fleet-key-results
      (for [kr (:keyResults goal)] ^{:key (:id kr)}
        [:li [:strong (:title kr)] [:p (str "未計測 · " (:unit kr) " · 目標未設定")]])]
     [:p.muted "観測値（Goalの達成率とは別）"]
     [:dl.fleet-goal-metrics
      [:div [:dt "所属Bot"] [:dd (get-in goal [:metrics :actors])]]
      [:div [:dt "設定済み"] [:dd (get-in goal [:metrics :configured])]]
      [:div [:dt "未有効"] [:dd (get-in goal [:metrics :held])]]
      [:div [:dt "Issue対応"] [:dd (str (get-in goal [:metrics :issueBound]) "/" (get-in goal [:metrics :actors]))]]]
     (when (= "stale" (get-in goal [:metrics :observation])) [:p.problem "観測が古いため、現在の稼働状態は未確認です。"])
     [:details [:summary (str "対応Linear Issue · " (count (:issueKeys goal)) "件")]
      [:div.fleet-issue-links
       (for [issue (:issueKeys goal)] ^{:key issue}
         [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} issue])]]
     (when on-open [:button.secondary {:type "button" :on-click on-open} "Circleを開く"])]))
