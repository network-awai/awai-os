(ns shell.fleet-activity
  (:require ["react" :refer [useState]]))
(defn stamp [v] (if v (.toLocaleString (js/Date. v) "ja-JP" #js {:timeZone "Asia/Tokyo"}) "未記録"))
(defn job-card [job]
  [:article.fleet-activity-job
   [:strong (:jobId job)]
   [:p (str (case (:scope job) "readiness" "準備確認" "adapted" "移植ジョブ" "original" "元ジョブ" "種別未確認") " · " (:state job))]
   [:p.muted (str "担当: " (or (:owner job) "未確認") " · 観測: " (stamp (:sourceObservedAt job)))]
   (when-let [execution (:execution job)]
     [:p (str "実行観測: " (:phase execution) " · " (:node execution) " · heartbeat " (stamp (:heartbeatAt execution)))])
   (if-let [run (:lastRun job)]
     [:<> [:p (str "最終run: " (:id run))]
      [:p (str "保存・Linear確認: " (if (:confirmed run) "確認済み" "未確認"))]
      [:p.muted (str "モデル: " (or (:provider run) "unknown") " / " (or (:model run) "unknown"))]
      [:p.muted (str "完了時刻: " (stamp (:completedAt run)) " · 結果初観測: " (stamp (:firstObservedAt run)))]
      [:p.muted (str "tokens in/out: " (if (some? (:inputTokens run)) (:inputTokens run) "unknown") " / " (if (some? (:outputTokens run)) (:outputTokens run) "unknown"))]
      (when-let [cid (:artifactCid run)] [:p.muted (str "保存CID: " cid)])]
     [:p.muted "実行結果は未観測です。"])
   [:p (str "次回: " (stamp (:nextSlot job)) " JST")]
   (when-let [issue (:issueId job)] [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} issue])])
(defn panel [selection on-select on-close on-details]
  (let [[limit set-limit] (useState 20)]
    [:aside.fleet-activity-panel {:aria-label "Agentの活動" :data-open (boolean selection)}
     [:div.fleet-activity-heading [:h3 "Agentの活動"]
      (when selection [:button.secondary {:type "button" :on-click on-close :aria-label "活動パネルを閉じる"} "閉じる"])]
     (if-not selection
       [:p.muted "Circle・Role・Botを選ぶと、所属Agentの活動と実行記録を表示します。"]
       [:<>
        [:h4 (:label selection)]
        [:p (str (:total selection) " Agent · " (get-in selection [:summary :label]))]
        [:p.muted "呼吸＝観測済みの待機、点滅＝実行待ち・要確認、パルス＝結果更新。回転には実行heartbeatが必要です。"]
        [:p.muted (str "実行heartbeatを観測: " (get-in selection [:summary :executionObserved]) " Agent。未観測のAgentの実行中状態は未確認です。")]
        [:div.fleet-activity-scroll
         (if (= "bot" (:kind selection))
           (let [bot (first (:agents selection))]
             [:div
              [:p (str "App: " (:repository bot))]
              [:p (str "状態: " (get-in bot [:activity :label]))]
              (when (empty? (:jobs bot)) [:p "有効なジョブの接続待ちです。"])
              (for [job (:jobs bot)] ^{:key (:jobId job)} [job-card job])
              [:details [:summary (str "元cron・interval · " (count (:sourceJobs bot)) "件")]
               (for [job (:sourceJobs bot)] ^{:key (:id job)}
                 [:p.muted (str (or (get-in job [:schedule :display]) (get-in job [:schedule :expr]) (get-in job [:schedule :minutes]) "未設定") " · " (:timezone job))])]
              [:p (for [issue (get-in bot [:linear :issues])] ^{:key issue}
                    [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} (str issue " ")])]
              [:button.secondary {:type "button" :on-click #(on-details (:name bot))} "App・実行詳細を開く"]])
           [:<>
            [:ul.fleet-activity-agents
             (for [bot (take limit (:agents selection))] ^{:key (:id bot)}
               [:li
                [:button.secondary {:type "button" :on-click #(on-select (:id bot))}
                 [:strong (:name bot)] [:span (get-in bot [:activity :label])]]
                [:p.muted (str "最終結果: " (if (some #(get-in % [:lastRun :confirmed]) (:jobs bot)) "確認済みあり" "未確認"))]])]
            (when (< limit (:total selection)) [:button.secondary {:type "button" :on-click #(set-limit (+ limit 20))} "さらに20 Agentを表示"])])
         [:h4 "最近観測した実行結果"]
         (if (empty? (:events selection)) [:p.muted "履歴は未記録です。結果の存在を実行中とは判定しません。"]
           [:ol.fleet-activity-events
            (for [event (:events selection)] ^{:key (str (:botId event) "/" (:jobId event) "/" (:runId event))}
              [:li [:button.secondary {:type "button" :on-click #(on-select (:botId event))} (:botName event)]
               [:p (str (if (:baseline event) "履歴開始時の既存結果" "結果を観測") " · " (stamp (:observedAt event)))]
               [:p.muted (:runId event)]
               [:p.muted (str (if (:confirmed event) "保存・Linear確認済み" "確認待ち") " · " (:provider event) " / " (:model event))]])])]
        [:p.muted "初観測時刻は実際の完了時刻ではありません。動きは表示用で、業務成功率を表しません。"]])]))
