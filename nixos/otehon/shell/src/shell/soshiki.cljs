(ns shell.soshiki
  (:require ["react" :refer [useEffect useMemo useRef useState]]
            ["../soshiki-fleet.js" :refer [importFleet]]
            [shell.manimani :refer [use-manimani]]
            ["../soshiki.js" :refer [addBot addCircle addProposal addRole assignRole
                                     childrenOf circlePath computeSize decideProposal
                                     loadSoshiki moveCircle myRoles parseList
                                     personNameForAccount subtreeRoles removeBot
                                     removeCircle removeRole rolesOf saveSoshiki
                                     updateBot]]))

(def tabs
  [#js {:id "chart" :label "組織設計" :sub "Chart"}
   #js {:id "bots" :label "Bot" :sub "Profiles"}
   #js {:id "size" :label "サイズ" :sub "Size"}])

(def error-text
  {"bad-name" "名前を1〜80文字で入れてください。"
   "bad-purpose" "目的を確認してください（サークル・ロールは必須、280文字まで）。"
   "bad-list" "箇条書きは12件まで、1件80文字までです。"
   "bad-metric" "メトリクスは80文字までです。"
   "bad-assignee" "アサインは Bot か Person と名前で指定します。"
   "bad-approval" "承認は auto か ask です。"
   "bad-parent" "その親サークルには移動できません。"
   "unknown-circle" "そのサークルはもうありません。"
   "unknown-parent" "その親サークルはもうありません。"
   "unknown-role" "そのロールはもうありません。"
   "unknown-bot" "そのBotはもうありません。"
   "unknown-proposal" "その提案はもうありません。"
   "proposal-closed" "その提案は決着済みです。"
   "circle-has-children" "子サークルがあるため消せません。先に子を移してください。"
   "circle-not-empty" "ロールがあるため消せません。先にロールを移すか消してください。"
   "bot-exists" "その名前のBotは登録済みです。"})

(defn- storage []
  (when (exists? js/localStorage) js/localStorage))

(defn use-soshiki []
  (let [[state set-state] (useState
                           (fn []
                             (let [store (storage)]
                               (if-not store
                                 (loadSoshiki #js {:getItem (fn [] nil)})
                                 (loadSoshiki store)))))
        [save-failed set-save-failed] (useState false)]
    (useEffect
     (fn []
       (let [store (storage)]
         (if-not store
           (set-save-failed true)
           (try
             (saveSoshiki store state)
             (set-save-failed false)
             (catch :default _
               (set-save-failed true))))) js/undefined)
     #js [state])
    (let [apply-fn (fn [result]
                     (cond
                       (.-error result) (.-error result)
                       (.-state result) (do (set-state (.-state result)) nil)
                       :else nil))]
      [state apply-fn save-failed])))

(defn field [label & children]
  (into [:label.soshiki-field [:span label]] children))

(def soshiki-ui-key "otehon.soshiki.ui.v1")
(def highlights
  [#js {:id "all" :label "すべて"}
   #js {:id "open" :label "空き"}
   #js {:id "bot" :label "Bot"}
   #js {:id "person" :label "人"}])

(defn role-highlight [role]
  (if-not (.-assignee role)
    "open"
    (if (= "person" (.-kind (.-assignee role))) "person" "bot")))

(defn matches-query [text query]
  (let [q (.toLowerCase (.trim query))]
    (if (empty? q)
      true
      (.includes (.toLowerCase text) q))))

(defn- load-focus-id []
  (try
    (let [saved (.parse js/JSON (.getItem js/localStorage soshiki-ui-key))
          focus-id (some-> saved (.-focusId))]
      (if (string? focus-id) focus-id nil))
    (catch :default _ nil)))

(defn- size-class [n]
  (cond (>= n 5) "l" (>= n 2) "m" :else "s"))

(defn role-detail [state role apply-fn set-error bot-names me]
  (let [[text set-text] (useState "")
        circle (.find (.-circles state) (fn [item] (= (.-id item) (.-circleId role))))
        assign-self (fn []
                      (when me
                        (set-error (apply-fn (assignRole state #js {:roleId (.-id role)
                                                                   :assignee #js {:kind "person" :name me}})))
                        (set-text "")))
        submit (fn []
                 (let [raw (.trim text)]
                   (if (empty? raw)
                     (do
                       (set-error (apply-fn (assignRole state #js {:roleId (.-id role) :assignee nil})))
                       (set-text ""))
                     (let [kind (if (.startsWith raw "@") "person" "bot")
                           person-name (if (.startsWith raw "@") (.trim (.slice raw 1)) raw)]
                       (set-error (apply-fn (assignRole state #js {:roleId (.-id role)
                                                                   :assignee #js {:kind kind :name person-name}})))
                       (set-text "")))))]
    [:div.soshiki-detail {:data-role-detail (.-id role)}
     [:div.soshiki-circle-head
      [:strong
       [:span.hl-dot {:data-hl (role-highlight role) :aria-hidden "true"}]
       (.-name role)]
      [:span.muted (if circle (.-name circle) "")]]
     [:p (.-purpose role)]
     (when (pos? (.-length (.-accountabilities role)))
       [:p (str "責任: " (.join (.-accountabilities role) " / "))])
     (when (pos? (.-length (.-skills role)))
       [:p.muted (str "Skills: " (.join (.-skills role) ", "))])
     (when-not (empty? (.-metric role))
       [:p.muted (str "Metric: " (.-metric role))])
     [:p.muted (str "担当: " (if (.-assignee role)
                               (str (if (= "bot" (.-kind (.-assignee role))) "" "@")
                                    (.-name (.-assignee role)))
                               "空き"))]
     [:div.soshiki-row
      [:input {:aria-label (str (.-name role) "のアサイン")
                :placeholder "Bot名か @人名、空で解除"
                :value text
                :list (str "chart-bots-" (.-id role))
                :on-change #(set-text (.. % -target -value))}]
      [:datalist {:id (str "chart-bots-" (.-id role))}
       (map (fn [bot-name] [:option {:key bot-name :value bot-name}]) bot-names)]
      [:button {:type "button" :on-click submit} "割当"]
      (when me
        [:button.soshiki-quiet {:type "button" :on-click assign-self} "自分に割当"])]
     [:p.muted "削除・サークル移動は下の編集セクションで行います。"]]))

(def max-nest-depth 6)

(defn- branch-matches [state circle query highlight]
  (if (matches-query (str (.-name circle) " " (.-purpose circle)) query)
    (if (= highlight "all")
      true
      (.some (subtreeRoles state (.-id circle))
             (fn [role] (= (role-highlight role) highlight))))
    (.some (subtreeRoles state (.-id circle))
           (fn [role]
             (and (or (= highlight "all") (= (role-highlight role) highlight))
                  (matches-query (str (.-name role) " " (.-purpose role)) query))))))

(defn role-chip [role selected on-select]
  (let [assignee (if (.-assignee role)
                   (str (if (= "bot" (.-kind (.-assignee role))) "" "@")
                        (.-name (.-assignee role)))
                   "空き")]
    [:button {:type "button"
               :class (if selected "soshiki-chip active" "soshiki-chip")
               :data-role (.-id role)
               :title (str (.-name role) "（" assignee "）: " (.-purpose role))
               :aria-expanded selected
               :on-click #(on-select (if selected nil (.-id role)))}
     [:span.hl-dot {:data-hl (role-highlight role) :aria-hidden "true"}]
     [:span (.-name role)]]))

(defn nested-circle [state circle depth query highlight selected-role-id on-select-role on-focus rows members]
  (let [children (childrenOf state (.-id circle))
        filtering (or (not (empty? (.trim query))) (not (= highlight "all")))
        direct-roles (.filter (rolesOf state (.-id circle))
                              (fn [role]
                                (and (or (= highlight "all") (= (role-highlight role) highlight))
                                     (matches-query (str (.-name role) " " (.-purpose role)) query))))
        visible-children (.filter children (fn [child] (branch-matches state child query highlight)))
        row (.get rows (.-id circle))
        count (if row (.-subtreeRoles row) (.-length (subtreeRoles state (.-id circle))))
        head [:<>
              [:strong (.-name circle)]
              [:span.muted (str count " roles · " (or (some-> row (.-subtreeMembers)) 0) " members")]
              (when-not (zero? depth) [:span.soshiki-open "開く ›"])]]
    [:div.soshiki-nest {:data-circle (.-id circle) :data-depth depth :data-size (size-class count)}
     (if (zero? depth)
       [:div.soshiki-nest-headtext head]
       [:button.soshiki-nest-head {:type "button" :data-zoom (.-id circle)
                                    :on-click #(on-focus (.-id circle))}
        head])
     [:p.soshiki-purpose (.-purpose circle)]
     (when members
       [:ul.soshiki-members {:aria-label "メンバー"}
        (when (zero? (.-length members))
          [:li.muted "メンバーはまだいません。"])
        (map (fn [entry]
                (let [[member-name kind] entry]
                  [:li {:key member-name :title (if (= kind "bot") "Bot" "人")}
                   [:span.soshiki-avatar {:data-kind kind :aria-hidden "true"}
                    (str (if (= kind "bot") "" "@") (aget member-name 0))]
                   [:span member-name]])) members)])
     (if (pos? (.-length direct-roles))
       [:ul.soshiki-chips {:aria-label (str (.-name circle) "のロール")}
        (map (fn [role]
                [:li {:key (.-id role)}
                 [role-chip role (= (.-id role) selected-role-id) on-select-role]]) direct-roles)]
       (if filtering
         [:p.muted "合致するロールはありません。"]
         [:p.muted "ロールはまだありません。"]))
     (when (and (< depth max-nest-depth) (pos? (.-length visible-children)))
       [:div.soshiki-kids
        (map (fn [child]
                [:f> nested-circle state child (inc depth) query highlight
                 selected-role-id on-select-role on-focus rows nil]) visible-children)])]))

(defn circle-node [state circle depth apply-fn set-error bot-names]
  (let [children (childrenOf state (.-id circle))
        roles (rolesOf state (.-id circle))
        [assignee set-assignee] (useState #js {})
        [parent set-parent] (useState (or (.-parentId circle) ""))]
    (let [submit-assign (fn [role-id]
                          (let [raw (.trim (or (aget assignee role-id) ""))]
                            (if (empty? raw)
                              (set-error (apply-fn (assignRole state #js {:roleId role-id :assignee nil})))
                              (let [kind (if (.startsWith raw "@") "person" "bot")
                                    person-name (if (.startsWith raw "@") (.trim (.slice raw 1)) raw)]
                                (set-error (apply-fn (assignRole state #js {:roleId role-id
                                                                            :assignee #js {:kind kind :name person-name}})))))))]
      [:li.soshiki-circle {:data-circle (.-id circle) :data-depth depth}
       [:div.soshiki-circle-head
        [:strong (.-name circle)]
        [:span.muted (str (.-length roles) " roles · " (.-length children) " sub-circles")]]
       [:p.soshiki-purpose (.-purpose circle)]
       (when (zero? (.-length roles))
         [:p.muted "ロールはまだありません。"])
       [:ul.soshiki-roles
        (map (fn [role]
                [:li.soshiki-role {:key (.-id role) :data-role (.-id role)}
                 [:div.soshiki-role-head
                  [:span.soshiki-role-name (.-name role)]
                  [:span.muted (if (.-assignee role)
                                  (str (if (= "bot" (.-kind (.-assignee role))) "" "@")
                                       (.-name (.-assignee role)))
                                  "空き")]]
                 [:p.muted (.-purpose role)]
                 (when (pos? (.-length (.-accountabilities role)))
                   [:p (str "責任: " (.join (.-accountabilities role) " / "))])
                 (when (pos? (.-length (.-skills role)))
                   [:p.muted (str "Skills: " (.join (.-skills role) ", "))])
                 (when-not (empty? (.-metric role))
                   [:p.muted (str "Metric: " (.-metric role))])
                 [:div.soshiki-row
                  [:input {:aria-label (str (.-name role) "のアサイン")
                            :placeholder "Bot名か @人名、空で解除"
                            :value (or (aget assignee (.-id role)) "")
                            :list (str "bots-" (.-id role))
                            :on-change #(set-assignee (fn [current]
                                                        (let [out (js/Object.assign #js {} current)]
                                                          (aset out (.-id role) (.. % -target -value))
                                                          out)))}]
                  [:datalist {:id (str "bots-" (.-id role))}
                   (map (fn [bot-name] [:option {:key bot-name :value bot-name}]) bot-names)]
                  [:button {:type "button" :on-click #(submit-assign (.-id role))} "割当"]
                  [:button.soshiki-quiet {:type "button"
                                           :on-click #(set-error (apply-fn (removeRole state (.-id role))))}
                   "削除"]]]) roles)]
       (when (pos? (.-length children))
         [:ul.soshiki-children
          (map (fn [child]
                  [:f> circle-node state child (inc depth) apply-fn set-error bot-names]) children)])
       [:div.soshiki-row
        [:select {:aria-label (str (.-name circle) "の親") :value parent
                   :on-change #(set-parent (.. % -target -value))}
         [:option {:value ""} "全体（親なし）"]
         (map (fn [item]
                 [:option {:key (.-id item) :value (.-id item)} (.-name item)]) (.filter (.-circles state) (fn [item] (not= (.-id item) (.-id circle)))))]
        [:button {:type "button"
                   :on-click #(set-error (apply-fn (moveCircle state #js {:id (.-id circle)
                                                                          :parentId (if (empty? parent) nil parent)})))}
         "移動"]
        [:button.soshiki-quiet {:type "button"
                                 :on-click #(set-error (apply-fn (removeCircle state (.-id circle))))}
         "削除"]]])))

(defn chart-view [state apply-fn set-error focus-id on-focus query highlight selected-role-id on-select-role bot-names me]
  (let [roots (childrenOf state nil)
        focus (or (.find (.-circles state) (fn [circle] (= (.-id circle) focus-id)))
                  (aget (.-circles state) 0)
                  nil)
        size (useMemo (fn [] (computeSize state)) #js [state])
        rows (useMemo (fn [] (js/Map. (.map (.-rows size)
                                            (fn [row] #js [(.-id row) row]))))
                      #js [size])]
    (if-not focus
      [:p.muted "サークルはまだありません。下の編集から作れます。"]
      (let [path (circlePath state (.-id focus))
            direct-roles (rolesOf state (.-id focus))
            members (useMemo
                     (fn []
                       (let [seen (js/Map.)]
                         (.forEach direct-roles
                                   (fn [role]
                                     (when (and (.-assignee role)
                                                (not (.has seen (.-name (.-assignee role)))))
                                       (.set seen (.-name (.-assignee role)) (.-kind (.-assignee role))))))
                         (.forEach (.-bots state)
                                   (fn [bot]
                                     (when (and (.includes (.-circleIds bot) (.-id focus))
                                                (not (.has seen (.-name bot))))
                                       (.set seen (.-name bot) "bot"))))
                         (.from js/Array (.entries seen))))
                     #js [(.-bots state) direct-roles (.-id focus)])
            selected (.find (.-roles state) (fn [role] (= (.-id role) selected-role-id)))]
        [:div {:data-chart-focus (.-id focus)}
         [:nav.soshiki-crumb {:aria-label "サークルのパンくず"}
          (map-indexed (fn [index circle]
                  (if (< index (dec (.-length path)))
                    [:span {:key (.-id circle)}
                     [:button.soshiki-crumb-link {:type "button" :on-click #(on-focus (.-id circle))}
                      (.-name circle)]
                     [:span {:aria-hidden "true"} " › "]]
                    [:strong {:key (.-id circle) :aria-current "page"} (.-name circle)])) path)]
         [:f> nested-circle state focus 0 query highlight selected-role-id on-select-role on-focus rows members]
         (when selected
           [:f> role-detail state selected apply-fn set-error bot-names me])]))))

(defn chart-tab [state apply-fn me score method on-account]
  (let [[error set-error] (useState nil)
        mine (myRoles state me)
        circle-of (fn [role] (.find (.-circles state) (fn [circle] (= (.-id circle) (.-circleId role)))))
        [circle-name set-circle-name] (useState "")
        [circle-purpose set-circle-purpose] (useState "")
        [circle-parent set-circle-parent] (useState "")
        [role-circle set-role-circle] (useState (or (some-> (aget (.-circles state) 0) (.-id)) ""))
        [role-name set-role-name] (useState "")
        [role-purpose set-role-purpose] (useState "")
        [role-acts set-role-acts] (useState "")
        [role-skills set-role-skills] (useState "")
        [role-metric set-role-metric] (useState "")
        [proposal-title set-proposal-title] (useState "")
        [proposal-detail set-proposal-detail] (useState "")
        [focus-id set-focus-id] (useState load-focus-id)
        [query set-query] (useState "")
        [highlight set-highlight] (useState "all")
        [selected-role-id set-selected-role-id] (useState nil)
        roots (childrenOf state nil)
        bot-names (.map (.-bots state) (fn [bot] (.-name bot)))]
    (useEffect
     (fn []
       (when-not (.some (.-circles state) (fn [circle] (= (.-id circle) role-circle)))
         (set-role-circle (or (some-> (aget (.-circles state) 0) (.-id)) ""))) js/undefined)
     #js [(.-circles state) role-circle])
    (useEffect
     (fn []
       (when (and focus-id (not (.some (.-circles state) (fn [circle] (= (.-id circle) focus-id)))))
         (set-focus-id (or (some-> (aget (.-circles state) 0) (.-id)) nil))
         (set-selected-role-id nil)) js/undefined)
     #js [(.-circles state) focus-id])
    (useEffect
     (fn []
       (try
         (.setItem js/localStorage soshiki-ui-key (.stringify js/JSON #js {:focusId focus-id}))
         (catch :default _ nil)) js/undefined)
     #js [focus-id])
    (let [on-focus (fn [id] (set-focus-id id) (set-selected-role-id nil))
          submit-circle (fn [event]
                          (.preventDefault event)
                          (let [failed (apply-fn (addCircle state #js {:name circle-name
                                                                       :purpose circle-purpose
                                                                       :parentId (if (empty? circle-parent)
                                                                                   nil circle-parent)}))]
                            (set-error failed)
                            (when-not failed
                              (set-circle-name "")
                              (set-circle-purpose ""))))
          submit-role (fn [event]
                        (.preventDefault event)
                        (let [failed (apply-fn (addRole state #js {:circleId role-circle
                                                                   :name role-name
                                                                   :purpose role-purpose
                                                                   :accountabilities (parseList role-acts)
                                                                   :skills (parseList role-skills)
                                                                   :metric role-metric
                                                                   :assignee nil}))]
                          (set-error failed)
                          (when-not failed
                            (set-role-name "")
                            (set-role-purpose "")
                            (set-role-acts "")
                            (set-role-skills "")
                            (set-role-metric ""))))
          submit-proposal (fn [event]
                            (.preventDefault event)
                            (let [failed (apply-fn (addProposal state #js {:title proposal-title
                                                                           :detail proposal-detail}))]
                              (set-error failed)
                              (when-not failed
                                (set-proposal-title "")
                                (set-proposal-detail ""))))]
      [:div
       (when error [:p.net-error (or (get error-text error) "入力を確認してください。")])
       (if me
         [:section.soshiki-me {:aria-label "あなたのプロフィール" :data-me me}
          [:span.soshiki-avatar {:data-kind "person" :aria-hidden "true"}
           (str "@" (aget (.replace me #"^@" "") 0))]
          [:div
           [:strong (str "あなた · " me)]
           [:span.muted (str "Trust " score " · " (if (= method "wallet") "Web3 wallet" "Passkey"))]]
          (when on-account
            [:button.soshiki-quiet {:type "button" :on-click on-account} "アカウントを開く"])]
         [:p.muted "サインインするとあなたがここに出ます。"])
       [:h2 "My Roles"]
       (when-not me [:p.muted "—"])
       (when (and me (zero? (.-length mine)))
         [:p.muted "あなたのロールはまだありません。ロールの詳細から「自分に割当」できます。"])
       (when (pos? (.-length mine))
         [:ul.soshiki-rolegrid
          (map (fn [role]
                  [:li {:key (.-id role)}
                   [:button.soshiki-rolecard {:type "button" :data-my-role (.-id role)
                                               :on-click (fn [] (on-focus (.-circleId role))
                                                           (set-selected-role-id (.-id role)))}
                    [:span.hl-dot {:data-hl "person" :aria-hidden "true"}]
                    [:strong (.-name role)]
                    [:span.muted (or (some-> (circle-of role) (.-name)) "")]
                    [:span.soshiki-rolecard-purpose (.-purpose role)]]]) mine)])
       [:div.soshiki-chartbar
        [:input.soshiki-search {:aria-label "サークルとロールを検索"
                                 :placeholder "検索: サークル・ロール名"
                                 :value query
                                 :on-change #(set-query (.. % -target -value))}]
        [:div.soshiki-legend {:role "group" :aria-label "ハイライト絞り込み"}
         (map (fn [item]
                 [:button {:key (.-id item)
                            :type "button"
                            :class (if (= highlight (.-id item))
                                     "soshiki-legend-btn active" "soshiki-legend-btn")
                            :aria-pressed (= highlight (.-id item))
                            :data-highlight (.-id item)
                            :on-click #(set-highlight (.-id item))}
                  (when-not (= "all" (.-id item))
                    [:span.hl-dot {:data-hl (.-id item) :aria-hidden "true"}])
                  (.-label item)]) highlights)]]
       [:f> chart-view state apply-fn set-error focus-id on-focus query highlight
        selected-role-id set-selected-role-id bot-names me]
       [:h2 "編集"]
       (when (zero? (.-length roots))
         [:p.muted "サークルはまだありません。下のフォームから作れます。"])
       [:ul.soshiki-tree
        (map (fn [circle]
                [:f> circle-node state circle 0 apply-fn set-error bot-names]) roots)]
       [:h2 "サークルを追加"]
       [:form.soshiki-form {:on-submit submit-circle}
        [field "名前"
         [:input {:aria-label "サークル名" :value circle-name
                   :on-change #(set-circle-name (.. % -target -value))}]]
        [field "目的"
         [:input {:aria-label "サークルの目的" :value circle-purpose
                   :on-change #(set-circle-purpose (.. % -target -value))}]]
        [field "親サークル"
         [:select {:value circle-parent :on-change #(set-circle-parent (.. % -target -value))}
          [:option {:value ""} "全体（親なし）"]
          (map (fn [circle]
                  [:option {:key (.-id circle) :value (.-id circle)} (.-name circle)]) (.-circles state))]]
        [:button.primary {:type "submit"} "サークルを作る"]]
       [:h2 "ロールを追加"]
       [:form.soshiki-form {:on-submit submit-role}
        [field "所属サークル"
         [:select {:aria-label "所属サークル" :value role-circle
                    :on-change #(set-role-circle (.. % -target -value))}
          (map (fn [circle]
                  [:option {:key (.-id circle) :value (.-id circle)} (.-name circle)]) (.-circles state))]]
        [field "ロール名"
         [:input {:aria-label "ロール名" :value role-name
                   :on-change #(set-role-name (.. % -target -value))}]]
        [field "目的"
         [:input {:aria-label "ロールの目的" :value role-purpose
                   :on-change #(set-role-purpose (.. % -target -value))}]]
        [field "責任（カンマ区切り）"
         [:input {:aria-label "ロールの責任" :value role-acts
                   :on-change #(set-role-acts (.. % -target -value))}]]
        [field "スキル（カンマ区切り）"
         [:input {:aria-label "ロールのスキル" :value role-skills
                   :on-change #(set-role-skills (.. % -target -value))}]]
        [field "メトリクス"
         [:input {:aria-label "ロールのメトリクス" :value role-metric
                   :on-change #(set-role-metric (.. % -target -value))}]]
        [:button.primary {:type "submit"} "ロールを作る"]]
       [:h2 "ガバナンス提案"]
       (when (zero? (.-length (.-proposals state)))
         [:p.muted "提案はまだありません。"])
       [:ul.soshiki-proposals
        (map (fn [proposal]
                [:li {:key (.-id proposal) :data-proposal (.-id proposal)
                       :data-status (.-status proposal)}
                 [:strong (.-title proposal)] " " [:span.muted (.-status proposal)]
                 (when-not (empty? (.-detail proposal))
                   [:p.muted (.-detail proposal)])
                 (when (= "open" (.-status proposal))
                   [:div.soshiki-row
                    [:button {:type "button"
                               :on-click #(set-error (apply-fn (decideProposal state #js {:id (.-id proposal)
                                                                                          :accept true})))}
                     "承認"]
                    [:button.soshiki-quiet {:type "button"
                                             :on-click #(set-error (apply-fn (decideProposal state #js {:id (.-id proposal)
                                                                                                        :accept false})))}
                     "却下"]])]) (.-proposals state))]
       [:form.soshiki-form {:on-submit submit-proposal}
        [field "提案タイトル"
         [:input {:aria-label "提案タイトル" :value proposal-title
                   :on-change #(set-proposal-title (.. % -target -value))}]]
        [field "詳細"
         [:input {:aria-label "提案の詳細" :value proposal-detail
                   :on-change #(set-proposal-detail (.. % -target -value))}]]
        [:button.primary {:type "submit"} "提案する"]]])))

(defn bots-tab [state apply-fn agents]
  (let [[error set-error] (useState nil)
        [bot-name set-bot-name] (useState "")
        [purpose set-purpose] (useState "")
        [skills set-skills] (useState "")
        [edits set-edits] (useState {})]
    (let [circle-name (fn [id] (or (some-> (.find (.-circles state)
                                                  (fn [circle] (= (.-id circle) id)))
                                           (.-name))
                                   id))
          role-name (fn [id] (or (some-> (.find (.-roles state)
                                                (fn [role] (= (.-id role) id)))
                                         (.-name))
                                 id))
          known (js/Set. (.map (.-bots state) (fn [bot] (.-name bot))))
          candidates (.filter (or agents #js [])
                              (fn [agent] (and (some-> agent (.-name)) (not (.has known (.-name agent))))))
          submit (fn [event]
                   (.preventDefault event)
                   (let [failed (apply-fn (addBot state #js {:name bot-name :purpose purpose
                                                              :skills (parseList skills)
                                                              :circleIds #js [] :roleIds #js []
                                                              :approval "ask"}))]
                     (set-error failed)
                     (when-not failed
                       (set-bot-name "")
                       (set-purpose "")
                       (set-skills ""))))
          save-edit (fn [bot]
                      (let [edit (or (get edits (.-id bot))
                                     {:purpose (.-purpose bot)
                                      :skills (.join (.-skills bot) ", ")
                                      :approval (.-approval bot)})
                            failed (apply-fn (updateBot state #js {:id (.-id bot)
                                                                    :purpose (or (:purpose edit)
                                                                                 (.-purpose bot))
                                                                    :skills (parseList (or (:skills edit) ""))
                                                                    :approval (or (:approval edit)
                                                                                  (.-approval bot))}))]
                        (set-error failed)
                        (when-not failed
                          (set-edits (fn [current] (assoc current (.-id bot) nil))))))]
      [:div
       (when error [:p.net-error (or (get error-text error) "入力を確認してください。")])
       (when (pos? (.-length candidates))
         [:<>
          [:h2 "Manimaniのエージェントから登録"]
          [:ul.soshiki-bots
           (map (fn [agent]
                   [:li {:key (.-id agent) :data-agent (.-id agent)}
                    [:strong (.-name agent)]
                    [:span.muted (if (= "auto" (.-approval agent)) "自動で動く" "先に確認する")]
                    [:div.soshiki-row
                     [:button {:type "button"
                                :on-click #(set-error
                                            (apply-fn
                                             (addBot state #js {:name (.-name agent)
                                                                 :purpose ""
                                                                 :skills #js []
                                                                 :circleIds #js []
                                                                 :roleIds #js []
                                                                 :approval (if (= "auto" (.-approval agent))
                                                                             "auto" "ask")})))}
                      "プロフィールを作る"]]]) candidates)]])
       [:h2 "Botプロフィール"]
       (when (zero? (.-length (.-bots state)))
         [:p.muted "Botはまだ登録されていません。"])
       [:ul.soshiki-bots
        (map (fn [bot]
                (let [edit (or (get edits (.-id bot))
                               {:purpose (.-purpose bot)
                                :skills (.join (.-skills bot) ", ")
                                :approval (.-approval bot)})]
                  [:li.soshiki-bot {:key (.-id bot) :data-bot (.-id bot)}
                   [:div.soshiki-circle-head
                    [:strong (.-name bot)]
                    [:span.muted (if (= "auto" (.-approval bot)) "自動で動く" "先に確認する")]]
                   (if (empty? (.-purpose bot))
                     [:p.muted "目的は未設定です。"]
                     [:p (.-purpose bot)])
                   [:p.muted (str "Skills: " (if (pos? (.-length (.-skills bot)))
                                               (.join (.-skills bot) ", ") "—"))]
                   [:p.muted (str "サークル: " (if (pos? (.-length (.-circleIds bot)))
                                                 (.join (.map (.-circleIds bot) circle-name) " / ") "—"))]
                   [:p.muted (str "ロール: " (if (pos? (.-length (.-roleIds bot)))
                                               (.join (.map (.-roleIds bot) role-name) " / ") "—"))]
                   [:div.soshiki-form
                    [field "目的"
                     [:input {:aria-label (str (.-name bot) "の目的")
                               :value (or (:purpose edit) "")
                               :on-change #(set-edits (fn [current]
                                                        (assoc current (.-id bot)
                                                               (assoc edit :purpose (.. % -target -value)))))}]]
                    [field "スキル（カンマ区切り）"
                     [:input {:aria-label (str (.-name bot) "のスキル")
                               :value (or (:skills edit) "")
                               :on-change #(set-edits (fn [current]
                                                        (assoc current (.-id bot)
                                                               (assoc edit :skills (.. % -target -value)))))}]]
                    [field "承認"
                     [:select {:aria-label (str (.-name bot) "の承認")
                                :value (or (:approval edit) "ask")
                                :on-change #(set-edits (fn [current]
                                                         (assoc current (.-id bot)
                                                                (assoc edit :approval (.. % -target -value)))))}
                      [:option {:value "auto"} "自動で動く"]
                      [:option {:value "ask"} "先に確認する"]]]
                    [:div.soshiki-row
                     [:button {:type "button" :on-click #(save-edit bot)} "保存"]
                     [:button.soshiki-quiet {:type "button"
                                              :on-click #(set-error
                                                          (apply-fn (removeBot state (.-id bot))))}
                      "削除"]]]])) (.-bots state))]
       [:h2 "Botを追加"]
       [:form.soshiki-form {:on-submit submit}
        [field "名前"
         [:input {:aria-label "Bot名" :value bot-name
                   :on-change #(set-bot-name (.. % -target -value))}]]
        [field "目的"
         [:input {:aria-label "Botの目的" :value purpose
                   :on-change #(set-purpose (.. % -target -value))}]]
        [field "スキル（カンマ区切り）"
         [:input {:aria-label "Botのスキル" :value skills
                   :on-change #(set-skills (.. % -target -value))}]]
        [:button.primary {:type "submit"} "Botを作る"]]])))

(defn size-tab [state]
  (let [size (useMemo (fn [] (computeSize state)) #js [state])
        totals (.-totals size)
        max-roles (apply max 1 (seq (.map (.-rows size) (fn [row] (.-subtreeRoles row)))))
        max-members (apply max 1 (seq (.map (.-rows size) (fn [row] (.-subtreeMembers row)))))]
    [:div
     [:h2 "全体"]
     [:ul.soshiki-totals {:data-size-totals true}
      [:li [:strong (.-circles totals)] [:span "サークル"]]
      [:li [:strong (.-roles totals)] [:span "ロール"]]
      [:li [:strong (.-filled totals)] [:span "割当済み"]]
      [:li [:strong (.-open totals)] [:span "空き"]]
      [:li [:strong (.-bots totals)] [:span "Bot"]]
      [:li [:strong (.-people totals)] [:span "人"]]]
     [:p.muted (str "深さ " (.-maxDepth size) " · 未決の提案 " (.-proposalsOpen totals))]
     [:h2 "サークル別"]
     (when (zero? (.-length (.-rows size)))
       [:p.muted "サークルはまだありません。"])
     [:ul.soshiki-sizes
      (map (fn [row]
              [:li {:key (.-id row) :data-size-row (.-id row)}
               [:div.soshiki-circle-head
                [:strong (.-name row)]
                [:span.muted (str (.-subtreeRoles row) " roles · " (.-subtreeMembers row) " members")]]
               [:div.soshiki-meter-row
                [:span "ロール"]
                [:div.meter {:role "img" :aria-label (str (.-name row) "のロール " (.-subtreeRoles row))}
                 [:span {:style {:width (str (js/Math.round (/ (* 100 (.-subtreeRoles row)) max-roles)) "%")}}]]
                [:span.muted (.-subtreeRoles row)]]
               [:div.soshiki-meter-row
                [:span "人数"]
                [:div.meter {:role "img" :aria-label (str (.-name row) "の人数 " (.-subtreeMembers row))}
                 [:span {:style {:width (str (js/Math.round (/ (* 100 (.-subtreeMembers row)) max-members)) "%")}}]]
                [:span.muted (.-subtreeMembers row)]]
               [:p.muted
                (str "直下 " (.-directRoles row) " roles（空き " (.-open row) "）· 直下 "
                     (.-directMembers row) " members"
                     (if (nil? (.-fillRate row))
                       ""
                       (str " · 充足率 " (js/Math.round (* 100 (.-fillRate row))) "%")))]]) (.-rows size))]]))

(defn fleet-import [state apply-fn]
  (let [[message set-message] (useState "")
        current (useRef state)]
    (set! (.-current current) state)
    [:div.soshiki-fleet-import
     [:label "Bot群の登録ファイルを取り込む"
      [:input {:type "file" :accept ".json,application/json" :aria-label "Bot群の登録ファイル"
               :on-change
               (fn [event]
                 (when-let [file (aget (.. event -target -files) 0)]
                   (if (> (.-size file) 8388608)
                     (set-message "ファイルは8 MiBまでです。")
                     (-> (.text file)
                         (.then (fn [text]
                                  (try
                                    (let [result (importFleet (.-current current) (js/JSON.parse text))
                                          error (apply-fn result)]
                                      (set-message (if error
                                                     "取り込めませんでした。形式または既存の登録との競合を確認してください。"
                                                     "Circle・ロール・Botを登録しました。Botの実行は開始していません。")))
                                    (catch :default _ (set-message "登録ファイルを確認してください。")))))
                         (.catch (fn [_] (set-message "ファイルを読み込めませんでした。")))))))}]]
     [:p.muted "現在の登録を残して追加します。実行許可・cronの有効化は別途設定します。"]
     (when (seq message) [:p {:role "status"} message])]))

(defn soshiki [account score on-account]
  (let [[state apply-fn save-failed] (use-soshiki)
        [tab set-tab] (useState "chart")
        [manimani] (use-manimani)
        agents (or (some-> manimani (.-agents)) #js [])
        me (personNameForAccount (some-> account (.-accountDid)))
        method (some-> account (.-method))]
    (let [score (or score 0)]
      [:main.chat.net-view {:data-soshiki true}
       [:div.net-body.soshiki-body
        [:h1 "Soshiki"]
        [:p.muted "サークルとロールで組織を作り、Botにプロフィールを持たせる。すべてこのデバイスに保存します。"]
        [:f> fleet-import state apply-fn]
        (when save-failed
          [:p.net-error "保存できませんでした。この画面の変更はこの表示の間だけ有効です。"])
        [:div.soshiki-tabs {:role "tablist" :aria-label "Soshiki views"}
         (map (fn [item]
                 [:button {:key (.-id item)
                            :type "button"
                            :role "tab"
                            :aria-selected (= tab (.-id item))
                            :class (if (= tab (.-id item)) "soshiki-tab active" "soshiki-tab")
                            :data-tab (.-id item)
                            :on-click #(set-tab (.-id item))}
                  (.-label item)
                  [:span.muted (str " " (.-sub item))]]) tabs)]
        (when (= tab "chart")
          [:f> chart-tab state apply-fn me score method on-account])
        (when (= tab "bots")
          [:f> bots-tab state apply-fn agents])
        (when (= tab "size")
          [:f> size-tab state])]])))
