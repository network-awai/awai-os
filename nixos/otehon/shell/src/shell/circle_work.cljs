(ns shell.circle-work (:require [shell.ui-copy :as ui]))
(defn panel [progress selected locale now]
 (let [ja? (= locale "ja") age (- now (js/Date.parse (:observedAt progress))) fresh? (and (>= age 0) (< age 45000))
       rows (filter #(or (nil? selected) (= "fleet" selected) (= selected (:id %)) (some (fn [c] (= selected (:botId c))) (:contributions %))) (:circles progress))]
  (when progress
   [:section.fleet-cooperation {:aria-label (if ja? "Goalへの活動" "Goal activity")}
    [:h3 (if ja? "Goalへの活動" "Goal activity")]
    [:span.fleet-status {:data-state (if fresh? "waiting" "unknown")} (if fresh? (if ja? "接続中" "Connected") (if ja? "更新待ち" "Awaiting update"))]
    (for [c rows] ^{:key (:id c)}
     [:article.agent-peer-cycle [:strong (:name c)]
      [:span (str (:completedProposals c) (if ja? " 成果案 · 本日 " " proposals · today ") (:todayProposals c) "/4")]
      (for [r (take 3 (:contributions c))] ^{:key (:runId r)}
       [:div [:span (:name r)] [:a {:href (str "https://linear.app/kotobalabs/issue/" (:issueId r)) :target "_blank" :rel "noreferrer"} (:issueId r)]
        [:time (ui/stamp locale (:completedAt r))]])])
    [:details.fleet-disclosure [:summary (if ja? "実行情報" "Execution details")]
     [:p (if ja? "新しい保存領域。過去の会話は未復元です。" "New state epoch. Legacy conversations are unavailable.")]
     [:p (if ja? "成果案の保存件数。Goal達成度は未計測です。" "Counts saved proposals. Goal outcomes are unmeasured.")]
     (for [r (get-in progress [:lastTick :results]) :when (not= "completed" (:state r))] ^{:key (:botId r)} [:p (str (:botId r) " · " (:state r))])]])))
