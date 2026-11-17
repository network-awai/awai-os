(ns shell.original-observation
 (:require ["react" :refer [useState useEffect useRef]] [awai.bot.observation :as o]))
(def storage-key "otehon.soshiki.original-observation.v1")
(defn saved []
 (try (let [r (js->clj (js/JSON.parse (.getItem js/localStorage storage-key)) :keywordize-keys true)]
        (when (:valid? (o/original-summary r (js/Date.now))) r))
      (catch :default _ nil)))
(defn panel []
 (let [[report set-report] (useState saved) [now set-now] (useState (js/Date.now))
       [error set-error] (useState nil) sequence (useRef 0) s (o/original-summary report now)]
  (useEffect (fn [] (let [timer (js/setInterval #(set-now (js/Date.now)) 30000)]
                    (fn [] (js/clearInterval timer)))) #js [])
  [:section {:data-original-observation true}
   [:h2 "元ジョブの実行記録"]
   [:label.soshiki-field [:span "元ジョブの観測レポート"]
    [:input {:type "file" :accept ".json,application/json" :aria-label "元ジョブの観測レポート"
     :on-change (fn [event]
      (when-let [file (aget (.. event -target -files) 0)]
       (let [id (inc (.-current sequence))]
        (set! (.-current sequence) id)
        (if (> (.-size file) 1048576) (set-error "1 MiBまでです。")
         (-> (.text file)
          (.then (fn [text]
           (when (= id (.-current sequence))
            (try (let [r (js->clj (js/JSON.parse text) :keywordize-keys true)]
              (if (:valid? (o/original-summary r (js/Date.now)))
               (do (set-report r) (set-now (js/Date.now)) (set-error nil)
                   (try (.setItem js/localStorage storage-key text)
                        (catch :default _ (set-error "表示を更新しましたが保存できませんでした。"))))
               (set-error "形式を確認してください。前の表示を保持しています。")))
             (catch :default _ (set-error "レポートを読み取れませんでした。"))))))
          (.catch (fn [_] (set-error "読込みに失敗しました。"))))))))}]]
   (when error [:p.net-error {:role "alert"} error])
   (if-not (:valid? s) [:p.muted "元ジョブのレポートは未読込みです。"]
    [:<>
     [:p.muted (str "観測: " (:observedAt s) " · " (if (some? (:ageSeconds s)) (str (quot (:ageSeconds s) 60) "分前") "時刻不整合"))]
     [:p (str "実行サービス: " (case (:serviceLoaded s) true "読込済" false "未読込" "未確認"))]
     [:ul.soshiki-totals [:li [:strong (if (some? (:completed s)) (:completed s) "不明")]
                         [:span (str "保存・Linear記録確認済 / 選択" (:selected s) "件")]]]
     [:ul.soshiki-bots
      (for [job (:jobs s) :let [run (or (:last-result job) job) domain (:domain-result run)]]
       ^{:key (:catalog-bot-id job)}
       [:li [:strong (:catalog-bot-id job)] [:span (str " · " (:state job))]
        [:p.muted (str "run: " (or (:run-id run) "未確認"))]
        [:p (str "保存読戻し: " (if (true? (get-in run [:artifact :readback])) "確認済" "未確認")
                  " · Linear: " (if (true? (:linear-result-confirmed run)) "確認済" "未確認"))]
        (when domain [:p.muted (str "metrics HTTP " (or (:metrics-http domain) (get-in domain [:proposals 0 :evidence :metrics-http]) "不明")
                  " · catalog HTTP " (or (:catalog-http domain) (get-in domain [:proposals 0 :evidence :catalog-http]) "不明"))])
        [:p.muted "deterministic · 推論なし · token計数は対象外"]])]])
   [:p.muted "実測・台帳・未投稿提案の記録です。登録完了やメール接続、全Botの稼働を示しません。読込み時のスナップショットで、自動同期はしません。"]]))
