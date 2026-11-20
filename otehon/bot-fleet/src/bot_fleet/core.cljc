(ns bot-fleet.core
  "Otehon organization and work bindings. No I/O, inference or authority grants."
  (:require [clojure.string :as str]))

(def execution-contract
  {:kind "itonami.distributed-execution.v1"
   :substrate "itonami-distributed" :adapter "awai-node"
   :authority "per-occurrence" :storage "awai-fs"
   :required ["verified-node-membership" "atomic-occurrence-admission"
              "durable-cursor" "fenced-effects" "unknown-reconciliation"]
   :inference {:executor "muse" :provider "meta" :fallback false}})

(defn runtime-problem
  "Configuration compatibility only, never an admission/lease proof. The owning
  Awai node must verify membership, atomically admit the occurrence and fence effects."
  [runtime]
  (cond
    (not= "itonami-distributed" (:substrate runtime)) "distributed-substrate-required"
    (not= "awai-node" (:adapter runtime)) "awai-node-adapter-required"
    (not= "per-occurrence" (:authority runtime)) "occurrence-authority-required"
    :else nil))

(defn pinned? [manifest]
  (let [p (:profile manifest)]
    (and (= "profile" (:type manifest))
         (string? (:id manifest))
         (boolean (re-matches #"[A-Za-z0-9._-]+" (:id manifest)))
         (string? (:repository p))
         (boolean (re-matches #"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+" (:repository p)))
         (string? (:commit p))
         (boolean (re-matches #"[0-9a-f]{40}" (:commit p)))
         (string? (:checksum p))
         (boolean (re-matches #"sha256-tree:[0-9a-f]{64}" (:checksum p))))))

(defn linear-binding [repository projects issues & [aliases]]
  ;; Exact repository names only. Renames and ambiguous matches need reconciliation.
  (let [alias (get aliases repository)
        canonical (or (:repository alias) repository)
        matches (filter #(= canonical (:name %)) projects)
        project (when (= 1 (count matches)) (first matches))
        initiative (when (= 1 (count (:initiatives project))) (first (:initiatives project)))
        candidates (filter #(= (:uuid project) (:projectId %)) issues)]
    {:state (if (and project initiative) "bound" "needs-reconciliation")
     :source-repository repository :repository canonical :alias alias
     :project project :initiative initiative
     :issues (if project (vec candidates) [])}))

(defn catalog [manifests projects issues registry-revision & [aliases]]
  (when-not (and (string? registry-revision) (re-matches #"[0-9a-f]{40}" registry-revision))
    (throw (ex-info "immutable registry revision required" {})))
  (when-not (every? pinned? manifests)
    (throw (ex-info "invalid profile pin" {})))
  (when-not (= (count manifests) (count (distinct (map :id manifests))))
    (throw (ex-info "duplicate profile identity" {})))
  (let [repos (sort (distinct (map #(get-in % [:profile :repository]) manifests)))
        circle-id #(str "repo:" %)
        circles (into [{:id "fleet" :name "Itonami Bot Fleet"
                         :purpose "Coordinate registered bot roles and verified work" :parent-id nil}]
                      (map (fn [repo] {:id (circle-id repo) :name repo
                                      :purpose "Maintain the source repository and its bot roles"
                                      :parent-id "fleet"}) repos))
        bots (mapv (fn [m]
                     (let [repo (get-in m [:profile :repository]) id (:id m)]
                       {:id (str "profile:" id) :name id :purpose (:description m)
                        :skills [] :circle-ids [(circle-id repo)] :role-ids [(str "role:" id)]
                        :approval "ask" :profile (:profile m)
                        :linear (linear-binding repo projects issues aliases)
                        :schedule {:state "unresolved" :enabled false
                                   :source (first (filter #(= "cron/jobs.json" (:path %))
                                                          (get-in m [:profile :files])))}
                        :runtime {:state "not-started" :owner nil :grants []
                                  :substrate "itonami-distributed" :adapter "awai-node"
                                  :authority "per-occurrence"}}))
                   (sort-by :id manifests))]
    {:schema "awai.bot-fleet.v1" :registry-revision registry-revision
     :execution-contract execution-contract
     :organization {:version 1 :next-id 1 :circles circles
                    :roles (mapv (fn [bot] {:id (first (:role-ids bot))
                                           :circle-id (first (:circle-ids bot)) :name (:name bot)
                                           :purpose (:purpose bot) :accountabilities ["Record verified work in Linear"]
                                           :skills [] :metric "Verified acceptance units per stated interval"
                                           :assignee {:kind "bot" :name (:name bot)}}) bots)
                    :bots bots :proposals []}}))

(defn bind-run
  "A run requires an explicit selected issue and immutable revision. Catalog membership
  alone does not select work, acquire execution ownership or authorize tools."
  [bot {:keys [issue-id run-id revision acceptance-unit] :as binding}]
  (cond
    (not= "bound" (get-in bot [:linear :state])) {:error "linear-unresolved"}
    (not (some #(= issue-id (:id %)) (get-in bot [:linear :issues]))) {:error "issue-outside-project"}
    (some #(and (= issue-id (:id %)) (contains? #{"Done" "Canceled" "Cancelled" "Duplicate"} (:status %)))
          (get-in bot [:linear :issues])) {:error "issue-already-closed"}
    (not (and (string? run-id) (not (str/blank? run-id))
              (string? revision) (re-matches #"[0-9a-f]{40}" revision)
              (string? acceptance-unit) (not (str/blank? acceptance-unit)))) {:error "incomplete-binding"}
    :else {:binding (assoc binding :bot-id (:id bot)
                          :project-id (get-in bot [:linear :project :uuid])
                          :initiative-id (get-in bot [:linear :initiative :id]))}))

(defn schedule-eligible?
  "Only an individually reconciled schedule with an explicit runtime owner is eligible.
  Eligibility is not a lease, execution authorization, or a cron implementation."
  [bot]
  (and (= "bound" (get-in bot [:linear :state]))
       (nil? (runtime-problem (:runtime bot)))
       (= "verified" (get-in bot [:schedule :state]))
       (true? (get-in bot [:schedule :enabled]))
       (string? (get-in bot [:runtime :owner]))
       (not (str/blank? (get-in bot [:runtime :owner])))))
