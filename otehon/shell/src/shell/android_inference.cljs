(ns shell.android-inference
 (:require ["react" :refer [useState useEffect]]
           ["../android-inference.js" :refer [localInference]]))
(defn panel []
 (let [[prompt set-prompt] (useState "") [result set-result] (useState "")
       [image set-image] (useState nil) [mode set-mode] (useState "text")
       [status set-status] (useState "未確認") [busy set-busy] (useState false)
       refresh (fn [] (-> (.info localInference)
                          (.then (fn [info] (set-status (cond (not (.-installed info)) "Murakumo をインストールしてください"
                                                             (= mode "image") (if (some-> info .-status .-image .-imported) "画像モデル取得済み · Vulkan" "画像モデルを配置してください")
                                                             (some-> info .-status .-loaded) "読み込み済み · CPU"
                                                             :else "モデルを読み込んでください"))))
                          (.catch (fn [_] (set-status "推論アプリを確認できません")))))
       send (fn [e] (.preventDefault e)
              (when (and (.-isTrusted (.-nativeEvent e)) (not busy) (not (empty? (.trim prompt))))
               (set-busy true) (set-status "生成を確認してください") (set-image nil)
               (-> (.generate localInference #js {:prompt prompt :modality mode :maxTokens 128})
                   (.then (fn [r] (if (= mode "image") (set-image r) (set-result (.-text r))) (set-status "この端末で生成しました")))
                   (.catch (fn [_] (set-status "生成を完了できませんでした。許可とモデルを確認してください")))
                   (.finally #(set-busy false)))))
       save (fn [e] (when (and (.-isTrusted (.-nativeEvent e)) image (not busy))
                      (set-busy true)
                      (-> (.saveImage localInference (.-imageId image))
                          (.then (fn [_] (set-status "Pictures/Awai に保存しました")))
                          (.catch (fn [_] (set-status "保存できませんでした。もう一度お試しください")))
                          (.finally #(set-busy false)))))]
  (useEffect (fn [] (refresh) js/undefined) #js [mode])
  [:main.chat.net-view.android-inference
   [:header [:div [:h1 "Murakumo"] [:p.muted "この端末で推論"]]]
   [:div.local-inference-grid
    [:section.local-inference-model [:h2 "モデル"]
     [:label {:html-for "local-inference-mode"} "生成するもの"]
     [:select {:id "local-inference-mode" :value mode :disabled busy :on-change #(do (set-mode (.. % -target -value)) (set-image nil) (set-result ""))}
      [:option {:value "text"} "テキスト"] [:option {:value "image"} "画像"]]
     [:h3 (if (= mode "image") "Qwen Image 2.1 Turbo · AD-Q2_K" "Qwen3 · 0.6B")]
     [:p {:role "status"} status]
     [:div.local-inference-actions
      [:button {:type "button" :on-click #(-> (.open localInference) (.catch (fn [_] (set-status "Murakumo を開けません"))))} "Murakumo を開く"]
      [:button {:type "button" :on-click refresh :disabled busy} "状態を確認"]]
     [:p.muted (if (= mode "image") "512 × 512 · この端末のみ" "テキスト · この端末のみ")]]
    [:section.local-inference-generation
     [:form {:on-submit send :aria-busy busy}
      [:h2 [:label {:html-for "local-inference-prompt"} "何を生成しますか？"]]
      [:textarea {:id "local-inference-prompt" :name "prompt" :required true :max-length 8192 :rows 5 :value prompt :disabled busy :on-change #(set-prompt (.. % -target -value))}]
      [:button {:type "submit" :disabled busy} (if busy "処理中…" "生成する")]]
     [:h2 "結果"]
     (if image [:figure.generated-image
                [:img {:src (.-dataUrl image) :alt (str "生成画像: " prompt) :width 512 :height 512 :style {:max-width "100%" :height "auto"}}]
                [:figcaption "Qwen Image 2.1 Turbo · 512 × 512"]
                [:button {:type "button" :data-save-image true :on-click save :disabled busy} "画像を保存"]]
         [:output {:aria-live "polite"} result])]]]))
