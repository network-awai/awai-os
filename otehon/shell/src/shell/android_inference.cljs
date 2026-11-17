(ns shell.android-inference
 (:require ["react" :refer [useState useEffect]]
           ["../android-inference.js" :refer [localInference]]))
(defn panel []
 (let [[prompt set-prompt] (useState "") [result set-result] (useState "")
       [status set-status] (useState "未確認") [busy set-busy] (useState false)
       refresh (fn [] (-> (.info localInference)
                          (.then (fn [info] (set-status (cond (not (.-installed info)) "Murakumo をインストールしてください"
                                                             (some-> info .-status .-loaded) "読み込み済み · CPU"
                                                             :else "モデルを読み込んでください"))))
                          (.catch (fn [_] (set-status "推論アプリを確認できません")))))
       send (fn [e] (.preventDefault e)
              (when (and (.-isTrusted (.-nativeEvent e)) (not busy) (not (empty? (.trim prompt))))
               (set-busy true) (set-status "生成を確認してください")
               (-> (.generate localInference #js {:prompt prompt :modality "text" :maxTokens 128})
                   (.then (fn [r] (set-result (.-text r)) (set-status "この端末で生成しました")))
                   (.catch (fn [_] (set-status "生成を完了できませんでした。許可とモデルを確認してください")))
                   (.finally #(set-busy false)))))]
  (useEffect (fn [] (refresh) js/undefined) #js [])
  [:main.chat.net-view.android-inference
   [:header [:div [:h1 "Murakumo"] [:p.muted "この端末で推論 · llama.cpp"]]]
   [:div.local-inference-grid
    [:section.local-inference-model [:h2 "モデル"] [:h3 "Qwen3 · 0.6B"]
     [:p {:role "status"} status]
     [:div.local-inference-actions
      [:button {:type "button" :on-click #(-> (.open localInference) (.catch (fn [_] (set-status "Murakumo を開けません"))))} "Murakumo を開く"]
      [:button {:type "button" :on-click refresh} "状態を確認"]]
     [:p.muted "対応：テキスト。画像・動画エンジンは未接続です。"]]
    [:section.local-inference-generation
     [:form {:on-submit send}
      [:h2 [:label {:html-for "local-inference-prompt"} "何を生成しますか？"]]
      [:textarea {:id "local-inference-prompt" :name "prompt" :required true :max-length 8192 :rows 5 :value prompt :on-change #(set-prompt (.. % -target -value))}]
      [:button {:type "submit" :disabled busy} (if busy "生成を確認中…" "生成する")]]
     [:h2 "結果"] [:output {:aria-live "polite"} result]]]]))
