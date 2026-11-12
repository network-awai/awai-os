(ns shell.execution-observation
 (:require ["react" :refer [useState useEffect useRef]] [awai.bot.observation :as observation]))
(def storage-key "otehon.soshiki.execution-observation.v1")
(defn saved []
 (try (let [r (js->clj (js/JSON.parse (.getItem js/localStorage storage-key)) :keywordize-keys true)]
        (when (:valid? (observation/summary r (js/Date.now))) r))
      (catch :default _ nil)))
(defn panel []
 (let [[report set-report] (useState saved) [now set-now] (useState (js/Date.now))
       [error set-error] (useState nil) sequence (useRef 0)
       s (observation/summary report now)]
  (useEffect (fn [] (let [timer (js/setInterval #(set-now (js/Date.now)) 30000)]
                     (fn [] (js/clearInterval timer)))) #js [])
  [:section {:data-execution-observation true}
   [:h2 "公開データの統合実行"]
   [:label.soshiki-field [:span "実行結果レポート"]
    [:input {:type "file" :accept ".json,application/json" :aria-label "実行結果レポート"
             :on-change (fn [event]
                          (when-let [file (aget (.. event -target -files) 0)]
                           (let [id (inc (.-current sequence))]
                            (set! (.-current sequence) id)
                            (if (> (.-size file) 1048576) (set-error "1 MiBまでです。")
                             (-> (.text file)
                                 (.then (fn [text]
                                          (when (= id (.-current sequence))
                                           (try (let [r (js->clj (js/JSON.parse text) :keywordize-keys true)]
                                                  (if (:valid? (observation/summary r (js/Date.now)))
                                                   (do (set-report r) (set-now (js/Date.now)) (set-error nil)
                                                       (try (.setItem js/localStorage storage-key text)
                                                            (catch :default _ (set-error "表示は更新しましたが保存できませんでした。"))))
                                                   (set-error "形式を確認してください。前の表示を保持しています。")))
                                                (catch :default _ (set-error "レポートを読み取れませんでした。"))))))
                                 (.catch (fn [_] (set-error "読込みに失敗しました。"))))))))}]]
   (when error [:p.net-error {:role "alert"} error])
   (if-not (:valid? s) [:p.muted "実行レポートは未読込みです。"]
    [:<>
     [:p.muted (str "観測: " (:observedAt s) " · " (if (some? (:ageSeconds s)) (str (quot (:ageSeconds s) 60) "分前") "時刻不整合")
                    " · 手動スナップショット")]
     (when (:future? s) [:p.net-error "観測時刻が未来のため、現在値として扱えません。"])
     [:ul.soshiki-totals
      [:li [:strong (if (some? (:healthy s)) (str (:healthy s) " / " (:total s)) "不明")] [:span "etcd応答確認・台"]]
      [:li [:strong (if (some? (:completed s)) (:completed s) "不明")] [:span "完了レシート・件"]]
      [:li [:strong (case (:recoveryNoReinvoke s) true "確認済" false "不成立" "未確認")] [:span "再推論なしの復旧試験"]]]
     (when (some? (:healthy s))
      [:div.meter {:role "progressbar" :aria-label "etcd応答確認台数"
                           :aria-valuemin 0 :aria-valuemax (:total s) :aria-valuenow (:healthy s)}
       [:span {:style {:width (str (* 100 (/ (:healthy s) (:total s))) "%")}}]])
     [:ul.soshiki-bots
      (for [run (:runs s)] ^{:key (:runId run)}
       [:li [:strong (:runId run)] [:span (str " · " (:state run))]
        [:p (str (:node run) " · " (:provider run) " / " (:model run) " · " (:issueId run))]
        [:p.muted (str "入力 " (or (:inputTokens run) "不明") " / 出力 " (or (:outputTokens run) "不明") " tokens")]])]
     [:p.muted (str "クォーラム喪失時の実行抑止: " (case (:quorumLossHeld s) true "確認済" false "不成立" "未確認"))]])
   [:p.muted "統合試験用profileの記録です。登録Bot群の稼働数には加算しません。継続監視・マシン再起動・停電からの復帰は未確認です。"]]))
