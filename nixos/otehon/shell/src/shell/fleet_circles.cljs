(ns shell.fleet-circles
  (:require [clojure.string :as str]
            ["react" :refer [useMemo useState]]
            ["../fleet-circles.js" :refer [circlePack]]))
(def states [[:waiting "定期待機" "#267c62"] [:queued "実行待ち" "#377bc0"]
             [:held "未有効" "#ae7323"] [:attention "要確認" "#c44343"] [:unknown "未確認" "#7b8190"]])
(defn panel [bots stale? query on-query on-details]
  (let [[focus-id set-focus] (useState "fleet") [selected-id set-selected] (useState nil)
        view (useMemo (fn [] (js->clj (circlePack (clj->js (vec bots)) #js {:stale stale? :query query}) :keywordize-keys true)) #js [bots stale? query])
        nodes (:nodes view) focus (or (first (filter #(= focus-id (:id %)) nodes)) (first nodes))
        selected (first (filter #(= selected-id (:id %)) nodes))
        size (+ 24 (* 2 (:radius focus))) scale (/ 1000 size)
        choose (fn [node] (set-selected (:id node)) (when-not (= "bot" (:kind node)) (set-focus (:id node))))]
    [:section.fleet-circle-view {:aria-label "CircleでBotの稼働を可視化"}
     [:h3 "Circle · 組織全体をひとつの図で"]
     [:p.muted "大きな円の中に組織、その中に登録CircleとBotを配置。濃淡は階層、Botの色は状態です。円を選ぶと拡大・詳細表示します。"]
     [:label.soshiki-field [:span "Circle / Bot / Appを検索して強調"]
      [:input {:type "search" :aria-label "CircleとBotを検索" :value query :on-change #(on-query (.. % -target -value))}]]
     [:div.fleet-circle-path
      [:button.secondary {:type "button" :on-click #(do (set-focus "fleet") (set-selected nil))} "全体を1 viewで見る"]
      (when (not= "fleet" (:id focus)) [:span (:label focus)])]
     [:ul.fleet-circle-legend (for [[state label color] states] ^{:key state} [:li [:span {:style {:background color} :aria-hidden true}] label])]
     [:p (str (:totalBots view) " Bot · " (:circleCount view) " Circle · " (:organizationCount view) " 組織グループ")]
     [:svg.fleet-circle-map {:viewBox (str (- (:x focus) (/ size 2)) " " (- (:y focus) (/ size 2)) " " size " " size)
                            :role "group" :aria-label "組織・Circle・全Botの入れ子マップ"}
      (for [node nodes]
        (let [bot? (= "bot" (:kind node))
              color (some (fn [[s _ c]] (when (= (name s) (:state node)) c)) states)
              desc (str (:label node) " · " (:count node) " Bot · "
                        (apply str (for [[s title _] states] (str title " " (get-in node [:counts s]) " "))))]
          ^{:key (:id node)}
          [:g.fleet-circle-node {:role "button" :tab-index 0 :aria-label desc
                                 :on-click #(choose node)
                                 :on-key-down (fn [e] (when (contains? #{"Enter" " "} (.-key e)) (.preventDefault e) (choose node)))}
           [:title desc]
           [:circle {:cx (:x node) :cy (:y node) :r (:radius node)
                     :class (str "fleet-pack-depth-" (:depth node) (when (= selected-id (:id node)) " fleet-pack-selected"))
                     :style {:fill (when bot? color) :opacity (if (and (seq query) (zero? (:matchCount node))) 0.18 1)}}]]))
      (for [node nodes
            :when (and (pos? (:depth node)) (> (* scale (:radius node)) 32)
                       (or (not= "bot" (:kind node)) (= (:parentId node) (:id focus))))]
        ^{:key (str "label-" (:id node))}
        [:text {:x (:x node) :y (if (= "bot" (:kind node)) (:y node) (+ (- (:y node) (:radius node)) (/ 18 scale)))
                :text-anchor "middle" :class "fleet-pack-label" :style {:font-size (/ 14 scale)}}
         (let [label (if (= "circle" (:kind node)) (last (str/split (:label node) #"/")) (:label node))]
           (if (> (count label) 25) (str (subs label 0 24) "…") label))])]
     [:p.muted (str "全" (:totalBots view) " Botを同時描画。各Botの小円は同じ重み。囲む円の面積は厳密な人数比ではありません。"
                    (when (seq query) " 検索は該当円を強調し、全体構造を保持します。")
                    (when stale? " 観測が古いため、設定済みBotは未確認で表示しています。"))]
     (when selected
       [:aside.fleet-circle-selection {:aria-label "選択したCircleの詳細"}
        [:strong (:label selected)]
        [:p (str (:count selected) " Bot · " (apply str (for [[s title _] states] (str title ": " (get-in selected [:counts s]) " "))))]
        (when (= "bot" (:kind selected))
          [:<> [:p (str "App: " (:repository selected))]
           [:p (for [issue (:issues selected)] ^{:key issue} [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} (str issue " ")])]
           [:button.secondary {:type "button" :on-click #(on-details (:label selected))} "App・実行記録を一覧で開く"]])])]))
