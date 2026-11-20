;; Explicit Itonami adaptation; source Hermes stores/scripts are not executed.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str] '[cheshire.core :as json]
 '[itonami.otehon.job-contract :as c] '[itonami.otehon.bundle :as b] '[itonami.otehon.occurrence :as o]
 '[itonami.otehon.etcd :as e] '[itonami.otehon.recurring-host :as h])
(let [[catalog-path source-repo runtime] *command-line-args* home (System/getProperty "user.home")
      root (str home "/.itonami/bot-fleet/awai-2809-health-jobs-v1") profile (str home "/.itonami/profiles/cron-health")
      ctrl (str home "/.itonami/control-plane/etcd/awai-bots-v1")
      _ (doseq [p [root profile runtime]] (assert (and p (not (.exists (java.io.File. p)))) "preserve existing deployment"))
      command! (fn [& args] (let [r (apply sh/sh (concat args [:in ""]))] (assert (zero? (:exit r))) (str/trim (:out r))))
      revision (command! "git" "-C" source-repo "rev-parse" "HEAD")
      bot (first (filter #(= "profile:cron-health" (:id %)) (get-in (json/parse-string (slurp catalog-path) true) [:organization :bots])))
      src (first (filter #(= "b777d8b13259" (:id %)) (get-in bot [:schedule :jobs])))
      _ (assert (and (= "bound" (get-in bot [:linear :state])) (= "verified" (get-in bot [:schedule :state]))
                     (true? (:sourceEnabled src)) (not (:paused src)) (= 60 (get-in src [:schedule :minutes]))))
      orca (command! "which" "orca") issue-key "AWAI-752"
      raw (json/parse-string (command! orca "linear" "issue" issue-key "--workspace" "f8d70247-935b-44ce-a79e-28cd91de96ca" "--json") true)
      issue (get-in raw [:result :issue]) project (get-in bot [:linear :project :uuid])
      _ (assert (and (:ok raw) (= project (get-in issue [:project :id]))
                     (contains? #{"backlog" "unstarted" "started" "triage"} (get-in issue [:state :type]))))
      _ (doseq [p [root profile runtime]] (h/private-dir! p))
      _ (h/durable! (str profile "/SOUL.md") "Itonami fleet health adaptation. Read only the approved public fleet summary. Never access Hermes stores or scripts, edit other profiles, or claim measured uptime/business success. Operator grant alone authorizes host operations.\n")
      _ (h/durable! (str profile "/itonami.edn") (pr-str {:itonami/schema "cloud.itonami.profile.v1" :profile/id "cron-health" :runtime {:engine :itonami-agent :scheduler :itonami} :capabilities [] :authority {:default-decision :blocked}}))
      grant {:schema "itonami.job-grant.v1" :owner-decision "AWAI-2795" :authority-source "operator-enrollment"
             :execution "deterministic" :job-kind "cron-health" :capabilities (c/capabilities "cron-health")
             :operations (c/operations "cron-health") :model-tools false :mail-send false :git-merge false}
      en {:schema "itonami.occurrence-enrollment.v1" :bot-id "cron-health" :job-id "b777d8b13259-itonami-v1"
          :issue-id issue-key :project-id project :initiative-id (get-in bot [:linear :initiative :id])
          :profile-cid (b/bundle-cid (b/bundle-files profile {})) :schedule-cid (b/cid-raw (o/encode {:source (:profile bot) :job src :adaptation "itonami-only"}))
          :provider "none" :model "deterministic" :executor "bounded-job-v1" :grant grant :grant-cid (c/grant-cid grant)
          :capabilities (:capabilities grant) :data-class "job-result-metadata-only" :nodes ["jun-control"]
          :schedule {:type "interval" :every-ms 3600000} :initial-slot (* 1000 (quot (System/currentTimeMillis) 1000)) :missed-slot-policy "skip-completed-only"}
      _ (assert (o/enrollment-valid? en))
      job {:catalog-bot-id (:id bot) :source-job-id (:id src) :source-profile (:profile bot) :source-interval-minutes 60
           :adaptation "itonami-only" :enrollment en :workspace (str profile "/workspace")
           :binding {:issue-id issue-key :issue-uuid (:id issue) :project-id project :initiative-id (:initiative-id en)
                     :revision revision :acceptance-unit "one measured Itonami-only fleet summary and persisted event; not Hermes health or uptime"}}
      cfg {:schema "itonami.original-job-worker.v1" :state-root root :workspace "f8d70247-935b-44ce-a79e-28cd91de96ca"
           :worker-label "network.awai.itonami.health.awai2809" :status-url "http://127.0.0.1:8586/itonami-health-jobs-AWAI-2809-v1/current.json"
           :orca orca :orca-sha (e/binary-sha orca) :etcd-config (str ctrl "/jun-control-client.edn") :jobs [job]}
      admin (e/client (assoc (edn/read-string (slurp (:etcd-config cfg))) :authenticated-node "root" :cert (str ctrl "/root.pem") :key (str ctrl "/root.key")))
      k (:enrollment (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en))) path (str root "/worker.edn")
      archive (str root "/source.tar")]
 (h/durable! path (pr-str cfg))
 (command! "git" "-C" source-repo "archive" "--format=tar" (str "--output=" archive) revision "otehon/src")
 (command! "tar" "-xf" archive "-C" runtime)
 (assert (nil? ((:read admin) k)) "existing enrollment; reconcile")
 (assert (:succeeded ((:transact admin) {:compare {k nil} :put {k (o/encode en)}})))
 (assert (= en ((:read admin) k)))
 (h/durable! (str root "/provenance.edn") (pr-str {:issue "AWAI-2809" :revision revision :adaptation "itonami-only" :runtime runtime
  :catalog-sha (e/binary-sha catalog-path) :archive-sha (e/binary-sha archive) :manifest-sha (e/binary-sha path)}))
 (prn {:prepared true :manifest path :sha256 (e/binary-sha path) :revision revision :jobs 1 :scope "itonami-only-adaptation"}))
