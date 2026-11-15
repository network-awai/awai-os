(ns shell.reliability
  (:require ["react" :refer [useEffect useRef useState]]
            [reagent.dom.client :as rdom]
            [awai.fs.reliability :as reliability]))

(def storage-key "otehon.fs-reliability.v1")
(defn- read-saved []
  (try
    (let [raw (.getItem js/localStorage storage-key)
          e (when raw (js->clj (js/JSON.parse raw) :keywordize-keys true))]
      (when (:valid? (reliability/summary e (js/Date.now))) e))
    (catch :default _ nil)))

(defn- time-text [value]
  (if (reliability/timestamp-ms value)
    (.toLocaleString (js/Date. value) "ja-JP" #js {:timeZone "Asia/Tokyo" :hour12 false})
    "不明"))

(defn meter [{:keys [label value total unit scope observed-at]}]
  [:section.fs-stat
   [:h3 label]
   [:div.fs-stat-value (if (some? value) (str value " / " total " " unit) "未計測")]
   (if (some? value)
     [:div.fs-track {:role "progressbar" :aria-label (str label "・" scope)
                    :aria-valuemin 0 :aria-valuemax total :aria-valuenow value}
      [:span {:style {:width (str (* 100 (/ value total)) "%")}}]]
     [:div.fs-track.fs-unknown {:role "img" :aria-label (str label "は未計測")}])
   [:p.muted scope]
   (when observed-at [:p.muted (str (time-text observed-at) " JST")])])

(defn reliability-view []
  (let [[evidence set-evidence] (useState read-saved)
        [now set-now] (useState (js/Date.now))
        [error set-error] (useState nil)
        seq-ref (useRef 0)
        s (reliability/summary evidence now)]
    (useEffect (fn [] (let [timer (js/setInterval #(set-now (js/Date.now)) 30000)]
                       (fn [] (js/clearInterval timer)))) #js [])
    [:section.fs-reliability {:data-fs-reliability true}
     [:header
      [:p.muted "Awai FS · 永続化の観測"]
      [:h1 "信頼性"]
      [:p.fs-verdict (if (:valid? s) (:verdict s) "本番信頼性は未判定")]]
     [:div.fs-summary
      [:div.fs-overall {:role "img" :aria-label "本番の信頼性の百分率は未計測"}
       [:svg {:viewBox "0 0 200 112" :aria-hidden true}
        [:path {:d "M 18 100 A 82 82 0 0 1 182 100" :fill "none"
                :stroke "var(--surface-selected)" :stroke-width 12}]]
       [:strong "未計測"]
       [:span "本番の稼働率・耐久性"]]
      [:div
       [:p "成功確率を示す総合スコアは、継続監視の証拠が揃うまで算出しません。"]
       (when (:valid? s)
         [:p.fs-time (str "保存コピーの確認: " (time-text (:observed-at s)) " JST")])
       (when (some? (:age-seconds s))
         [:p.muted (str "確認から " (quot (:age-seconds s) 60) " 分。継続監視ではありません。")])
       (when (= "clock-inconsistent" (:freshness s))
         [:p.net-error "観測時刻が未来のため、コピー数は現在値として扱えません。"])
       [:p.muted "公開テストデータの記録です。個人データやマウント全体の健全性を保証する表示ではありません。"]]]
     [:label.fs-import "確認レポートを読み込む"
      [:input {:type "file" :accept ".json,application/json" :aria-label "信頼性の確認レポート"
               :on-change
               (fn [event]
                 (when-let [file (aget (.. event -target -files) 0)]
                   (let [id (inc (.-current seq-ref))]
                     (set! (.-current seq-ref) id)
                     (if (> (.-size file) 1048576)
                       (set-error "レポートは1 MiBまでです。")
                       (-> (.text file)
                           (.then (fn [text]
                                    (when (= id (.-current seq-ref))
                                      (try
                                        (let [e (js->clj (js/JSON.parse text) :keywordize-keys true)]
                                          (if (:valid? (reliability/summary e (js/Date.now)))
                                            (do (set-evidence e) (set-now (js/Date.now)) (set-error nil)
                                                (try (.setItem js/localStorage storage-key text)
                                                     (catch :default _ (set-error "表示は更新しましたが保存できませんでした。"))))
                                            (set-error "レポートを確認してください。前の表示は保持しています。")))
                                        (catch :default _ (set-error "レポートを読み取れませんでした。"))))))
                           (.catch (fn [_] (set-error "ファイルを読み込めませんでした。"))))))))}]]
     (when error [:p.net-error {:role "alert"} error])
     [:h2 "確認できていること"]
     [:div.fs-grid
      (if (:valid? s)
        (for [m (:metrics s)] ^{:key (:id m)} [meter m])
        [meter {:label "読取り確認済みコピー" :scope "確認レポートなし"}])]
     (when (:valid? s)
       [:div
        [:ul.fs-nodes
         (for [{:keys [node state]} (:nodes s)]
           ^{:key node} [:li [:strong node] [:span (get {"verified" "内容一致" "mismatch" "不一致" "unknown" "未確認"} state)]])]
        [:details [:summary "確認対象のデータ"]
         [:p "公開データ " (get-in s [:dataset :bytes]) " bytes"]
         [:code.fs-cid (get-in s [:dataset :rootCid])]]])
     [:h2 "本番で未計測の項目"]
     [:div.fs-grid
      (for [label ["本番稼働率" "RPO（許容するデータ損失時間）" "RTO（復旧所要時間）" "同期遅延" "実ノード停止時の耐性"]]
        ^{:key label} [meter {:label label :scope "測定窓・障害試験の証拠なし"}])]
     [:p.fs-footnote "ゲージは確認件数です。2 / 2 台や1 / 1 回を、本番の信頼性100%と解釈しないでください。"]]))

(defn init []
  (rdom/render (rdom/create-root (.getElementById js/document "fs-reliability-root"))
               [:f> reliability-view]))
