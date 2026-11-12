(ns shell.readiness-observation
 (:require ["react" :refer [useState useEffect useRef]] [awai.bot.observation :as observation]))
(def storage-key "otehon.soshiki.readiness-observation.v1")
(defn saved []
 (try (let [r (js->clj (js/JSON.parse (.getItem js/localStorage storage-key)) :keywordize-keys true)]
       (when (:valid? (observation/readiness-summary r (js/Date.now))) r))
      (catch :default _ nil)))
(defn panel []
 (let [[report set-report] (useState saved) [now set-now] (useState (js/Date.now))
       [error set-error] (useState nil) sequence (useRef 0)
       s (observation/readiness-summary report now)]
  (useEffect (fn [] (let [timer (js/setInterval #(set-now (js/Date.now)) 30000)]
                    (fn [] (js/clearInterval timer)))) #js [])
  [:section {:data-readiness-observation true}
   [:h2 "登録Botの準備確認"]
   [:label.soshiki-field [:span "Bot定期確認レポート"]
    [:input {:type "file" :accept ".json,application/json" :aria-label "Bot定期確認レポート"
      :on-change (fn [event]
       (when-let [file (aget (.. event -target -files) 0)]
        (let [id (inc (.-current sequence))]
         (set! (.-current sequence) id)
         (if (> (.-size file) 1048576) (set-error "1 MiBまでです。")
          (-> (.text file)
           (.then (fn [text]
            (when (= id (.-current sequence))
             (try (let [r (js->clj (js/JSON.parse text) :keywordize-keys true)]
               (if (:valid? (observation/readiness-summary r (js/Date.now)))
                (do (set-report r) (set-now (js/Date.now)) (set-error nil)
                 (try (.setItem js/localStorage storage-key text)
                  (catch :default _ (set-error "表示は更新しましたが保存できませんでした。"))))
                (set-error "形式を確認してください。前の表示を保持しています。")))
              (catch :default _ (set-error "レポートを読み取れませんでした。"))))))
           (.catch (fn [_] (set-error "読込みに失敗しました。"))))))))}]]
   (when error [:p.net-error {:role "alert"} error])
   (if-not (:valid? s) [:p.muted "定期確認レポートは未読込みです。"]
    [:<>
     [:p.muted (str "観測: " (:observedAt s) " · " (if (some? (:ageSeconds s)) (str (quot (:ageSeconds s) 60) "分前") "時刻不整合")
                    " · " (if (= "launchd" (:invocation s)) "定期workerの記録" "手動実行の記録"))]
     [:ul.soshiki-totals
      [:li [:strong (if (some? (:enabled s)) (:enabled s) "未確認")] [:span "定期確認が有効・Bot"]]
      [:li [:strong (if (some? (:completed s)) (:completed s) "不明")] [:span "最新の完了記録・件"]]]
     [:ul.soshiki-bots
      (for [job (:jobs s)] ^{:key (:botId job)}
       [:li [:strong (:name job)] [:span (str " · " (:intervalMinutes job) "分間隔")]
        [:p [:a {:href (str "https://linear.app/kotobalabs/issue/" (:issueId job))} (:issueId job)]
         (str " · " (:worker job) " · " (:state job))]
        (when-let [run (:lastRun job)]
         [:<>
          [:p (str (:provider run) " / " (:model run) " · " (:state run))]
          [:p.muted (str "入力 " (or (:inputTokens run) "不明") " / 出力 " (or (:outputTokens run) "不明") " tokens")]
          [:p.muted (str "Linear結果記録: " (if (:linearResultConfirmed run) "確認済" "未確認"))]])])]])
   [:p.muted "有効なのは公開情報での準備確認・Issue整理です。元ジョブのメール・Git変更・スクリプト実行は保留中です。この表示は読込み時のスナップショットで、自動同期・全Botの稼働率ではありません。"]]))
