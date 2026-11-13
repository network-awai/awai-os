(ns shell.fleet-circles
  (:require [clojure.string :as str]
            ["react" :refer [useEffect useMemo useState]]
            [shell.fleet-activity :as activity]
            ["../fleet-activity.js" :refer [activitySelection]]
            [shell.fleet-goals :as goals]
            [shell.fleet-org-editor :as org-editor]
            ["../fleet-organizations.js" :refer [blankOrganizations loadOrganizations changeOrganization saveOrganizations]]
            ["../fleet-circles.js" :refer [circlePack]]))
(def states [[:running "実行観測" "#2084d4"] [:recovering "復旧観測" "#8d63c7"] [:waiting "定期待機" "#267c62"] [:queued "実行待ち" "#377bc0"]
             [:held "未有効" "#ae7323"] [:attention "要確認" "#c44343"] [:unknown "未確認" "#7b8190"]])
(defn panel [bots stale? now query on-query on-details]
  (let [[focus-id set-focus] (useState "fleet") [grouping set-grouping] (useState "responsibility") [goals? set-goals] (useState false) [selected-id set-selected] (useState nil)
        [org-data set-org-data] (useState (fn [] (if (and (exists? js/window) (exists? js/localStorage)) (loadOrganizations (clj->js (vec bots)) js/localStorage) #js {:state (blankOrganizations) :error nil})))
        [message set-message] (useState nil) [reduced set-reduced] (useState true)
        change-org (fn [action]
                     (try (let [next (changeOrganization (.-state org-data) action (clj->js (vec bots)))]
                            (saveOrganizations next (clj->js (vec bots)) js/localStorage)
                            (set-org-data #js {:state next :error nil}) (set-message "組織と所属をこのブラウザーに保存しました。") true)
                          (catch :default error (set-message (.-message error)) false)))
        view (useMemo (fn [] (js->clj (circlePack (clj->js (vec bots)) #js {:stale stale? :query query :now now :grouping grouping :orgState (.-state org-data)}) :keywordize-keys true)) #js [bots stale? query now org-data grouping])
        nodes (:nodes view) focus (or (first (filter #(= focus-id (:id %)) nodes)) (first nodes))
        selected (first (filter #(= selected-id (:id %)) nodes))
        selection (js->clj (activitySelection (clj->js nodes) (clj->js (vec bots)) selected-id now stale?) :keywordize-keys true)
        responsibility? (= grouping "responsibility")
        visible-nodes (if responsibility? (filter #(and (or (= (:id %) (:id focus)) (some #{(:id focus)} (:ancestorIds %))) (<= (:depth %) (+ 2 (:depth focus))) (or (not= "bot" (:kind %)) (= (:parentId %) (:id focus)))) nodes) nodes)
        size (+ 24 (* 2 (:radius focus))) scale (/ 1000 size)
        choose (fn [node] (set-selected (:id node)) (when-not (= "bot" (:kind node)) (set-focus (:id node))))]
    (useEffect (fn [] (when (exists? js/window)
                       (let [media (.matchMedia js/window "(prefers-reduced-motion: reduce)") update (fn [] (set-reduced (.-matches media)))]
                         (update) (.addEventListener media "change" update)
                         (fn [] (.removeEventListener media "change" update))))) #js [])
    [:section.fleet-circle-view {:aria-label "CircleでBotの稼働を可視化"}
     [:h3 "Circle · 組織全体をひとつの図で"]
     [:p.muted "目的と責任でCircleを編成。円の中の円で全体を示し、Circleを開くとRole・Bot・元cronを確認できます。"]
     [:div.fleet-circle-path {:aria-label "Circleの分類"}
      (for [[mode title] [["responsibility" "責任Circle"] ["repository" "App・リポジトリ分類"]]]
        ^{:key mode} [:button.secondary {:type "button" :aria-pressed (= grouping mode)
          :on-click #(do (set-grouping mode) (set-focus "fleet") (set-selected nil))} title])
      [:button.secondary {:type "button" :aria-pressed goals? :on-click #(set-goals (not goals?))} "Goals一覧"]]
     [:label.soshiki-field [:span "Circle / Bot / Appを検索して強調"]
      [:input {:type "search" :aria-label "CircleとBotを検索" :value query :on-change #(on-query (.. % -target -value))}]]
     [:div.fleet-circle-path
      [:button.secondary {:type "button" :on-click #(do (set-focus "fleet") (set-selected nil))} "全体を1 viewで見る"]
      (when (not= "fleet" (:id focus)) [:span (:label focus)])]
     [:ul.fleet-circle-legend (for [[state label color] states] ^{:key state} [:li [:span {:style {:background color} :aria-hidden true}] label])]
     [:p (if responsibility?
           (str (:totalBots view) " Bot · " (:charterCount view) "責任Circleの編成 · 配置確認を含む（元" (:circleCount view) " repo分類を保持）")
           (str (:totalBots view) " Bot · " (:circleCount view) " repo Circle · " (:organizationCount view) " 組織グループ"))]
     [:div.fleet-workspace
      [:div.fleet-map-column
     (when responsibility?
       [:div.fleet-circle-index
        (for [node (filter #(and (= "responsibility" (:kind %)) (= (:parentId %) (:id focus))) nodes)]
          ^{:key (:id node)} [:button.secondary {:type "button" :on-click #(choose node)}
            [:strong (:label node)] [:span (str (:count node) " Bot")]])])
     [:svg.fleet-circle-map {:viewBox (str (- (:x focus) (/ size 2)) " " (- (:y focus) (/ size 2)) " " size " " size)
                            :role "group" :aria-label "組織・Circle・全Botの入れ子マップ"}
      (for [node visible-nodes]
        (let [bot? (= "bot" (:kind node))
              color (some (fn [[s _ c]] (when (= (name s) (:state node)) c)) states)
              desc (str (get-in node [:activity :label]) " · " (:label node) " · " (:count node) " Bot · "
                        (apply str (for [[s title _] states] (str title " " (get-in node [:counts s]) " "))))]
          ^{:key (:id node)}
          [:g.fleet-circle-node {:role "button" :tab-index 0 :aria-label desc
                                 :on-click #(choose node)
                                 :on-key-down (fn [e] (when (contains? #{"Enter" " "} (.-key e)) (.preventDefault e) (choose node)))}
           [:title desc]
           [:circle {:cx (:x node) :cy (:y node) :r (:radius node)
                     :class (str "fleet-pack-" (:kind node) " fleet-pack-depth-" (:depth node) (when (= selected-id (:id node)) " fleet-pack-selected"))
                     :style {:fill (if bot? color (str "color-mix(in srgb, var(--focus) " (min 52 (+ 5 (* 10 (:depth node)))) "%, var(--bg))")) :opacity (if (and (seq query) (zero? (:matchCount node))) 0.18 1)}}]
           (when (and responsibility? (not bot?) (pos? (:depth node)) (pos? (:count node)))
             [:g {:aria-hidden true :pointer-events "none"}
              (for [[i [state _ color]] (map-indexed vector states)
                    :let [portion (/ (get-in node [:counts state]) (:count node))
                          offset (/ (reduce + (for [[previous _ _] (take i states)] (get-in node [:counts previous]))) (:count node))
                          circumference (* 2 js/Math.PI (:radius node))]
                    :when (pos? portion)]
                ^{:key (name state)}
                [:circle {:cx (:x node) :cy (:y node) :r (:radius node) :fill "none" :stroke color
                          :stroke-width (/ 3 scale) :stroke-dasharray (str (* circumference portion) " " circumference)
                          :stroke-dashoffset (- (* circumference offset)) :transform (str "rotate(-90 " (:x node) " " (:y node) ")")}])])
           (when (and (not reduced) (not= "still" (get-in node [:activity :motion])))
             (let [motion (get-in node [:activity :motion]) rotating? (contains? #{"rotate" "recover"} motion)
                   tone (case motion "alert" "#c44343" "blink" "#377bc0" "recover" "#8d63c7" "rotate" "#2084d4" "#267c62")]
               [:g.fleet-activity-motion {:aria-hidden true :pointer-events "none" :data-motion motion}
                [:circle {:cx (:x node) :cy (:y node) :r (* 0.96 (:radius node)) :fill "none" :stroke tone
                          :stroke-width (/ (if bot? 2 3) scale) :opacity 0.7
                          :stroke-dasharray (when rotating? (str (* (:radius node) 0.9) " " (* (:radius node) 0.55)))}
                 (if rotating?
                   [:animateTransform {:attributeName "transform" :type "rotate"
                                       :from (str "0 " (:x node) " " (:y node)) :to (str "360 " (:x node) " " (:y node))
                                       :dur (if (= motion "recover") "4s" "2s") :repeatCount "indefinite"}]
                   [:animate {:attributeName "opacity" :values "0.2;0.9;0.2" :dur (if (= motion "breathe") "4s" "2s") :repeatCount "indefinite"}])]]))]))
      (for [node visible-nodes
            :when (and (pos? (:depth node)) (> (* scale (:radius node)) 32)
                       (or (= (:id node) (:id focus)) (= (:parentId node) (:id focus)) (and responsibility? (= 2 (:depth node)) (= "fleet" (:id focus)))))]
        ^{:key (str "label-" (:id node))}
        [:text {:x (:x node) :y (if (or (= "bot" (:kind node)) (and responsibility? (not-any? #(= (:parentId %) (:id node)) visible-nodes))) (- (:y node) (/ 8 scale)) (+ (- (:y node) (:radius node)) (/ 18 scale)))
                :text-anchor "middle" :class "fleet-pack-label" :style {:font-size (/ (if (contains? #{"organization" "responsibility"} (:kind node)) 24 22) scale)}}
         (let [label (if (= "circle" (:kind node)) (last (str/split (:label node) #"/")) (:label node))
               limit (max 4 (min 25 (js/Math.floor (/ (* 1.6 (:radius node) scale) (if responsibility? 24 15)))))]
           (if (> (count label) limit) (str (subs label 0 (dec limit)) "…") label))
         [:tspan {:x (:x node) :dy (/ 23 scale) :style {:font-size (/ 18 scale)}} (str (:count node) " Bot")]])]
     [:p.muted (str (if responsibility? "責任Circleは読みやすさを優先して配置。面積は人数比ではありません。Botの詳細は円を開くと表示します。" (str "全" (:totalBots view) " Botを同時描画。各Botの小円は同じ重み。囲む円の面積は厳密な人数比ではありません。"))
                    (when (seq query) " 検索は該当円を強調し、全体構造を保持します。")
                    (when stale? " 観測が古いため、設定済みBotは未確認で表示しています。"))]
     [:p.muted "呼吸は観測済みの待機、点滅は実行待ち・要確認、パルスは確認済み結果の更新です。実行中の回転は45秒以内のheartbeatがある場合だけ表示します。元cron・Linear期間Cycleは変更せず、観測切れと未有効は静止します。"]
     (when message [:p {:role "status"} message])
      (when-not responsibility? [:f> org-editor/panel nodes selected change-org (.-error org-data)])
     (when responsibility?
       [:<> [:f> goals/panel (or selected focus) nil]
        (when goals?
          [:div.fleet-goals-grid
           (for [node (filter #(and (= "responsibility" (:kind %)) (:purpose %)) nodes)]
             ^{:key (:id node)} [:f> goals/panel node #(choose node)] )])])
      ]
      ^{:key (or selected-id "unselected")}
      [:f> activity/panel selection
       (fn [id] (when-let [node (first (filter #(= id (:id %)) nodes))] (choose node)))
       #(set-selected nil) on-details]]]))
