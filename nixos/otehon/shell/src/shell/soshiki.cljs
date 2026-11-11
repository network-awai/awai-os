(ns shell.soshiki
  (:require [clojure.string]
            [cljs.reader :as reader]
            ["../profile-catalog.js" :refer [readProfileManifests]]
            ["react" :refer [useEffect useMemo useState]]
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
  {"bad-profile" "profile ID は小文字英数字・_・- の1〜64文字で指定してください。"
   "profile-exists" "この itonami profile は別のBotに対応づけられています。"
   "bad-name" "名前を1〜80文字で入れてください。"
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
    (useEffect
     (fn []
       (when-let [detail (.getElementById js/document "soshiki-role-detail")]
         (.focus detail #js {:preventScroll true})
         (.scrollIntoView detail #js {:block "nearest"}))
       js/undefined)
     #js [(.-id role)])
    [:div.soshiki-detail {:id "soshiki-role-detail" :tab-index -1 :data-role-detail (.-id role)}
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

(defn- matching-role? [state role query highlight]
  (let [circle (.find (.-circles state) #(= (.-id %) (.-circleId role)))]
    (and (or (= highlight "all") (= (role-highlight role) highlight))
         (matches-query (str (.-name role) " " (.-purpose role) " "
                             (some-> circle (.-name)) " " (some-> circle (.-purpose))) query))))

(defn- branch-matches [state circle query highlight]
  (or (and (= highlight "all")
           (matches-query (str (.-name circle) " " (.-purpose circle)) query))
      (.some (subtreeRoles state (.-id circle)) #(matching-role? state % query highlight))
      (.some (childrenOf state (.-id circle)) #(branch-matches state % query highlight))))

;; Equal-radius siblings keep navigation stable while filtering. Counts are
;; explicit; circle area does not claim to measure workload or membership.
(defn- activate [action]
  {:on-click (fn [event] (.stopPropagation event) (action))
   :on-key-down (fn [event]
                  (when (contains? #{"Enter" " "} (.-key event))
                    (.preventDefault event) (.stopPropagation event) (action)))})

(defn circle-map [state circle x y radius depth query highlight selected on-select on-focus]
  (let [children (filter #(branch-matches state % query highlight) (childrenOf state (.-id circle)))
        roles (filter #(matching-role? state % query highlight) (rolesOf state (.-id circle)))
        entries (concat (map #(vector :circle %) children) (map #(vector :role %) roles))
        n (count entries)
        sine (js/Math.sin (/ js/Math.PI (max 2 n)))
        inner (* radius 0.76)
        r (if (= n 1) (* inner 0.7) (/ (* inner sine) (+ 1 sine)))
        orbit (if (= n 1) 0 (- inner r))
        label-size (min 22 (max 10 (* radius 0.12)))
        count-roles (.-length (subtreeRoles state (.-id circle)))]
    [:g.soshiki-map-circle {:data-circle (.-id circle) :data-depth depth}
     [:circle (merge {:cx x :cy y :r radius :class "soshiki-map-boundary"
                      :role "button" :tab-index 0 :data-zoom (.-id circle)
                      :aria-label (str (.-name circle) "を開く · " count-roles "ロール")}
                     (activate #(on-focus (.-id circle))))]
     [:text.soshiki-map-label {:x x :y (- y (* radius 0.81)) :font-size label-size}
      (if (> (count (.-name circle)) 12) (str (subs (.-name circle) 0 11) "…") (.-name circle))]
     (if (and (< depth 3) (> r 20))
       (map-indexed
        (fn [index [kind item]]
          (let [angle (- (* 2 js/Math.PI (/ index (max 1 n))) (/ js/Math.PI 2))
                cx (+ x (* orbit (js/Math.cos angle)))
                cy (+ y (* radius 0.12) (* orbit (js/Math.sin angle)))]
            (if (= kind :circle)
              ^{:key (.-id item)}
              [circle-map state item cx cy r (inc depth) query highlight selected on-select on-focus]
              [:g.soshiki-map-role {:key (.-id item) :data-hl (role-highlight item)
                                    :data-selected (= selected (.-id item))}
               [:circle (merge {:cx cx :cy cy :r (* r 0.94) :role "button" :tab-index 0
                                :data-role (.-id item) :aria-pressed (= selected (.-id item))
                                :aria-label (str (.-name item) " · " (if (.-assignee item)
                                                                      (.-name (.-assignee item)) "空き"))}
                               (activate #(on-select (.-id item))))]
               [:text.soshiki-map-label {:x cx :y cy :font-size (min 18 (* r 0.28))}
                (if (> (count (.-name item)) 10) (str (subs (.-name item) 0 9) "…") (.-name item))]
               [:text.soshiki-map-label.soshiki-map-sub {:x cx :y (+ cy (min 24 (* r 0.4)))
                                                       :font-size (min 12 (* r 0.2))}
                (if (.-assignee item)
                  (let [name (.-name (.-assignee item))]
                    (if (> (count name) 12) (str (subs name 0 11) "…") name))
                  "空きロール")]]))) entries)
       (when (pos? n)
         [:text.soshiki-map-label {:x x :y y :font-size label-size} (str count-roles " ロール · 開く ›")]))]))

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

(defn circle-profile-links [state circle apply-fn set-error catalog loading catalog-error load-catalog]
  (let [[profile-id set-profile-id] (useState "")
        [profile-query set-profile-query] (useState "")
        [bot-id set-bot-id] (useState "")
        members (filter #(.includes (.-circleIds %) (.-id circle)) (.-bots state))
        candidates (filter #(and (.-profileId %) (not (.includes (.-circleIds %) (.-id circle)))) (.-bots state))]
    [:details.soshiki-profile-links
     [:summary (str "Bot profile とサークルを対応づける · " (count members))]
     [:p.muted "この端末の組織情報として保存します。profile の実行設定・権限は変更しません。"]
     [:p.muted "最初に itonami の profiles フォルダを選んでください。このブラウザで一覧を読み、選択したprofileだけを組織情報に保存します。"]
     [:div.soshiki-form
      [:button.soshiki-quiet {:type "button" :disabled loading :on-click #(load-catalog)}
       (if loading "読み込み中…" (if catalog "既存profile一覧を更新" "既存profileのフォルダを選んで一覧を取得"))]
      [:button.soshiki-quiet {:type "button" :disabled loading :on-click #(load-catalog true)} "保存先フォルダを変更"]
      (when catalog-error [:p.net-error {:role "alert"} catalog-error])
      (when catalog
        [:<>
         [:p.muted (str (.-length catalog) " profiles · itonami profile store")]
         [:input.soshiki-search {:aria-label "既存profileを検索" :placeholder "profile ID・説明で検索"
                                 :value profile-query :on-change (fn [event] (set-profile-query (.. event -target -value)) (set-profile-id ""))}]
         [field "既存の itonami bot profile"
          [:select {:aria-label "既存itonami profileを選ぶ" :value profile-id
                    :on-change #(set-profile-id (.. % -target -value))}
           [:option {:value ""} "一覧から選択"]
           (map (fn [profile]
                  [:option {:key (.-id profile) :value (.-id profile)}
                   (str (.-id profile) (when-not (empty? (.-description profile)) (str " · " (.-description profile))))])
                (filter #(matches-query (str (.-id %) " " (.-description %)) profile-query) catalog))]]
         [:button {:type "button" :disabled (or loading (not (.some catalog #(= profile-id (.-id %)))))
                   :on-click (fn []
                     (when-let [profile (.find catalog #(= profile-id (.-id %)))]
                       (let [bot (.find (.-bots state) #(= profile-id (.-profileId %)))
                             name (loop [n 0]
                                    (let [candidate (str profile-id (when (pos? n) (str " · " n)))]
                                      (if (.some (.-bots state) #(= candidate (.-name %))) (recur (inc n)) candidate)))
                             result (if bot
                                      (updateBot state #js {:id (.-id bot) :circleIds (.concat (.-circleIds bot) #js [(.-id circle)])})
                                      (addBot state #js {:name name :profileId profile-id :purpose (.-description profile)
                                                        :skills (.-skills profile) :circleIds #js [(.-id circle)] :approval "ask"}))]
                         (set-error (apply-fn result)))))} "選んだprofileをこのサークルに対応づける"]])]
     [:ul.soshiki-bots
      (map (fn [bot]
             [:li {:key (.-id bot)}
              [:strong (.-name bot)]
              [:p.muted (if (.-profileId bot) (str "itonami / " (.-profileId bot)) "itonami profile 未設定")]
              [:button.soshiki-quiet {:type "button" :aria-label (str (.-name bot) "の直接所属を解除")
                                      :on-click #(set-error (apply-fn (updateBot state #js {:id (.-id bot)
                                        :circleIds (.filter (.-circleIds bot) (fn [id] (not= id (.-id circle))))})))} "直接所属を解除"]]) members)]
     [:p.muted "直接所属を解除しても、担当しているロールは保持されます。"]
     (if (seq candidates)
       [:div.soshiki-row
        [:select {:aria-label "サークルに対応づけるBot profile" :value bot-id
                  :on-change #(set-bot-id (.. % -target -value))}
         [:option {:value ""} "itonami profile を選ぶ"]
         (map (fn [bot] [:option {:key (.-id bot) :value (.-id bot)}
                         (str (.-name bot) " / " (.-profileId bot))]) candidates)]
        [:button {:type "button" :disabled (not (some #(= bot-id (.-id %)) candidates))
                  :on-click (fn []
                    (when-let [bot (some #(when (= bot-id (.-id %)) %) candidates)]
                      (set-error (apply-fn (updateBot state #js {:id bot-id
                        :circleIds (.concat (.-circleIds bot) #js [(.-id circle)])})))
                      (set-bot-id "")))} "このサークルに対応づける"]]
       [:p.muted "未所属の profile はありません。Botタブで登録・ID設定ができます。"])]))

(defn profile-metadata [manifest]
  (let [id (:profile/id manifest)
        description (:profile/description manifest)
        skills (get-in manifest [:bundle :skills])]
    (when (and (map? manifest)
               (contains? #{"cloud.itonami.profile.v1" "cloud.itonami.profile.v2"} (:itonami/schema manifest))
               (= :itonami-agent (get-in manifest [:runtime :engine]))
               (string? id) (re-matches #"^[a-z0-9][a-z0-9_-]{0,63}$" id))
      {:id id :description (if (string? description) (subs description 0 (min 280 (count description))) "")
       :skills (if (and (vector? skills) (every? string? skills))
                 (vec (take 12 (map #(subs % 0 (min 80 (count %))) (remove clojure.string/blank? skills)))) [])})))

(defn profile-import [state apply-fn]
  (let [[draft set-draft] (useState nil)
        [error set-error] (useState nil)
        [circle-id set-circle-id] (useState "")]
    [:section.soshiki-profile-links
     [:h2 "itonami profile を取り込む"]
     [:p.muted "itonami.edn を選ぶと、ID・説明・スキルだけを読み込みます。実行設定や認証情報は保存しません。"]
     [:input {:type "file" :accept ".edn" :aria-label "itonami.edn を選ぶ"
              :on-change (fn [event]
                (set-draft nil) (set-error nil)
                (when-let [file (aget (.. event -target -files) 0)]
                  (if (> (.-size file) 262144)
                    (set-error "ファイルは256KB以下で指定してください。")
                    (-> (.text file)
                        (.then (fn [text]
                          (try
                            (let [manifest (reader/read-string text)
                                  id (:profile/id manifest)
                                  description (:profile/description manifest)
                                  skills (get-in manifest [:bundle :skills])]
                              (if (and (map? manifest)
                                       (contains? #{"cloud.itonami.profile.v1" "cloud.itonami.profile.v2"} (:itonami/schema manifest))
                                       (= :itonami-agent (get-in manifest [:runtime :engine]))
                                       (string? id) (re-matches #"^[a-z0-9][a-z0-9_-]{0,63}$" id))
                                (set-draft {:id id :purpose (if (string? description) (subs description 0 (min 280 (count description))) "")
                                            :skills (if (and (vector? skills) (every? string? skills))
                                                      (vec (take 12 (map #(subs % 0 (min 80 (count %))) (remove empty? skills)))) [])})
                                (set-error "itonami-agent の profile ID / schema / runtime を確認してください。")))
                            (catch :default _ (set-error "itonami.edn を読み取れませんでした。")))))
                        (.catch (fn [_] (set-error "ファイルを読み取れませんでした。")))))))}]
     (when error [:p.net-error {:role "alert"} error])
     (when draft
       [:div.soshiki-form
        [:strong (str "itonami / " (:id draft))]
        [:p.muted (:purpose draft)]
        [field "最初に対応づけるサークル"
         [:select {:aria-label "取り込むprofileのサークル" :value circle-id
                   :on-change #(set-circle-id (.. % -target -value))}
          [:option {:value ""} "あとで指定"]
          (map (fn [circle] [:option {:key (.-id circle) :value (.-id circle)} (.-name circle)]) (.-circles state))]]
        [:button.primary {:type "button" :on-click (fn []
          (let [failed (apply-fn (addBot state #js {:name (:id draft) :profileId (:id draft)
                           :purpose (:purpose draft) :skills (clj->js (:skills draft))
                           :circleIds (if (empty? circle-id) #js [] #js [circle-id]) :approval "ask"}))]
            (set-error (when failed (or (get error-text failed) "登録できませんでした。")))
            (when-not failed (set-draft nil))))} "Bot profile を登録"]])]))

(defn chart-view [state apply-fn set-error focus-id on-focus query highlight selected-role-id on-select-role bot-names me catalog loading catalog-error load-catalog]
  (let [[view set-view] (useState "chart")
        roots (childrenOf state nil)
        focus (or (.find (.-circles state) #(= (.-id %) focus-id)) (aget (.-circles state) 0))
        path (if focus (circlePath state (.-id focus)) #js [])
        roles (if focus (filter #(matching-role? state % query highlight)
                                (subtreeRoles state (.-id focus))) [])
        selected (.find (.-roles state) #(= (.-id %) selected-role-id))
        members (if focus
                  (distinct (concat
                    (keep #(some-> % (.-assignee) (.-name)) (rolesOf state (.-id focus)))
                    (map #(.-name %) (filter #(.includes (.-circleIds %) (.-id focus)) (.-bots state))))) [])]
    [:section.soshiki-explorer {:aria-label "組織の探索"}
     [:div.soshiki-explorer-head
      [:nav.soshiki-crumb {:aria-label "サークルのパンくず"}
       (map-indexed
        (fn [index circle]
          [:span {:key (.-id circle)}
           (when (pos? index) [:span {:aria-hidden "true"} " / "])
           [:button.soshiki-crumb-link {:type "button" :aria-current (when (= index (dec (.-length path))) "page")
                                        :on-click #(on-focus (.-id circle))} (.-name circle)]]) path)]
      [:div.soshiki-legend {:role "group" :aria-label "表示方法"}
       (map (fn [[id label]]
              [:button.soshiki-legend-btn {:key id :type "button" :aria-pressed (= view id)
                                           :on-click #(set-view id)} label])
            [["chart" "サークル図"] ["roles" "ロール一覧"]])]]
     (when (> (.-length roots) 1)
       [:label.soshiki-field "全体サークル"
        [:select {:aria-label "全体サークル" :value (some-> (aget path 0) (.-id))
                  :on-change #(on-focus (.. % -target -value))}
         (map (fn [root] [:option {:key (.-id root) :value (.-id root)} (.-name root)]) roots)]])
     (if-not focus
       [:p.muted "サークルはまだありません。下の編集から作れます。"]
       [:div {:data-chart-focus (.-id focus)}
        [:p.soshiki-purpose (.-purpose focus)]
        (when (seq members)
          [:p.muted (str "メンバー · " (clojure.string/join " / " members))])
        [:nav.soshiki-legend {:aria-label "子サークル"}
         (map (fn [child]
                [:button.soshiki-legend-btn {:key (.-id child) :type "button"
                                             :on-click #(on-focus (.-id child))}
                 (str (.-name child) " ›")])
              (filter #(branch-matches state % query highlight) (childrenOf state (.-id focus))))]
        [:f> circle-profile-links state focus apply-fn set-error catalog loading catalog-error load-catalog]
        [:p.muted {:role "status"} (str (count roles) " ロール")]
        [:div.soshiki-explorer-layout {:data-detail (boolean selected)}
         [:div.soshiki-map-stage
          (if (= view "chart")
            [:<>
             [:svg.soshiki-map {:view-box "0 0 900 840" :role "group" :aria-label "サークル組織図"}
              [circle-map state focus 450 420 395 0 query highlight selected-role-id on-select-role on-focus]]
             [:p.muted "サークルを選んで拡大、ロールを選んで詳細を表示。円の大きさは人数を表しません。"]]
            [:ul.soshiki-rolegrid
             (map (fn [role]
                    [:li {:key (.-id role)}
                     [:button.soshiki-rolecard {:type "button" :data-role (.-id role)
                                                :aria-pressed (= selected-role-id (.-id role))
                                                :on-click #(on-select-role (.-id role))}
                      [:span.hl-dot {:data-hl (role-highlight role) :aria-hidden "true"}]
                      [:strong (.-name role)]
                      [:span.muted (if (.-assignee role) (.-name (.-assignee role)) "空きロール")]
                      [:span.soshiki-rolecard-purpose (.-purpose role)]]]) roles)])
          (when (and (zero? (count roles)) (or (not (empty? query)) (not= highlight "all")))
            [:p.soshiki-empty {:role "status"} "条件に合うロールはありません。検索や絞り込みを変更してください。"])]
         (when selected
           [:aside.soshiki-inspector {:aria-label "ロール詳細"}
            [:button.soshiki-quiet {:type "button" :on-click (fn []
                        (when-let [trigger (.querySelector js/document (str "[data-role='" selected-role-id "']"))]
                          (.focus trigger))
                        (on-select-role nil))} "詳細を閉じる"]
            [:f> role-detail state selected apply-fn set-error bot-names me]])]])]))

(defn chart-tab [state apply-fn me score method on-account catalog loading catalog-error load-catalog]
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
                                 :on-change (fn [event] (set-query (.. event -target -value)) (set-selected-role-id nil))}]
        [:div.soshiki-legend {:role "group" :aria-label "ハイライト絞り込み"}
         (map (fn [item]
                 [:button {:key (.-id item)
                            :type "button"
                            :class (if (= highlight (.-id item))
                                     "soshiki-legend-btn active" "soshiki-legend-btn")
                            :aria-pressed (= highlight (.-id item))
                            :data-highlight (.-id item)
                            :on-click (fn [] (set-highlight (.-id item)) (set-selected-role-id nil))}
                  (when-not (= "all" (.-id item))
                    [:span.hl-dot {:data-hl (.-id item) :aria-hidden "true"}])
                  (.-label item)]) highlights)
         (when (or (not (empty? query)) (not= highlight "all"))
           [:button.soshiki-legend-btn {:type "button" :on-click (fn [] (set-query "") (set-highlight "all")
                                                                       (set-selected-role-id nil))} "条件をクリア"])]]
       [:f> chart-view state apply-fn set-error focus-id on-focus query highlight
        selected-role-id set-selected-role-id bot-names me catalog loading catalog-error load-catalog]
       [:details.soshiki-edit
        [:summary "組織を編集・提案する"]
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
        [:button.primary {:type "submit"} "提案する"]]]])))

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
                                      :approval (.-approval bot)
                                      :profile-id (or (.-profileId bot) "")
                                      :circle-ids (set (.-circleIds bot))})
                            failed (apply-fn (updateBot state #js {:id (.-id bot)
                                                                    :purpose (or (:purpose edit)
                                                                                 (.-purpose bot))
                                                                    :skills (parseList (or (:skills edit) ""))
                                                                    :approval (or (:approval edit) (.-approval bot))
                                                                    :profileId (when-not (empty? (:profile-id edit)) (:profile-id edit))
                                                                    :circleIds (clj->js (vec (:circle-ids edit)))}))]
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
       [:f> profile-import state apply-fn]
       [:h2 "Botプロフィール"]
       (when (zero? (.-length (.-bots state)))
         [:p.muted "Botはまだ登録されていません。"])
       [:ul.soshiki-bots
        (map (fn [bot]
                (let [edit (or (get edits (.-id bot))
                               {:purpose (.-purpose bot)
                                :skills (.join (.-skills bot) ", ")
                                :approval (.-approval bot)
                                      :profile-id (or (.-profileId bot) "")
                                      :circle-ids (set (.-circleIds bot))})]
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
                   [:p.muted (if (.-profileId bot) (str "itonami / " (.-profileId bot)) "itonami profile 未設定")]
                   [:div.soshiki-form
                    [field "itonami profile ID（空欄で対応解除）"
                     [:input {:aria-label (str (.-name bot) "のitonami profile ID")
                              :value (:profile-id edit)
                              :placeholder "例: manimani"
                              :on-change #(set-edits (fn [current] (assoc current (.-id bot)
                                                                        (assoc edit :profile-id (.. % -target -value)))))}]]
                    [:fieldset.soshiki-membership
                     [:legend "対応づけるサークル（複数選択可）"]
                     (map (fn [circle]
                            [:label {:key (.-id circle)}
                             [:input {:type "checkbox" :checked (contains? (:circle-ids edit) (.-id circle))
                                      :aria-label (str (.-name bot) "の所属: " (.-name circle))
                                      :on-change (fn [event]
                                        (let [checked (.. event -target -checked)]
                                          (set-edits (fn [current]
                                            (assoc current (.-id bot) (update edit :circle-ids
                                              (if checked conj disj) (.-id circle)))))))}]
                             (.-name circle)]) (.-circles state))]
                    [:p.muted "IDは手動の参照、または取り込んだメタデータです。稼働・接続の確認や実行許可を表しません。"]
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

(defn soshiki [account score on-account]
  (let [[state apply-fn save-failed] (use-soshiki)
        [tab set-tab] (useState "chart")
        [catalog set-catalog] (useState nil)
        [loading set-loading] (useState false)
        [catalog-error set-catalog-error] (useState nil)
        load-catalog (fn [& [choose-new]]
          (set-loading true) (set-catalog-error nil)
          (-> (readProfileManifests #js {:chooseNew (= true choose-new)})
              (.then (fn [manifests]
                (let [profiles (keep (fn [entry]
                                      (try
                                        (let [profile (profile-metadata (reader/read-string (.-text entry)))]
                                          (when (= (:id profile) (.-directory entry)) profile))
                                        (catch :default _ nil))) manifests)]
                  (set-catalog (clj->js (vec (sort-by :id profiles)))))))
              (.catch (fn [_] (set-catalog-error "一覧を読み込めませんでした。Chrome / Chromium で itonami の profiles フォルダ（または .itonami）を選んでください。キャンセルした場合は変更されません。")))
              (.finally (fn [] (set-loading false)))))
        [manimani] (use-manimani)
        agents (or (some-> manimani (.-agents)) #js [])
        me (personNameForAccount (some-> account (.-accountDid)))
        method (some-> account (.-method))]
    (let [score (or score 0)]
      [:main.chat.net-view {:data-soshiki true}
       [:div.net-body.soshiki-body
        [:h1 "Soshiki"]
        [:p.muted "サークルとロールで組織を作り、Botにプロフィールを持たせる。すべてこのデバイスに保存します。"]
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
          [:f> chart-tab state apply-fn me score method on-account catalog loading catalog-error load-catalog])
        (when (= tab "bots")
          [:f> bots-tab state apply-fn agents])
        (when (= tab "size")
          [:f> size-tab state])]])))
