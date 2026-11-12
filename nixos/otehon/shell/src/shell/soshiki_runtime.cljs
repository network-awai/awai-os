(ns shell.soshiki-runtime
  (:require ["react" :refer [useEffect useRef useState]]
            [shell.execution-observation :as execution]
            [shell.readiness-observation :as readiness]
            [shell.original-observation :as original]
            [shell.fleet-overview :as fleet]
            [reagent.dom.client :as rdom]
            ["../soshiki-runtime.js" :refer [RUNTIME_KEY runtimeView validateObservation]]
            ["../soshiki-fleet.js" :refer [importFleet]]
            ["../soshiki.js" :refer [blankState]]))

(defn- saved []
  (try (validateObservation (js/JSON.parse (.getItem js/localStorage RUNTIME_KEY)))
       (catch :default _ nil)))
(defn runtime-panel [state]
  (let [[observation set-observation] (useState saved)
        [now set-now] (useState (js/Date.now))
        [circle set-circle] (useState "all")
        [error set-error] (useState nil)
        seq-ref (useRef 0)
        view (runtimeView state observation now circle)]
    (useEffect (fn [] (let [t (js/setInterval #(set-now (js/Date.now)) 30000)]
                       (fn [] (js/clearInterval t)))) #js [])
    [:section {:data-runtime-status true}
     [:h2 "Botの稼働状況"]
     [:p "稼働状況は未確認です。登録・VM起動・CLIの存在だけでは稼働中と判定しません。"]
     [:f> readiness/panel]
     [:f> original/panel]
     [:f> execution/panel]
     [:label.soshiki-field [:span "ノード観測レポート"]
      [:input {:type "file" :accept ".json,application/json" :aria-label "ノード観測レポート"
               :on-change (fn [e]
                            (when-let [file (aget (.. e -target -files) 0)]
                              (let [id (inc (.-current seq-ref))]
                                (set! (.-current seq-ref) id)
                                (if (> (.-size file) 1048576)
                                  (set-error "レポートは1 MiBまでです。")
                                  (-> (.text file)
                                      (.then (fn [text]
                                               (when (= id (.-current seq-ref))
                                                 (try
                                                   (let [o (validateObservation (js/JSON.parse text))]
                                                     (set-observation o) (set-now (js/Date.now)) (set-error nil)
                                                     (try (.setItem js/localStorage RUNTIME_KEY text)
                                                          (catch :default _ (set-error "表示は更新しましたが保存できませんでした。"))))
                                                   (catch :default _ (set-error "形式が異なります。前の表示を保持しています。"))))))
                                      (.catch (fn [_] (set-error "読込みに失敗しました。"))))))))}]]
     (when error [:p.net-error {:role "alert"} error])
     [:p.muted (str "観測: " (or (.-observedAt view) "なし")
                    (when (some? (.-ageSeconds view)) (str " · " (quot (.-ageSeconds view) 60) "分前"))
                    " · 手動スナップショット（継続監視ではありません）")]
     (when (= "catalog-mismatch" (.-status view)) [:p.net-error "登録情報と観測の版が一致しません。ノード観測は表示していません。"])
     (when (= "future-observation" (.-status view)) [:p.net-error "観測時刻が未来です。現在の稼働証拠として扱えません。"])
     [:ul.soshiki-totals
      [:li [:strong (.-registered view)] [:span "登録Bot"]]
      [:li [:strong "不明"] [:span "稼働中"]]
      [:li [:strong "不明"] [:span "成功 / 失敗"]]
      [:li [:strong (.-unknown view)] [:span "選択内・未確認"]]]
     [:h3 "ノード上のコマンド確認"]
     [:ul.soshiki-bots
      (for [node (array-seq (.-nodes view))]
        ^{:key (.-node node)}
        [:li [:strong (.-node node)]
         (if (= "observed" (.-status node))
           [:span (str " · bb: " (if (.-bb (.-tools node)) "あり" "なし")
                       " · Muse: " (if (.-muse (.-tools node)) "あり" "なし")
                       " · Itonami: " (if (or (.-itonami (.-tools node)) (aget (.-tools node) "itonami-agent")) "あり" "なし"))]
           [:span " · 観測不能"])])]
     [:p.muted "BotごとのMuse認証・実行権限・cron接続は未確認です。統合実行のレポートを下に表示します。"]
     [:label.soshiki-field [:span "サークル"]
      [:select {:aria-label "稼働状況のサークル" :value circle :on-change #(set-circle (.. % -target -value))}
       [:option {:value "all"} "すべて"]
       (for [c (array-seq (.-circles state))] ^{:key (.-id c)} [:option {:value (.-id c)} (.-name c)])]]
     [:ul.soshiki-bots
      (for [bot (array-seq (.-bots view))]
        ^{:key (.-id bot)} [:li {:data-runtime-bot (.-id bot)}
                           [:strong (.-name bot)] [:span " · 稼働未確認"]
                           [:p.muted (str (or (.-project bot) "Linear未解決") " · Issue: " (or (.-issue bot) "未選択"))]
                           [:p.muted "担当ノード・モデル・最終run・永続化：未確認"]])]
     [:p.muted "この観測は実行許可を付与しません。"]]))

(defn preview []
  (let [[state set-state] (useState (blankState))
        [error set-error] (useState nil)]
    [:main.chat.net-view [:div.net-body.soshiki-body
     [:h1 "Soshiki · 稼働状況"]
     [:f> fleet/panel]
     [:label.soshiki-field [:span "登録カタログ（このプレビュー内だけに読込み）"]
      [:input {:type "file" :aria-label "登録カタログ" :accept ".json,application/json"
               :on-change (fn [event]
                            (when-let [file (aget (.. event -target -files) 0)]
                              (if (> (.-size file) 8388608) (set-error "8 MiBまでです。")
                                (-> (.text file)
                                    (.then (fn [text] (try (let [r (importFleet (blankState) (js/JSON.parse text))]
                                                            (if (.-error r) (set-error "登録形式を確認してください。")
                                                              (do (set-state (.-state r)) (set-error nil))))
                                                          (catch :default _ (set-error "登録形式を確認してください。")))))
                                    (.catch (fn [_] (set-error "読込みに失敗しました。")))))))}]]
     (when error [:p.net-error {:role "alert"} error])
     [:f> runtime-panel state]]]))
(defn init [] (rdom/render (rdom/create-root (.getElementById js/document "soshiki-runtime-root")) [:f> preview]))
