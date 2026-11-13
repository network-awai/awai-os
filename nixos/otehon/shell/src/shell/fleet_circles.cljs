(ns shell.fleet-circles
  (:require [clojure.string :as str]
            ["react" :refer [useEffect useMemo useState useRef]]
            [shell.fleet-activity :as activity]
            [shell.ui-copy :as ui]
            ["../fleet-activity.js" :refer [activitySelection]]
            [shell.fleet-goals :as goals]
            [shell.fleet-cooperation :as cooperation] [shell.circle-work :as work]
            ["../circle-work.js" :refer [goalEdges]] ["../fleet-cooperation.js" :refer [missionGoals circleCooperations]]
            [shell.fleet-org-editor :as org-editor]
            ["../fleet-organizations.js" :refer [blankOrganizations loadOrganizations changeOrganization saveOrganizations]]
            ["../fleet-circles.js" :refer [circlePack]]))
(def states [[:running :stateRunning "#2084d4"] [:recovering :stateRecovering "#8d63c7"] [:waiting :stateWaiting "#267c62"] [:queued :stateQueued "#377bc0"]
             [:held :stateHeld "#ae7323"] [:attention :stateAttention "#c44343"] [:unknown :stateUnknown "#7b8190"]])
(defn panel [bots stale? now query on-query on-details & [locale chat-component peer-progress work-progress]]
  (let [[focus-id set-focus] (useState "fleet") [mission-id set-mission] (useState nil) map-ref (useRef nil) [grouping set-grouping] (useState "responsibility") [goals? set-goals] (useState false) [selected-id set-selected] (useState nil)
        [org-data set-org-data] (useState (fn [] (if (and (exists? js/window) (exists? js/localStorage)) (loadOrganizations (clj->js (vec bots)) js/localStorage) #js {:state (blankOrganizations) :error nil})))
        [message set-message] (useState nil) [reduced set-reduced] (useState true)
        change-org (fn [action]
                     (try (let [next (changeOrganization (.-state org-data) action (clj->js (vec bots)))]
                            (saveOrganizations next (clj->js (vec bots)) js/localStorage)
                            (set-org-data #js {:state next :error nil}) (set-message (ui/t locale :savedOrganization)) true)
                          (catch :default error (set-message (.-message error)) false)))
        view (useMemo (fn [] (js->clj (circlePack (clj->js (vec bots)) #js {:stale stale? :query query :now now :grouping grouping :orgState (.-state org-data)}) :keywordize-keys true)) #js [bots stale? query now org-data grouping])
        nodes (:nodes view) focus (or (first (filter #(= focus-id (:id %)) nodes)) (first nodes))
        selected (first (filter #(= selected-id (:id %)) nodes))
        selection (js->clj (activitySelection (clj->js nodes) (clj->js (vec bots)) selected-id now stale?) :keywordize-keys true)
        responsibility? (= grouping "responsibility")
        missions (js->clj (missionGoals (clj->js nodes) "fleet") :keywordize-keys true)
        missions (mapv #(assoc % :circleLabels (into {} (map (fn [n] [(keyword (:id n)) (:label n)]) nodes))) missions)
        mission (first (filter #(= mission-id (:key %)) missions))
        cycles (js->clj (circleCooperations (clj->js nodes) (clj->js bots) (clj->js (or (:cycles peer-progress) [])) now stale?) :keywordize-keys true)
        work-edges (js->clj (goalEdges (clj->js work-progress) (clj->js nodes) (:catalogSha256 work-progress) now) :keywordize-keys true)
        peer-ids (into (set (mapcat #(map :id (:participants %)) cycles)) (mapcat (juxt :from :to) work-edges))
        visible-nodes (if responsibility? (filter #(and (or (= (:id %) (:id focus)) (some #{(:id focus)} (:ancestorIds %))) (<= (:depth %) (+ 2 (:depth focus))) (or (not= "bot" (:kind %)) (= (:parentId %) (:id focus)) (and (>= (:depth focus) 2) (contains? peer-ids (:id %))))) nodes) nodes)
        size (+ 24 (* 2 (:radius focus))) scale (/ 1000 size)
        choose (fn [node] (set-selected (:id node)) (if (= "bot" (:kind node)) (set-focus (:parentId node)) (set-focus (:id node))))
        open-circle (fn [id] (when-let [n (first (filter #(= id (:id %)) nodes))] (choose n)))
        visible-ids (set (map :id visible-nodes))]
    (useEffect (fn [] (when (exists? js/window)
                       (let [media (.matchMedia js/window "(prefers-reduced-motion: reduce)") update (fn [] (set-reduced (.-matches media)))]
                         (update) (.addEventListener media "change" update)
                         (fn [] (.removeEventListener media "change" update))))) #js [])
    (useEffect (fn [] (when (and mission-id (.-current map-ref)) (.scrollIntoView (.-current map-ref) #js {:block "start" :behavior "instant"})) js/undefined) #js [mission-id])
    [:section.fleet-circle-view {:aria-label (ui/t locale :circlesTitle)}
     [:h3 (ui/t locale :circlesTitle)]
     (when responsibility?
      [cooperation/missions-panel missions mission
       (fn [goal] (set-mission (:key goal)) (open-circle (:lead goal))) open-circle locale])
     [:div.fleet-circle-path {:aria-label (ui/t locale :circlesTitle)}
      (for [[mode title] [["responsibility" :responsibility] ["repository" :repositories]]]
        ^{:key mode} [:button.secondary {:type "button" :aria-pressed (= grouping mode)
          :on-click #(do (set-grouping mode) (set-focus "fleet") (set-selected nil))} (ui/t locale title)])
      [:button.secondary {:type "button" :aria-pressed goals? :on-click #(set-goals (not goals?))} (ui/t locale :goals)]]
     [:label.soshiki-field [:span (ui/t locale :search)]
      [:input {:type "search" :aria-label (ui/t locale :search) :placeholder (ui/t locale :searchPlaceholder) :value query :on-change #(on-query (.. % -target -value))}]]
     [:div.fleet-circle-path
      [:button.secondary {:type "button" :on-click #(do (set-focus "fleet") (set-selected nil))} (ui/t locale :overview)]
      (when (not= "fleet" (:id focus)) [:span (:label focus)])]
     [:ul.fleet-circle-legend {:aria-label (ui/t locale :stateLegend)} (for [[state label color] states :when (pos? (get-in (first nodes) [:counts state] 0))] ^{:key state} [:li [:span {:style {:background color} :aria-hidden true}] (ui/t locale label) [:strong (get-in (first nodes) [:counts state])]])]
     [:p.fleet-map-total (ui/t locale (if responsibility? :structureCount :repositoryCount)
                            {:bots (:totalBots view) :circles (if responsibility? (:charterCount view) (:circleCount view))})]
     (when stale? [:span.fleet-status {:data-state "unknown" :role "status"} (ui/t locale :stale)])
     [:div.fleet-workspace {:ref map-ref}
      [:div.fleet-map-column
     (when responsibility?
       [:div.fleet-circle-index
        (for [node (filter #(and (= "responsibility" (:kind %)) (= (:parentId %) (:id focus))) nodes)]
          ^{:key (:id node)} [:button.secondary {:type "button" :on-click #(choose node)}
            [:strong (:label node)] [:span (ui/t locale :profileCount {:count (:count node)})]])])
     [:svg.fleet-circle-map {:viewBox (str (- (:x focus) (/ size 2)) " " (- (:y focus) (/ size 2)) " " size " " size)
                            :role "group" :aria-label (ui/t locale :mapAria) :aria-describedby "fleet-map-description"}
      (for [node visible-nodes]
        (let [bot? (= "bot" (:kind node))
              color (some (fn [[s _ c]] (when (= (name s) (:state node)) c)) states)
              desc (str (ui/state-label locale (get-in node [:activity :state])) " · " (:label node) " · " (ui/t locale :profileCount {:count (:count node)}) " · "
                        (apply str (for [[s title _] states] (str (ui/t locale title) " " (get-in node [:counts s]) " "))))]
          ^{:key (:id node)}
          [:g.fleet-circle-node {:role "button" :tab-index 0 :aria-label desc
                                 :on-click #(choose node)
                                 :on-key-down (fn [e] (when (contains? #{"Enter" " "} (.-key e)) (.preventDefault e) (choose node)))}
           [:title desc]
           [:circle {:cx (:x node) :cy (:y node) :r (:radius node)
                     :class (str "fleet-pack-" (:kind node) " fleet-pack-depth-" (:depth node) (when (= selected-id (:id node)) " fleet-pack-selected"))
                     :style {:fill (if bot? color (str "color-mix(in srgb, var(--focus) " (min 52 (+ 5 (* 10 (:depth node)))) "%, var(--bg))")) :opacity (if (and (seq query) (zero? (:matchCount node))) 0.18 1)}}]
           (when (contains? peer-ids (:id node))
            [:circle {:cx (:x node) :cy (:y node) :r (+ (:radius node) (/ 3 scale)) :fill "none" :stroke "var(--focus)" :stroke-width (/ 2 scale) :pointer-events "none"}])
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
      (for [cycle cycles :when (every? #(contains? visible-ids (:id %)) (:participants cycle))
            :let [a (first (filter #(= (:id %) (:id (first (:participants cycle)))) nodes))
                  b (first (filter #(= (:id %) (:id (second (:participants cycle)))) nodes))]]
       ^{:key (:cycleKey cycle)}
       [:g {:aria-hidden true :pointer-events "none"}
        [:path {:d (str "M " (:x a) " " (:y a) " Q " (/ (+ (:x a) (:x b)) 2) " " (- (min (:y a) (:y b)) (/ 30 scale)) " " (:x b) " " (:y b))
                :fill "none" :stroke "var(--focus)" :stroke-width (/ 2 scale) :stroke-dasharray (str (/ 6 scale) " " (/ 4 scale))}
         (when (and (:live cycle) (not reduced)) [:animate {:attributeName "stroke-dashoffset" :from "20" :to "0" :dur "1s" :repeatCount "indefinite"}])]])
      (for [edge work-edges :when (and (contains? visible-ids (:from edge)) (contains? visible-ids (:to edge)))
            :let [a (first (filter #(= (:id %) (:from edge)) nodes)) b (first (filter #(= (:id %) (:to edge)) nodes))]]
       ^{:key (:id edge)} [:path {:d (str "M " (:x a) " " (:y a) " L " (:x b) " " (:y b)) :fill "none" :stroke "var(--focus)" :stroke-width (/ 2 scale) :stroke-dasharray (str (/ 6 scale) " " (/ 4 scale)) :aria-hidden true :pointer-events "none"}
        (when (and (:live edge) (not reduced)) [:animate {:attributeName "stroke-dashoffset" :from "20" :to "0" :dur "1s" :repeatCount "indefinite"}])])
      (for [node visible-nodes
            :when (and (pos? (:depth node)) (> (* scale (:radius node)) 32)
                       (or (contains? peer-ids (:id node)) (= (:id node) (:id focus)) (= (:parentId node) (:id focus)) (and responsibility? (= 2 (:depth node)) (= "fleet" (:id focus)))))]
        ^{:key (str "label-" (:id node))}
        [:text {:x (:x node) :y (if (or (= "bot" (:kind node)) (and responsibility? (not-any? #(= (:parentId %) (:id node)) visible-nodes))) (- (:y node) (/ 8 scale)) (+ (- (:y node) (:radius node)) (/ 18 scale)))
                :text-anchor "middle" :class "fleet-pack-label" :style {:font-size (/ (if (contains? peer-ids (:id node)) 14 (if (contains? #{"organization" "responsibility"} (:kind node)) 24 22)) scale)}}
         (let [label (if (= "circle" (:kind node)) (last (str/split (:label node) #"/")) (:label node))
               limit (max 4 (min 25 (js/Math.floor (/ (* 1.6 (:radius node) scale) (if responsibility? 24 15)))))]
           (if (and (not (contains? peer-ids (:id node))) (> (count label) limit)) (str (subs label 0 (dec limit)) "…") label))
         [:tspan {:x (:x node) :dy (/ 23 scale) :style {:font-size (/ 18 scale)}} (ui/t locale :profileCount {:count (:count node)})]])]
     [:p.sr-only {:id "fleet-map-description"} (ui/t locale :chartDescription)]
     (when message [:p {:role "status"} message])
      (when-not responsibility? [:f> org-editor/panel nodes selected change-org (.-error org-data)])
     (when responsibility?
       [:<> [:details.fleet-disclosure [:summary (ui/t locale :purpose)] [:f> goals/panel (or selected focus) nil locale]]
        (when goals?
          [:div.fleet-goals-grid
           (for [node (filter #(and (= "responsibility" (:kind %)) (:purpose %)) nodes)]
             ^{:key (:id node)} [:f> goals/panel node #(choose node) locale] )])])
      ]
      [:div.fleet-inspector-stack
       [work/panel work-progress (or selected-id focus-id) locale now open-circle]
       [cooperation/mission-detail mission open-circle locale]
       (when responsibility? [cooperation/panel (if mission (filter #(= (:missionKey %) (:key mission)) cycles) cycles) open-circle open-circle locale])
       ^{:key (or selected-id "unselected")}
       [:f> activity/panel selection
       (fn [id] (when-let [node (first (filter #(= id (:id %)) nodes))] (choose node)))
       #(set-selected nil) on-details locale chat-component]]]]))
