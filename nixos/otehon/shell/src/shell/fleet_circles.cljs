(ns shell.fleet-circles
  (:require [clojure.string :as str]
            ["react" :refer [useEffect useMemo useState]]
            [shell.fleet-goals :as goals]
            [shell.fleet-org-editor :as org-editor]
            ["../fleet-organizations.js" :refer [blankOrganizations loadOrganizations changeOrganization saveOrganizations]]
            ["../fleet-circles.js" :refer [circlePack]]))
(def states [[:waiting "定期待機" "#267c62"] [:queued "実行待ち" "#377bc0"]
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
              desc (str (:label node) " · " (:count node) " Bot · "
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
           (when (and bot? (get-in node [:cycle :animated]) (not reduced))
             [:g.fleet-cycle-orbit {:aria-hidden true :pointer-events "none"}
              [:line {:x1 (:x node) :y1 (:y node) :x2 (:x node) :y2 (- (:y node) (* 0.8 (:radius node))) :stroke "var(--bg)" :stroke-width 0.7}]
              [:animateTransform {:attributeName "transform" :type "rotate"
                                  :from (str (* 360 (or (get-in node [:cycle :phase]) 0)) " " (:x node) " " (:y node))
                                  :to (str (+ 360 (* 360 (or (get-in node [:cycle :phase]) 0))) " " (:x node) " " (:y node))
                                  :dur "12s" :repeatCount "indefinite"}]])]))
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
     [:p.muted "Botのcycleは元のcron・interval周期です。回転は12秒で1周する早送り表示で、実行中の意味ではありません。未有効・周期未確定・観測切れは静止し、動きを減らす設定にも従います。Linearの期間Cycleは変更しません。"]
     (when message [:p {:role "status"} message])
      (when-not responsibility? [:f> org-editor/panel nodes selected change-org (.-error org-data)])
     (when responsibility?
       [:<> [:f> goals/panel (or selected focus) nil]
        (when goals?
          [:div.fleet-goals-grid
           (for [node (filter #(and (= "responsibility" (:kind %)) (:purpose %)) nodes)]
             ^{:key (:id node)} [:f> goals/panel node #(choose node)] )])])
     (when selected
       [:aside.fleet-circle-selection {:aria-label "選択したCircleの詳細"}
        [:strong (:label selected)]
        [:p (str (:count selected) " Bot · " (apply str (for [[s title _] states] (str title ": " (get-in selected [:counts s]) " "))))]
        (when-let [issue (:linearIssue selected)] [:p [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} (str "対応Linear Issue: " issue)]])
        (when (= "bot" (:kind selected))
          [:<> [:p (str "App: " (:repository selected))]
           [:p (str "Linear Project: " (:linearProject selected))]
           [:p (str "cron cycle: " (or (get-in selected [:cycle :sourceSchedule]) "未設定")
                    " · 状態: " (get-in selected [:cycle :cycleState]))]
           (when-let [ms (get-in selected [:cycle :periodMs])] [:p (str "周期: " (/ ms 60000) "分")])
           (when-let [slot (get-in selected [:cycle :nextSlot])]
             [:p (str "次回: " (.toLocaleString (js/Date. slot) "ja-JP" #js {:timeZone "Asia/Tokyo"}) " JST")])
           (when-let [phase (get-in selected [:cycle :phase])]
             [:progress {:aria-label "元cron周期内の進行" :value phase :max 1}])
           [:p (for [issue (:issues selected)] ^{:key issue} [:a {:href (str "https://linear.app/kotobalabs/issue/" issue)} (str issue " ")])]
           [:button.secondary {:type "button" :on-click #(on-details (:label selected))} "App・実行記録を一覧で開く"]])])]))
