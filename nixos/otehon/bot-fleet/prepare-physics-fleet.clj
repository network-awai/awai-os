;; Plan first, then operator enrollment of the supported simulation-only subset.
;; Source schedules, scripts, Hermes state and original growth/land remain intact.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str] '[clojure.java.io :as io]
 '[cheshire.core :as json] '[bot-fleet.daily :as daily] '[itonami.otehon.physics.runner :as physics]
 '[itonami.otehon.bundle :as b] '[itonami.otehon.occurrence :as o] '[itonami.otehon.job-contract :as c]
 '[itonami.otehon.etcd :as e] '[itonami.otehon.recurring-host :as h])
(let [[mode catalog-path input-dir source-repo runtime] *command-line-args*
      _ (assert (and runtime (contains? #{"plan" "prepare"} mode)) "plan/prepare CATALOG SPEC_DIR SOURCE_REPO NEW_CAPSULE")
      catalog (json/parse-string (slurp catalog-path) true) inventory (json/parse-string (slurp (str input-dir "/inventory.json")) true)
      _ (assert (= (:catalogSha256 inventory) (e/binary-sha catalog-path)) "physics inventory/catalog mismatch")
      by-id (into {} (map (juxt :id identity) (get-in catalog [:organization :bots])))
      now (System/currentTimeMillis)
      rows
      (mapv (fn [r]
        (let [bot (get by-id (:botId r)) src (first (filter #(str/ends-with? (:name %) "-measure") (get-in bot [:schedule :jobs])))
              issue (first (remove #(contains? #{"Done" "Canceled" "Cancelled" "Duplicate"} (:status %)) (get-in bot [:linear :issues])))
              base {:botId (:id bot) :sourceJobId (:id src) :sourceProfile (select-keys (:profile bot) [:repository :commit :checksum]) :repository (:repository r)}]
          (try
            (when-not (and (= "verified-public" (:state r)) (= (:commit r) (get-in bot [:profile :commit]))
                         (= (:repository r) (get-in bot [:profile :repository]))
                         (= "bound" (get-in bot [:linear :state])) (= "verified" (get-in bot [:schedule :state]))
                         (true? (:sourceEnabled src)) (not (:paused src)) (:uuid issue))
              (throw (ex-info "source or work binding unqualified" {})))
            (let [compiled (daily/compile-daily src now) file (str (:name bot) "-" (:sha256 r) ".edn")
                  _ (when-not (= file (:file r)) (throw (ex-info "source file mismatch" {}))) path (str input-dir "/" file)
                  _ (when-not (and (<= (.length (io/file path)) 65536) (= (:sha256 r) (e/binary-sha path)))
                      (throw (ex-info "source digest mismatch" {})))
                  spec (edn/read-string {:readers {} :default (fn [_ _] (throw (ex-info "tagged spec" {})))} (slurp path))
                  _ (physics/validate! spec (:repository r))]
              (assoc base :state "eligible" :bot bot :src src :issue issue :compiled compiled :spec-file path :spec-sha (:sha256 r)
                          :kinds (vec (sort (distinct (map (comp name :kind) (:cases spec)))))))
            (catch Exception _ (assoc base :state "held" :reason (if (= "verified-public" (:state r)) "scope-or-solver-budget-unqualified" (:state r))))))) (:rows inventory))
      eligible (filterv #(= "eligible" (:state %)) rows)
      public-row #(dissoc % :bot :src :issue :compiled :spec-file)
      report {:schema "awai.physics-rollout-plan.v1" :observedAt (str (java.time.Instant/now))
              :catalogSha256 (:catalogSha256 inventory) :scope "pinned-otehon-simulation-only" :sourceBots (count rows)
              :eligible (count eligible) :held (- (count rows) (count eligible)) :rows (mapv public-row rows)}]
 (if (= "plan" mode) (println (json/generate-string report))
  (let [home (System/getProperty "user.home") root (str home "/.itonami/bot-fleet/awai-2809-physics-v1")
        ctrl (str home "/.itonami/control-plane/etcd/awai-bots-v1")
        _ (assert (seq eligible) "no qualified physics specs")
        _ (doseq [p (concat [root runtime] (map #(str home "/.itonami/profiles/" (get-in % [:bot :name])) eligible))]
            (assert (not (.exists (io/file p))) "preserve existing profile/deployment; reconcile"))
        command! (fn [& argv] (let [r (apply sh/sh (concat argv [:in ""]))] (assert (zero? (:exit r))) (str/trim (:out r))))
        revision (command! "git" "-C" source-repo "rev-parse" "HEAD")
        orca (command! "which" "orca") bb (command! "which" "bb") bb-sha (e/binary-sha bb)
        _ (h/private-dir! root) _ (h/private-dir! runtime) archive (str root "/source.tar")
        _ (command! "git" "-C" source-repo "archive" "--format=tar" (str "--output=" archive) revision "otehon/src")
        _ (command! "tar" "-xf" archive "-C" runtime)
        pins (->> (file-seq (io/file (str runtime "/otehon/src"))) (filter #(.isFile %))
                   (filter #(str/ends-with? (.getName %) ".cljc"))
                   (mapv (fn [f] [(subs (.getPath f) (inc (count runtime))) (e/binary-sha (.getPath f))])))
        grant {:schema "itonami.job-grant.v1" :owner-decision "AWAI-2795" :authority-source "operator-enrollment"
               :execution "deterministic" :job-kind "physical-simulation" :operations []
               :capabilities (c/capabilities "physical-simulation") :model-tools false :mail-send false :git-merge false}
        jobs
        (mapv (fn [{:keys [bot src issue compiled spec-file spec-sha repository]}]
          (let [name (:name bot) profile (str home "/.itonami/profiles/" name) project (get-in bot [:linear :project :uuid])
                _ (h/private-dir! (str profile "/workspace/physics"))
                _ (h/durable! (str profile "/SOUL.md") (str "Itonami Otehon simulation-only adaptation of " name ". Use only pinned physics data and the approved bounded solver. Native tests, source scripts, code growth, merges and actuation remain unavailable. No model tools or Hermes store access.\n"))
                _ (h/durable! (str profile "/itonami.edn") (pr-str {:itonami/schema "cloud.itonami.profile.v1" :profile/id name
                     :runtime {:engine :itonami-agent :scheduler :itonami} :capabilities [] :authority {:default-decision :blocked}}))
                _ (h/durable! (str profile "/workspace/physics/" spec-sha ".edn") (slurp spec-file))
                en {:schema "itonami.occurrence-enrollment.v1" :bot-id name :job-id (str (:id src) "-otehon-physics-v1")
                    :issue-id (:id issue) :project-id project :initiative-id (get-in bot [:linear :initiative :id])
                    :profile-cid (b/bundle-cid (b/bundle-files profile {})) :schedule-cid (b/cid-raw (o/encode {:source src :compiled compiled :spec-sha spec-sha}))
                    :provider "none" :model "deterministic" :executor "bounded-job-v1" :grant grant :grant-cid (c/grant-cid grant)
                    :capabilities (:capabilities grant) :data-class "job-result-metadata-only" :nodes ["jun-control"]
                    :schedule (:schedule compiled) :initial-slot (:initial-slot compiled) :missed-slot-policy "skip-completed-only"}
                _ (assert (o/enrollment-valid? en))]
            {:catalog-bot-id (:id bot) :source-job-id (:id src) :source-profile (:profile bot) :source-interval-minutes 1440
             :adaptation "pinned Otehon physics only; Native tests/growth/land held" :source-cron (:source compiled)
             :enrollment en :physics-spec-sha spec-sha :physics-repository repository :runtime-root runtime :runtime-pins pins :bb bb :bb-sha bb-sha
             :binding {:issue-id (:id issue) :issue-uuid (:uuid issue) :project-id project :initiative-id (:initiative-id en)
                       :revision revision :acceptance-unit "one pinned Otehon physics probe; Native tests/growth/merge/actuation remain unqualified"}})) eligible)
        cfg {:schema "itonami.physics-fleet-worker.v1" :state-root root :workspace "f8d70247-935b-44ce-a79e-28cd91de96ca"
             :etcd-config (str ctrl "/jun-control-client.edn") :orca orca :orca-sha (e/binary-sha orca) :max-per-tick 4 :jobs jobs}
        path (str root "/worker.edn")
        admin (e/client (assoc (edn/read-string (slurp (:etcd-config cfg))) :authenticated-node "root" :cert (str ctrl "/root.pem") :key (str ctrl "/root.key")))]
    (h/durable! (str root "/rollout-plan.json") (json/generate-string report))
    (h/durable! path (pr-str cfg))
    (doseq [job jobs :let [en (:enrollment job) k (:enrollment (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en)))]]
      (assert (nil? ((:read admin) k)) "existing physics enrollment; reconcile, never overwrite")
      (assert (:succeeded ((:transact admin) {:compare {k nil} :put {k (o/encode en)}})))
      (assert (= en ((:read admin) k))))
    (h/durable! (str root "/provenance.edn") (pr-str {:issue "AWAI-2809" :revision revision :runtime runtime :catalog-sha (e/binary-sha catalog-path)
      :spec-inventory-sha (e/binary-sha (str input-dir "/inventory.json")) :archive-sha (e/binary-sha archive) :manifest-sha (e/binary-sha path)}))
    (prn {:prepared true :jobs (count jobs) :held (:held report) :manifest path :sha256 (e/binary-sha path) :revision revision}))))
