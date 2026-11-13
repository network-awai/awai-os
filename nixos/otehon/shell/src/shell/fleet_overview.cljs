(ns shell.fleet-overview
 (:require [clojure.string :as str] ["react" :refer [useState useEffect]]
           [shell.fleet-circles :as circles]
           ["../fleet-projection.js" :refer [decodeFleetEnvelope]]))
(def reasons {"linear-unresolved" "Linear対応の照合待ち" "unfinished-issue-required" "進行可能Issueの選択待ち"
 "no-source-schedule" "元スケジュールなし" "source-verification-required" "元定義の検証待ち"
 "source-disabled-or-paused" "元設定で停止中" "script-executor-review-required" "スクリプト実行器の審査待ち"
 "calendar-executor-required" "cron実行器の接続待ち" "timezone-required" "タイムゾーン未確定"
 "scoped-executor-and-grant-required" "実行器・接続・権限の接続待ち"
 "no-source-jobs" "元cronジョブが空" "event-executor-and-owner-required" "event実行器・ownerの整備待ち"})
(def groups {"source" "固定ソース取得" "solver" "物理モデル・計算予算" "executor" "実行器・接続権限"
             "schedule" "起動時刻・条件" "paused" "明示停止を維持" "mapping" "App・Linear対応" "event" "常駐・event実行owner"})
(def next-actions {"source" "固定revisionの仕様と取得先を復旧" "solver" "元の物理仕様を保って計算量を資格化"
                   "executor" "元業務に沿う実行器・接続・狭い権限を接続" "schedule" "Bot別のevent・cron起動条件を確定"
                   "paused" "停止理由と再開条件を確認。元の停止設定を維持" "mapping" "元Appと進行可能なLinear課題を照合"
                   "event" "event入力・実行owner・重複防止を整備"})
(defn text [v] (if (nil? v) "未確認" (str v)))
(defn panel []
 (let [[report set-report] (useState nil) [error set-error] (useState nil)
       [query set-query] (useState "") [view set-view] (useState "circle") [filter-state set-filter] (useState "all") [group set-group] (useState "all") [now set-now] (useState (js/Date.now))]
  (useEffect
   (fn []
    (let [controller (js/AbortController.) busy (atom false) live (atom true)
          refresh (fn []
           (when-not @busy
            (reset! busy true)
            (-> (js/fetch "./fleet-state.json" #js {:cache "no-store" :credentials "omit" :redirect "error" :signal (.-signal controller)})
             (.then (fn [response] (if (.-ok response) (.json response) (throw (js/Error. "artifact unavailable")))))
             (.then #(decodeFleetEnvelope % js/crypto))
             (.then (fn [r] (when @live (set-report (js->clj r :keywordize-keys true)) (set-now (js/Date.now)) (set-error nil))))
             (.catch (fn [_] (when @live (set-error "自動更新を確認できません。前の表示を保持しています。"))))
             (.finally #(reset! busy false)))))
          timer (js/setInterval (fn [] (set-now (js/Date.now)) (refresh)) 30000)]
      (refresh)
      (fn [] (reset! live false) (.abort controller) (js/clearInterval timer)))) #js [])
  (let [age (when report (- now (js/Date.parse (:observedAt report)))) stale? (or (nil? age) (< age 0) (> age 180000))
        q (.toLowerCase query)
        bots (filter #(and (or (= filter-state "all") (= filter-state (:state %)))
                           (or (= group "all") (and (not (:configured %)) (= group (get-in % [:stabilization :group]))))
                           (.includes (.toLowerCase (str (:name %) " " (:repository %) " " (get-in % [:linear :project]) " " (get-in % [:stabilization :issueId]))) q)) (:bots report))
        totals (:totals report)]
   [:section {:data-fleet-overview true}
    [:h2 "全BotとAppの対応・稼働状況"]
    [:p.muted "登録情報と定期workerの実行記録を自動統合します。App欄は担当リポジトリです。実サービスへの接続と権限は別に表示します。"]
    (when error [:p.net-error {:role "alert"} error])
    (if-not report [:p "統合レポートを読み込んでいます。配布されていない場合は未確認です。"]
     [:<>
      [:p {:role (when stale? "status")} (str "観測: " (:observedAt report) " · " (if stale? "更新が古いか時刻不整合" (str (quot age 1000) "秒前")) " · 30秒ごとに配布artifactを確認")]
      [:div.fleet-circle-path {:aria-label "稼働状況の表示方法"}
       [:button.secondary {:type "button" :aria-pressed (= view "circle") :on-click #(set-view "circle")} "Circle表示"]
       [:button.secondary {:type "button" :aria-pressed (= view "list") :on-click #(set-view "list")} "一覧・実行詳細"]]
      (when (= view "circle")
        [:f> circles/panel (:bots report) stale? now query set-query
         (fn [name] (set-query name) (set-view "list"))])
      [:ul.soshiki-totals
       [:li [:strong (:registered totals)] [:span "登録Bot"]]
       [:li [:strong (:configured totals)] [:span "定期ジョブが設定済・Bot"]]
       [:li [:strong (:held totals)] [:span "未有効・Bot"]]
       [:li [:strong (if stale? "未確認" (:queued totals))] [:span "段階起動の実行待ち・Bot"]]
       [:li [:strong (if stale? "未確認" (:attention totals))] [:span "実行記録に要確認・Bot"]]
       [:li [:strong (:jobsConfigured totals)] [:span "設定済ジョブ（準備確認を含む）"]]
       [:li [:strong (:originalJobsConfigured totals)] [:span "元ジョブの設定済・件"]]
       [:li [:strong (:adaptedJobsConfigured totals)] [:span "Itonami移植ジョブ・件"]]
       [:li [:strong (:vmJobsConfigured totals)] [:span "Awai VM実行ジョブ"]]
       [:li [:strong (if stale? "未確認" (:vmReplicasHealthy totals))] [:span "2VMの保存読戻し確認・ジョブ"]]]
      [:p (str "保存・Linear記録を確認した最新run: " (if stale? "未確認" (:confirmedRuns totals)) " / " (:jobsConfigured totals) "設定ジョブ（累計実行数ではありません）")]
      [:progress {:aria-label "定期ジョブ設定済Bot数" :value (:configured totals) :max (:registered totals)}]
      [:p.muted "設定数は稼働率・業務成功率ではありません。準備確認は元業務の完了数に加えません。3分以上古い観測は現在の正常状態として扱いません。"]
      [:section {:aria-label "保存と観測の確認状況"}
       [:p (str "保存・Linear確認: " (if stale? "未確認" (str (:confirmedRuns totals) "/" (:jobsConfigured totals))))]
       (when-not stale? [:progress {:aria-label "保存とLinear確認済ジョブ数" :value (:confirmedRuns totals) :max (max 1 (:jobsConfigured totals))}])
       [:p (str "現在のVM複製読戻し: " (if stale? "未確認" (str (:vmReplicasHealthy totals) "/" (:vmJobsConfigured totals) "ジョブ・各2VM")))]
       (when-not stale? [:progress {:aria-label "2VM複製を確認したジョブ数" :value (:vmReplicasHealthy totals) :max (max 1 (:vmJobsConfigured totals))}])
       [:p (str "安定化課題への対応: " (text (get-in report [:stabilization :heldLinked])) "/" (:held totals) "未有効Bot")]
       [:p.muted "保存確認の割合とVM複製の読戻しです。稼働時間のSLO・元業務の成功率は未計測です。"]]
      [:label.soshiki-field [:span "未有効Botの担当群"]
       [:select {:aria-label "安定化課題で絞り込み" :value group :on-change #(set-group (.. % -target -value))}
        [:option {:value "all"} "すべて"]
        (for [g ["executor" "solver" "source" "schedule" "paused" "mapping" "event"]]
         ^{:key g} [:option {:value g} (str (get groups g) " · " (or (get-in report [:stabilization :groups (keyword g)]) 0) " Bot")])]]
      [:label.soshiki-field [:span "Bot / App / Projectを検索"]
       [:input {:type "search" :aria-label "BotとAppを検索" :value query :on-change #(set-query (.. % -target -value))}]]
      [:label.soshiki-field [:span "状態"] [:select {:aria-label "統合Bot状態" :value filter-state :on-change #(set-filter (.. % -target -value))}
       [:option {:value "all"} "すべて"] [:option {:value "queued"} "段階起動の実行待ち"] [:option {:value "waiting"} "定期待機"] [:option {:value "attention"} "要確認"] [:option {:value "held"} "未有効・保留"]]]
      [:p (str (count bots) "件を表示 / " (:registered totals) "Bot · " (:repositoryCircles totals) "担当リポジトリCircle")]
      [:ul.soshiki-bots {:style {:display (when (= view "circle") "none")}}
       (for [bot bots]
        ^{:key (:id bot)}
        [:li {:data-fleet-bot (:id bot)}
         [:strong (:name bot)] [:span (str " · " (if (and stale? (:configured bot)) "観測更新待ち" ({"queued" "段階起動の実行待ち" "waiting" "定期待機" "attention" "要確認" "held" "未有効・保留"} (:state bot))))]
         [:p (str "App/担当repo: " (:repository bot))]
         (when-let [step (:stabilization bot)]
          [:div {:data-stabilization (:issueId step)}
           [:p [:a {:href (str "https://linear.app/kotobalabs/issue/" (:issueId step))} (str "安定化: " (:issueId step))]
            (str " · " (get groups (:group step))) ]
           [:p.muted (str "次の対応: " (get next-actions (:group step)))]] )
         (when (and (not (:configured bot)) (seq (:holds bot)))
          [:p (str "保留理由: " (str/join " / " (map #(get reasons % %) (:holds bot))))])
         [:p.muted (str "GitHub接続確認: " (get-in bot [:app :repositoryConnection :state]) "（運用者の参照確認・Bot権限とは別）")]
         (when (not= (:repository bot) (:sourceRepository bot)) [:p.muted (str "旧repo: " (:sourceRepository bot))])
         [:p.muted (str "実サービス: " (or (get-in bot [:app :service]) "未接続") " · " (get-in bot [:app :contractState]))]
         (when-let [plan (:physicsRollout bot)]
          [:p.muted (str "共通physics移植判定: " (:state plan)
                         (when (:reason plan) (str " · " ({"source-unavailable" "pinned仕様を取得できず保留"
                          "scope-or-solver-budget-unqualified" "仕様・物理モデル・計算量の条件が未適合"} (:reason plan) (:reason plan)))))])
         [:p (for [issue (get-in bot [:linear :issues])] ^{:key issue} [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} (str issue " ")])]
         (for [job (:jobs bot)] ^{:key (:jobId job)}
          [:div [:p (str (case (:scope job) "original" "元ジョブ" "adapted" "Itonami移植ジョブ" "準備確認") " · " (:state job) " · " (:owner job))]
           (when (:adaptation job) [:p.muted (str "移植範囲: " (:adaptation job))])
           [:p.muted (str "権限: " (clojure.string/join ", " (:capabilities job)))]
           [:p.muted (str "最終run: " (or (get-in job [:lastRun :id]) "未確認") " · 記録確認: " (if (get-in job [:lastRun :confirmed]) "済" "未確認"))]
           (when-let [run (:lastRun job)] [:p.muted (str "実行モデル: " (:provider run) " / " (:model run))])
           (when-let [audit (get-in job [:lastRun :manifestAudit])]
            [:p.muted (str "Itonami構成観測: " (:status audit) " · ダイジェストの変化: "
                           (case (:drift audit) true "検出" false "なし" "未確認"))])
           (when-let [m (get-in job [:lastRun :measurement])]
            [:p.muted (str "Otehon simulation: " (:status m) " · probe " (text (:count m)) "/" (text (:expected m))
                           " · Native tests: " (:nativeTests m) " · 実機操作: " (:actuation m))])
           (when-let [node (get-in job [:lastRun :measurement :computeNode])]
            [:p.muted (str "実行VM: " node " · 複製VM: " (get-in job [:lastRun :measurement :replicaNode])
                           " · 現在の保存読戻し: " (if stale? "未確認" (text (:currentReplicas job))) "/2")])
           (when (= "queued" (:state job)) [:p.muted "まだ実行していません。確認済みの実行器で最新の未実行予定を順次処理します。"])
           (when-let [slot (:nextSlot job)] [:p.muted (str "次回: " (.toLocaleString (js/Date. slot) "ja-JP" #js {:timeZone "Asia/Tokyo"}) " JST")])])
         [:details [:summary (str "元ジョブ " (count (:sourceJobs bot)) "件・保留条件")]
          (if (empty? (:sourceJobs bot)) [:p "元スケジュールなし・実行条件の確認待ち"]
           (for [job (:sourceJobs bot)] ^{:key (:id job)}
            [:p.muted (str (:name job) " · " (if (:enabled job) "有効" (clojure.string/join " / " (map #(get reasons % %) (:holds job)))))]))]])]])])))
