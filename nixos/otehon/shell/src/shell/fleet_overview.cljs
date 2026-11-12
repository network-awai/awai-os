(ns shell.fleet-overview
 (:require [clojure.string :as str] ["react" :refer [useState useEffect]]
           ["../fleet-projection.js" :refer [decodeFleetEnvelope]]))
(def reasons {"linear-unresolved" "Linear対応の照合待ち" "unfinished-issue-required" "進行可能Issueの選択待ち"
 "no-source-schedule" "元スケジュールなし" "source-verification-required" "元定義の検証待ち"
 "source-disabled-or-paused" "元設定で停止中" "script-executor-review-required" "スクリプト実行器の審査待ち"
 "calendar-executor-required" "cron実行器の接続待ち" "timezone-required" "タイムゾーン未確定"
 "scoped-executor-and-grant-required" "実行器・接続・権限の接続待ち"})
(defn text [v] (if (nil? v) "未確認" (str v)))
(defn panel []
 (let [[report set-report] (useState nil) [error set-error] (useState nil)
       [query set-query] (useState "") [filter-state set-filter] (useState "all") [now set-now] (useState (js/Date.now))]
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
                           (.includes (.toLowerCase (str (:name %) " " (:repository %) " " (get-in % [:linear :project]))) q)) (:bots report))
        totals (:totals report)]
   [:section {:data-fleet-overview true}
    [:h2 "全BotとAppの対応・稼働状況"]
    [:p.muted "登録情報と定期workerの実行記録を自動統合します。App欄は担当リポジトリです。実サービスへの接続と権限は別に表示します。"]
    (when error [:p.net-error {:role "alert"} error])
    (if-not report [:p "統合レポートを読み込んでいます。配布されていない場合は未確認です。"]
     [:<>
      [:p {:role (when stale? "status")} (str "観測: " (:observedAt report) " · " (if stale? "更新が古いか時刻不整合" (str (quot age 1000) "秒前")) " · 30秒ごとに配布artifactを確認")]
      [:ul.soshiki-totals
       [:li [:strong (:registered totals)] [:span "登録Bot"]]
       [:li [:strong (:configured totals)] [:span "定期ジョブが設定済・Bot"]]
       [:li [:strong (:held totals)] [:span "未有効・Bot"]]
       [:li [:strong (if stale? "未確認" (:queued totals))] [:span "段階起動の実行待ち・Bot"]]
       [:li [:strong (if stale? "未確認" (:attention totals))] [:span "実行記録に要確認・Bot"]]
       [:li [:strong (:jobsConfigured totals)] [:span "設定済ジョブ（準備確認を含む）"]]
       [:li [:strong (:originalJobsConfigured totals)] [:span "元ジョブの設定済・件"]]
       [:li [:strong (:adaptedJobsConfigured totals)] [:span "Itonami移植ジョブ・件"]]]
      [:p (str "保存・Linear記録を確認した最新run: " (:confirmedRuns totals) " / " (:jobsConfigured totals) "設定ジョブ（累計実行数ではありません）")]
      [:progress {:aria-label "定期ジョブ設定済Bot数" :value (:configured totals) :max (:registered totals)}]
      [:p.muted "設定数は稼働率・業務成功率ではありません。準備確認は元業務の完了数に加えません。3分以上古い観測は現在の正常状態として扱いません。"]
      [:label.soshiki-field [:span "Bot / App / Projectを検索"]
       [:input {:type "search" :aria-label "BotとAppを検索" :value query :on-change #(set-query (.. % -target -value))}]]
      [:label.soshiki-field [:span "状態"] [:select {:aria-label "統合Bot状態" :value filter-state :on-change #(set-filter (.. % -target -value))}
       [:option {:value "all"} "すべて"] [:option {:value "queued"} "段階起動の実行待ち"] [:option {:value "waiting"} "定期待機"] [:option {:value "attention"} "要確認"] [:option {:value "held"} "未有効・保留"]]]
      [:p (str (count bots) "件を表示 / " (:registered totals) "Bot · " (:repositoryCircles totals) "担当リポジトリCircle")]
      [:ul.soshiki-bots
       (for [bot bots]
        ^{:key (:id bot)}
        [:li {:data-fleet-bot (:id bot)}
         [:strong (:name bot)] [:span (str " · " (if (and stale? (:configured bot)) "観測更新待ち" ({"queued" "段階起動の実行待ち" "waiting" "定期待機" "attention" "要確認" "held" "未有効・保留"} (:state bot))))]
         [:p (str "App/担当repo: " (:repository bot))]
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
           (when-let [m (get-in job [:lastRun :measurement])]
            [:p.muted (str "Otehon simulation: " (:status m) " · probe " (text (:count m)) "/" (text (:expected m))
                           " · Native tests: " (:nativeTests m) " · 実機操作: " (:actuation m))])
           (when (= "queued" (:state job)) [:p.muted "まだ実行していません。確認済みの実行器で最新の未実行予定を順次処理します。"])
           (when-let [slot (:nextSlot job)] [:p.muted (str "次回: " (.toLocaleString (js/Date. slot) "ja-JP" #js {:timeZone "Asia/Tokyo"}) " JST")])])
         [:details [:summary (str "元ジョブ " (count (:sourceJobs bot)) "件・保留条件")]
          (if (empty? (:sourceJobs bot)) [:p "元スケジュールなし・実行条件の確認待ち"]
           (for [job (:sourceJobs bot)] ^{:key (:id job)}
            [:p.muted (str (:name job) " · " (if (:enabled job) "有効" (clojure.string/join " / " (map #(get reasons % %) (:holds job)))))]))]])]])])))
