;; Explicit operator enrollment of two reviewed original interval jobs.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str] '[cheshire.core :as json]
         '[itonami.otehon.job-contract :as c] '[itonami.otehon.bundle :as b]
         '[itonami.otehon.occurrence :as o] '[itonami.otehon.etcd :as e] '[itonami.otehon.recurring-host :as d])
(let [[catalog-path source-repo runtime-root] *command-line-args*
      _ (assert runtime-root "usage: prepare-original-jobs CATALOG ITONAMI_SOURCE NEW_RUNTIME_CAPSULE")
      home (System/getProperty "user.home") root (str home "/.itonami/bot-fleet/awai-2795-original-jobs-v1")
      control (str home "/.itonami/control-plane/etcd/awai-bots-v1")
      catalog (json/parse-string (slurp catalog-path) true)
      command! (fn [& argv] (let [r (apply sh/sh (concat argv [:in ""]))] (assert (zero? (:exit r)) "operator command failed") (str/trim (:out r))))
      revision (command! "git" "-C" source-repo "rev-parse" "HEAD")
      orca (command! "which" "orca") now (* 1000 (quot (System/currentTimeMillis) 1000))
      _ (doseq [p [root runtime-root]] (assert (not (.exists (java.io.File. p))) "preserve existing deployment"))
      _ (d/private-dir! root) _ (d/private-dir! runtime-root)
      archive (str root "/source.tar")
      _ (command! "git" "-C" source-repo "archive" "--format=tar" (str "--output=" archive) revision "otehon/src")
      _ (command! "tar" "-xf" archive "-C" runtime-root)
      selected [["public-bots-registrar" "08c4f34d927f" "AWAI-1012"] ["awai-arb" "887b2183be7c" "AWAI-750"]]
      jobs (mapv (fn [[bot-name job-id issue-id]]
                   (let [bot (first (filter #(= (str "profile:" bot-name) (:id %)) (get-in catalog [:organization :bots])))
                         src (first (filter #(= job-id (:id %)) (get-in bot [:schedule :jobs])))
                         _ (assert (and (= "verified" (get-in bot [:schedule :state])) (true? (:sourceEnabled src))
                                        (not (:paused src)) (not (:needsScript src)) (= "interval" (get-in src [:schedule :kind]))))
                         issue-response (json/parse-string (command! orca "linear" "issue" issue-id "--workspace" "f8d70247-935b-44ce-a79e-28cd91de96ca" "--json") true)
                         issue (get-in issue-response [:result :issue]) project (get-in bot [:linear :project :uuid])
                         _ (assert (and (:ok issue-response) (= project (get-in issue [:project :id]))
                                        (contains? #{"backlog" "unstarted" "started" "triage"} (get-in issue [:state :type]))))
                         grant {:schema "itonami.job-grant.v1" :owner-decision "AWAI-2795" :execution "deterministic"
                                :authority-source "operator-enrollment" :job-kind bot-name
                                :capabilities (c/capabilities bot-name) :operations (c/operations bot-name)
                                :model-tools false :mail-send false :git-merge false}
                         minutes (get-in src [:schedule :minutes])
                         en {:schema "itonami.occurrence-enrollment.v1" :bot-id bot-name :job-id job-id
                             :issue-id issue-id :project-id project :initiative-id (get-in bot [:linear :initiative :id])
                             :profile-cid (b/bundle-cid (b/bundle-files (str home "/.itonami/profiles/" bot-name) {}))
                             :schedule-cid (b/cid-raw (o/encode {:source-commit (get-in bot [:profile :commit]) :job src}))
                             :provider "none" :model "deterministic" :executor "bounded-job-v1" :grant grant :grant-cid (c/grant-cid grant)
                             :capabilities (:capabilities grant) :data-class "job-result-metadata-only" :nodes ["jun-control"]
                             :schedule {:type "interval" :every-ms (* 60000 minutes)} :initial-slot now :missed-slot-policy "skip-completed-only"}
                         _ (assert (o/enrollment-valid? en))]
                     {:catalog-bot-id (:id bot) :enrollment en :source-profile (:profile bot) :source-interval-minutes minutes
                      :workspace (str home "/.itonami/profiles/" bot-name "/workspace")
                      :binding {:issue-id issue-id :issue-uuid (:id issue) :project-id project :initiative-id (:initiative-id en)
                                :revision revision :acceptance-unit "one real original-job service observation and declared local output"}})) selected)
      cfg {:schema "itonami.original-job-worker.v1" :state-root root :workspace "f8d70247-935b-44ce-a79e-28cd91de96ca"
           :orca orca :orca-sha (e/binary-sha orca) :etcd-config (str control "/jun-control-client.edn") :jobs jobs}
      client-cfg (edn/read-string (slurp (:etcd-config cfg)))
      admin (e/client (assoc client-cfg :authenticated-node "root" :cert (str control "/root.pem") :key (str control "/root.key")))
      path (str root "/worker.edn")]
  (d/durable! path (pr-str cfg))
  (doseq [job jobs :let [en (:enrollment job) k (:enrollment (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en)))]]
    (assert (nil? ((:read admin) k)) "existing original-job enrollment; reconcile instead")
    (assert (:succeeded ((:transact admin) {:compare {k nil} :put {k (o/encode en)}})))
    (assert (= en ((:read admin) k))))
  (d/durable! (str root "/provenance.edn") (pr-str {:issue "AWAI-2795" :revision revision :runtime-root runtime-root
    :archive-sha (e/binary-sha archive) :catalog-sha (e/binary-sha catalog-path) :manifest-sha (e/binary-sha path)}))
  (prn {:prepared true :manifest path :sha256 (e/binary-sha path) :revision revision :jobs (count jobs)}))
