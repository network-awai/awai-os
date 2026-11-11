(ns soshiki.core
  "Soshiki organization logic as pure functions over its state. No I/O and no
  clock of its own: proposals take now as an argument, and persistence
  (localStorage in the shell) lives outside this namespace.

  This mirrors shell/src/soshiki.js value for value so the two stay
  comparable: same error strings, same id prefixes, same limits, same seed.
  Map keys are keywords here; the JS twin uses the same names as strings.
  No reader conditionals, only clojure.string, so Babashka, JVM Clojure and
  the Kotoba oracle all read this file as is."
  (:require [clojure.string :as str]))

(def version 1)
(def max-name 80)
(def max-purpose 280)
(def max-items 12)
(def max-item 80)

(defn- clean-line [value]
  (if (string? value) (str/trim value) ""))

(defn name-error [value]
  (let [text (clean-line value)]
    (when (or (empty? text) (< max-name (count text))) "bad-name")))

(defn purpose-error
  ([value] (purpose-error value {}))
  ([value {:keys [required] :or {required true}}]
   (let [text (clean-line value)]
     (when (or (and required (empty? text)) (< max-purpose (count text))) "bad-purpose"))))

(defn- list-error [items]
  (when (or (not (sequential? items))
            (< max-items (count items))
            (some (fn [item] (let [text (clean-line item)]
                               (or (empty? text) (< max-item (count text))))) items))
    "bad-list"))

(defn parse-list
  "\"a, b, c\" -> [\"a\" \"b\" \"c\"]. Used by the role/bot forms."
  [value]
  (if (sequential? value)
    (vec (remove empty? (map clean-line value)))
    (vec (remove empty? (map str/trim (str/split (clean-line value) #",|、|\n"))))))

(defn- fresh-id [state prefix]
  (let [next (let [n (:next-id state)] (if (and (integer? n) (pos? n)) n 1))]
    [(str prefix next) (assoc state :next-id (inc next))]))

(defn blank-state []
  {:version version :next-id 1 :circles [] :roles [] :bots [] :proposals []})

(defn circle-by-id [state id]
  (first (filter #(= id (:id %)) (:circles state))))

(defn- descendants-of [state id]
  (let [children (filter #(= id (:parent-id %)) (:circles state))]
    (vec (mapcat (fn [child] (cons (:id child) (descendants-of state (:id child)))) children))))

(defn children-of [state parent-id]
  (filterv #(= parent-id (:parent-id %)) (:circles state)))

(defn roles-of [state circle-id]
  (filterv #(= circle-id (:circle-id %)) (:roles state)))

(defn subtree-roles
  "All roles in the circle and its descendants, for nested rendering."
  [state circle-id]
  (let [ids (loop [seen [circle-id] i 0]
              (if (< i (count seen))
                (recur (into seen (map :id (children-of state (nth seen i)))) (inc i))
                seen))
        wanted (set ids)]
    (filterv #(contains? wanted (:circle-id %)) (:roles state))))

(defn circle-path
  "Root-to-circle breadcrumb for the zoomable chart. Unknown ids give []."
  [state id]
  (let [by-id (into {} (map (juxt :id identity) (:circles state)))]
    (loop [current (get by-id id) path [] guard 0]
      (cond
        (nil? current) (if (empty? path) [] path)
        (< (count (:circles state)) guard) []
        :else (recur (when (:parent-id current) (get by-id (:parent-id current)))
                      (vec (cons current path))
                      (inc guard))))))

(defn- check-assignee [assignee]
  (when (or (nil? assignee)
            (not (map? assignee))
            (not (contains? #{"bot" "person"} (:kind assignee)))
            (name-error (:name assignee)))
    "bad-assignee"))

(defn- normalize-assignee [assignee]
  (when assignee {:kind (:kind assignee) :name (clean-line (:name assignee))}))

(defn- link-bot-role [state bot-name role-id circle-id]
  (update state :bots
          (fn [bots]
            (mapv (fn [bot]
                    (if (= (:name bot) bot-name)
                      (-> bot
                          (update :role-ids (fn [ids] (if (some #{role-id} ids) ids (conj (vec ids) role-id))))
                          (update :circle-ids (fn [ids] (if (some #{circle-id} ids) ids (conj (vec ids) circle-id)))))
                      bot))
                  bots))))

(defn add-circle [state {:keys [name purpose parent-id]}]
  (cond
    (name-error name) {:error "bad-name"}
    (purpose-error purpose) {:error "bad-purpose"}
    (and (some? parent-id) (nil? (circle-by-id state parent-id))) {:error "unknown-parent"}
    :else (let [[id state] (fresh-id state "c")]
            {:state (update state :circles conj {:id id :name (clean-line name)
                                                 :purpose (clean-line purpose) :parent-id parent-id})})))

(defn move-circle [state {:keys [id parent-id]}]
  (let [circle (circle-by-id state id)]
    (cond
      (nil? circle) {:error "unknown-circle"}
      (= parent-id id) {:error "bad-parent"}
      (and (some? parent-id) (nil? (circle-by-id state parent-id))) {:error "unknown-parent"}
      (and (some? parent-id) (boolean (some #{parent-id} (descendants-of state id)))) {:error "bad-parent"}
      :else {:state (update state :circles
                            (fn [circles] (mapv #(if (= id (:id %)) (assoc % :parent-id parent-id) %) circles)))})))

(defn remove-circle [state id]
  (cond
    (nil? (circle-by-id state id)) {:error "unknown-circle"}
    (boolean (some #(= id (:parent-id %)) (:circles state))) {:error "circle-has-children"}
    (boolean (some #(= id (:circle-id %)) (:roles state))) {:error "circle-not-empty"}
    :else {:state (-> state
                      (update :circles (fn [circles] (filterv #(not (= id (:id %))) circles)))
                      (update :bots (fn [bots] (mapv #(update % :circle-ids (fn [ids] (filterv (fn [c] (not (= c id))) ids))) bots))))}))

(defn add-role [state {:keys [circle-id name purpose accountabilities skills metric assignee]
                       :or {accountabilities [] skills [] metric ""}}]
  (let [assignee-error (when (some? assignee) (check-assignee assignee))]
    (cond
      (nil? (circle-by-id state circle-id)) {:error "unknown-circle"}
      (name-error name) {:error "bad-name"}
      (purpose-error purpose) {:error "bad-purpose"}
      (list-error accountabilities) {:error "bad-list"}
      (list-error skills) {:error "bad-list"}
      (< max-item (count (clean-line metric))) {:error "bad-metric"}
      assignee-error {:error assignee-error}
      :else (let [[id state] (fresh-id state "r")
                  state (update state :roles conj {:id id :circle-id circle-id
                                                   :name (clean-line name) :purpose (clean-line purpose)
                                                   :accountabilities (mapv clean-line accountabilities)
                                                   :skills (mapv clean-line skills)
                                                   :metric (clean-line metric)
                                                   :assignee (normalize-assignee assignee)})]
              {:state (if (= "bot" (:kind assignee))
                        (link-bot-role state (:name assignee) id circle-id)
                        state)}))))

(defn assign-role [state {:keys [role-id assignee]}]
  (let [role (first (filter #(= role-id (:id %)) (:roles state)))
        assignee-error (when (some? assignee) (check-assignee assignee))]
    (cond
      (nil? role) {:error "unknown-role"}
      assignee-error {:error assignee-error}
      :else (let [previous (when (= "bot" (:kind (:assignee role))) (:name (:assignee role)))
                  state (update state :roles
                                 (fn [roles] (mapv #(if (= role-id (:id %))
                                                      (assoc % :assignee (normalize-assignee assignee)) %) roles)))
                  state (if previous
                          (update state :bots
                                  (fn [bots] (mapv #(if (= (:name %) previous)
                                                      (update % :role-ids (fn [ids] (filterv (fn [r] (not (= r role-id))) ids)))
                                                      %) bots)))
                          state)]
              {:state (if (= "bot" (:kind assignee))
                        (link-bot-role state (:name assignee) role-id (:circle-id role))
                        state)}))))

(defn remove-role [state id]
  (if-let [role (first (filter #(= id (:id %)) (:roles state)))]
    {:state (-> state
                (update :roles (fn [roles] (filterv #(not (= id (:id %))) roles)))
                (update :bots (fn [bots] (mapv #(update % :role-ids (fn [ids] (filterv (fn [r] (not (= r id))) ids))) bots))))}
    {:error "unknown-role"}))

(defn add-bot [state {:keys [name purpose skills circle-ids role-ids approval]
                      :or {purpose "" skills [] circle-ids [] role-ids [] approval "ask"}}]
  (cond
    (name-error name) {:error "bad-name"}
    (purpose-error purpose {:required false}) {:error "bad-purpose"}
    (list-error skills) {:error "bad-list"}
    (not (contains? #{"auto" "ask"} approval)) {:error "bad-approval"}
    (boolean (some #(= (clean-line name) (:name %)) (:bots state))) {:error "bot-exists"}
    (boolean (some #(nil? (circle-by-id state %)) circle-ids)) {:error "unknown-circle"}
    (boolean (some (fn [role-id] (nil? (first (filter #(= role-id (:id %)) (:roles state))))) role-ids)) {:error "unknown-role"}
    :else (let [[id state] (fresh-id state "b")]
            {:state (update state :bots conj {:id id :name (clean-line name) :purpose (clean-line purpose)
                                              :skills (mapv clean-line skills)
                                              :circle-ids (vec (distinct circle-ids))
                                              :role-ids (vec (distinct role-ids))
                                              :approval approval})})))

(defn update-bot [state {:keys [id] :as changes}]
  (if-let [bot (first (filter #(= id (:id %)) (:bots state)))]
    (let [next (cond-> bot
                 (contains? changes :purpose)
                 (assoc :purpose (clean-line (:purpose changes)))
                 (contains? changes :skills)
                 (assoc :skills (mapv clean-line (:skills changes)))
                 (contains? changes :approval)
                 (assoc :approval (:approval changes))
                 (contains? changes :circle-ids)
                 (assoc :circle-ids (vec (distinct (:circle-ids changes)))))]
      (cond
        (and (contains? changes :purpose) (purpose-error (:purpose next) {:required false})) {:error "bad-purpose"}
        (and (contains? changes :skills) (list-error (:skills next))) {:error "bad-list"}
        (and (contains? changes :approval) (not (contains? #{"auto" "ask"} (:approval next)))) {:error "bad-approval"}
        (and (contains? changes :circle-ids)
             (boolean (some #(nil? (circle-by-id state %)) (:circle-ids next)))) {:error "unknown-circle"}
        :else {:state (update state :bots
                               (fn [bots] (mapv #(if (= id (:id %)) next %) bots)))}))
    {:error "unknown-bot"}))

(defn remove-bot [state id]
  (if-let [bot (first (filter #(= id (:id %)) (:bots state)))]
    {:state (-> state
                (update :bots (fn [bots] (filterv #(not (= id (:id %))) bots)))
                (update :roles (fn [roles] (mapv #(if (and (= "bot" (:kind (:assignee %)))
                                                             (= (:name bot) (:name (:assignee %))))
                                                        (assoc % :assignee nil) %) roles))))}
    {:error "unknown-bot"}))

(defn add-proposal
  "Takes now as an argument: this namespace keeps no clock."
  [state now {:keys [title detail] :or {detail ""}}]
  (cond
    (name-error title) {:error "bad-name"}
    (< max-purpose (count (clean-line detail))) {:error "bad-purpose"}
    :else (let [[id state] (fresh-id state "p")]
            {:state (update state :proposals conj {:id id :title (clean-line title)
                                                   :detail (clean-line detail) :status "open" :at now})})))

(defn decide-proposal [state {:keys [id accept]}]
  (let [proposal (first (filter #(= id (:id %)) (:proposals state)))]
    (cond
      (nil? proposal) {:error "unknown-proposal"}
      (not (= "open" (:status proposal))) {:error "proposal-closed"}
      :else {:state (update state :proposals
                             (fn [proposals] (mapv #(if (= id (:id %))
                                                      (assoc % :status (if accept "accepted" "rejected")) %) proposals)))})))

(defn- depth-of [by-id id]
  (loop [depth 0 current (get by-id id)]
    (if-let [parent (and current (:parent-id current))]
      (if (< 100 depth)
        depth
        (recur (inc depth) (get by-id parent)))
      depth)))

(defn compute-size
  "Totals plus one row per circle with subtree sums. Members are distinct
  assignee names across roles plus direct bot memberships."
  [state]
  (let [by-id (into {} (map (juxt :id identity) (:circles state)))
        subtree-ids (fn [id] (cons id (descendants-of state id)))
        in-subtree (fn [ids role] (boolean (some #{(:circle-id role)} ids)))
        member-names (fn [roles bots]
                       (into #{}
                             (concat (keep #(-> % :assignee :name) roles)
                                     (map :name bots))))
        rows (mapv (fn [circle]
                     (let [direct (roles-of state (:id circle))
                           filled (count (filter :assignee direct))
                           sub-ids (subtree-ids (:id circle))
                           sub (filterv (partial in-subtree sub-ids) (:roles state))
                           direct-bots (filterv #(boolean (some #{(:id circle)} (:circle-ids %))) (:bots state))
                           sub-bots (filterv #(boolean (some (set sub-ids) (:circle-ids %))) (:bots state))]
                       {:id (:id circle) :name (:name circle) :depth (depth-of by-id (:id circle))
                        :direct-roles (count direct) :filled filled :open (- (count direct) filled)
                        :fill-rate (when (pos? (count direct)) (/ filled (count direct)))
                        :direct-members (count (member-names direct direct-bots))
                        :subtree-roles (count sub)
                        :subtree-members (count (member-names sub sub-bots))}))
                   (:circles state))
        filled (count (filter :assignee (:roles state)))
        people (->> (:roles state) (keep :assignee) (filter #(= "person" (:kind %))) (map :name) distinct count)]
    {:totals {:circles (count (:circles state)) :roles (count (:roles state))
              :filled filled :open (- (count (:roles state)) filled)
              :bots (count (:bots state)) :people people
              :proposals-open (count (filter #(= "open" (:status %)) (:proposals state)))}
     :max-depth (reduce max 0 (map :depth rows))
     :rows (vec (sort-by (juxt (comp - :subtree-roles) :name) rows))}))

(defn person-name-for-account
  "The signed-in person, shown as the owner in the chart. Same shortening as
  the shell sidebar. Nil when signed out."
  [account-did]
  (let [did (clean-line account-did)]
    (when (not (empty? did))
      (if (< 26 (count did)) (str (subs did 0 14) "…" (subs did (- (count did) 8))) did))))

(defn my-roles
  "Holaspirit-style \"My Roles\": roles held by the named person."
  [state person-name]
  (if (empty? person-name)
    []
    (filterv #(and (= "person" (:kind (:assignee %))) (= person-name (:name (:assignee %)))) (:roles state))))

(defn seed-state []
  (let [add (fn [state result]
              (when (:error result) (throw (ex-info "bad seed" result)))
              (:state result))
        s0 (blank-state)
        s1 (add s0 (add-circle s0 {:name "全体サークル" :purpose "このデバイスの仕事をサークルとロールで回す" :parent-id nil}))
        general (:id (first (:circles s1)))
        s2 (add s1 (add-circle s1 {:name "くらし" :purpose "暮らしの見守りと記録" :parent-id general}))
        s3 (add s2 (add-circle s2 {:name "しごと" :purpose "仕事の記録と予定" :parent-id general}))
        kurashi (:id (first (filter #(= "くらし" (:name %)) (:circles s3))))
        shigoto (:id (first (filter #(= "しごと" (:name %)) (:circles s3))))
        s4 (add s3 (add-role s3 {:circle-id general :name "リードリンク" :purpose "全体の目的を保ち、サークルをつなぐ"
                                 :accountabilities ["サークルの目的を言葉にする" "空きロールを見つけて埋める"]
                                 :skills ["facilitation"] :metric "空きロールの数"}))
        s5 (add s4 (add-role s4 {:circle-id kurashi :name "見守り" :purpose "暮らしのリズムを見守る"
                                 :accountabilities ["異変に気づいて知らせる"] :skills ["monitoring"]
                                 :assignee {:kind "bot" :name "Manimani"}}))
        s6 (add s5 (add-role s5 {:circle-id shigoto :name "記録係" :purpose "仕事の記録を残す"
                                 :accountabilities ["予定と記録を残す"] :skills ["notes"]}))
        s7 (add s6 (add-bot s6 {:name "Manimani" :purpose "このデバイスで動き、他のエージェントを調整する"
                                :skills ["schedule" "memory" "approvals"]
                                :circle-ids [general kurashi] :approval "auto"}))
        mimamori (first (filter #(= "見守り" (:name %)) (:roles s7)))
        manimani (first (filter #(= "Manimani" (:name %)) (:bots s7)))]
    (if (some #{(:id mimamori)} (:role-ids manimani))
      s7
      (update s7 :bots (fn [bots] (mapv #(if (= (:id %) (:id manimani))
                                              (update % :role-ids conj (:id mimamori)) %) bots))))))

(defn- valid-shape? [state]
  (and (map? state)
       (= version (:version state))
       (sequential? (:circles state))
       (sequential? (:roles state))
       (sequential? (:bots state))
       (sequential? (:proposals state))))

(defn settle-soshiki [saved]
  (if (valid-shape? saved)
    (merge (blank-state) saved {:version version})
    (seed-state)))
