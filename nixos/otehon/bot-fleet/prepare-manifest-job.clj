;; Operator enrollment for one pinned no-agent codinator adaptation.
;; Reads public Itonami summary only; never executes the imported shell script.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str]
 '[cheshire.core :as json] '[bot-fleet.daily :as daily]
 '[itonami.otehon.job-contract :as c] '[itonami.otehon.bundle :as b]
 '[itonami.otehon.occurrence :as o] '[itonami.otehon.etcd :as e]
 '[itonami.otehon.recurring-host :as h])
(let [[catalog-path source-repo runtime cron-path] *command-line-args*
      _ (assert (and runtime cron-path) "CATALOG SOURCE_REPO NEW_RUNTIME PINNED_CRON")
      home (System/getProperty "user.home") root (str home "/.itonami/bot-fleet/awai-2831-manifest-watch-v1")
      profile (str home "/.itonami/profiles/codinator") ctrl (str home "/.itonami/control-plane/etcd/awai-bots-v1")
      _ (doseq [p [root profile runtime]] (assert (not (.exists (java.io.File. p))) "existing state must be reconciled"))
      catalog (json/parse-string (slurp catalog-path) true)
      bot (first (filter #(= "profile:codinator" (:id %)) (get-in catalog [:organization :bots])))
      src (first (filter #(= "9e8961ac33a4" (:id %)) (get-in bot [:schedule :jobs])))
      pin (first (filter #(= "cron/jobs.json" (:path %)) (get-in bot [:profile :files])))
      _ (assert (and (= "bound" (get-in bot [:linear :state])) (= "verified" (get-in bot [:schedule :state]))
                     (true? (:sourceEnabled src)) (not (:paused src)) (= (:sha256 pin) (e/binary-sha cron-path))))
      raw (first (filter #(= (:id src) (:id %)) (:jobs (json/parse-string (slurp cron-path) true))))
      _ (assert (and (true? (:no_agent raw)) (true? (:enabled raw))
                     (= "fleet_manifest_drift_watch.sh" (:script raw))
                     (= (get-in src [:schedule :expr]) (get-in raw [:schedule :expr]))))
      compiled (daily/compile-hourly src (System/currentTimeMillis))
      command! (fn [& args] (let [r (apply sh/sh (concat args [:in ""]))] (assert (zero? (:exit r))) (str/trim (:out r))))
      orca (command! "which" "orca") revision (command! "git" "-C" source-repo "rev-parse" "HEAD")
      issue-key "AWAI-752" issue-read (json/parse-string (command! orca "linear" "issue" issue-key "--workspace" "f8d70247-935b-44ce-a79e-28cd91de96ca" "--json") true)
      issue (get-in issue-read [:result :issue]) project (get-in bot [:linear :project :uuid])
      _ (assert (and (:ok issue-read) (= project (get-in issue [:project :id]))
                     (contains? #{"backlog" "unstarted" "started" "triage"} (get-in issue [:state :type]))))
      observer (str home "/.itonami/bot-fleet/awai-2795-fleet-observer-v1")
      bindings (:bindingsFile (json/parse-string (slurp (str observer "/worker-v5.json")) true))
      _ (assert (not-any? #(= (:id bot) (:botId %)) (json/parse-string (slurp (str observer "/" bindings)) true)) "already configured Bot")
      _ (doseq [p [root profile runtime]] (h/private-dir! p))
      _ (h/durable! (str profile "/SOUL.md") "Codinator Itonami adaptation: read only the pinned public fleet catalog digest and observation freshness. Record drift; never repair profiles, run source scripts, access Hermes state or invoke models.\n")
      _ (h/durable! (str profile "/itonami.edn") (pr-str {:itonami/schema "cloud.itonami.profile.v1" :profile/id "codinator" :runtime {:engine :itonami-agent :scheduler :itonami} :capabilities [] :authority {:default-decision :blocked}}))
      grant {:schema "itonami.job-grant.v1" :owner-decision "AWAI-2795" :execution "deterministic" :authority-source "operator-enrollment"
             :job-kind "fleet-manifest-drift" :manifest-catalog-sha (e/binary-sha catalog-path)
             :capabilities (c/capabilities "fleet-manifest-drift") :operations (c/operations "fleet-manifest-drift")
             :model-tools false :mail-send false :git-merge false}
      en {:schema "itonami.occurrence-enrollment.v1" :bot-id "codinator" :job-id (str (:id src) "-itonami-manifest-v1")
          :issue-id issue-key :project-id project :initiative-id (get-in bot [:linear :initiative :id])
          :profile-cid (b/bundle-cid (b/bundle-files profile {}))
          :schedule-cid (b/cid-raw (o/encode {:source (:profile bot) :job src :compiled compiled :grant grant}))
          :provider "none" :model "deterministic" :executor "bounded-job-v1" :grant grant :grant-cid (c/grant-cid grant)
          :capabilities (:capabilities grant) :data-class "job-result-metadata-only" :nodes ["jun-control"]
          :schedule (:schedule compiled) :initial-slot (:initial-slot compiled) :missed-slot-policy "skip-completed-only"}
      _ (assert (o/enrollment-valid? en))
      job {:catalog-bot-id (:id bot) :source-job-id (:id src) :source-profile (:profile bot) :source-interval-minutes 60
           :adaptation "Itonami public manifest digest/freshness only; no Hermes state/source script/repair" :source-cron (:source compiled)
           :enrollment en :workspace (str profile "/workspace")
           :binding {:issue-id issue-key :issue-uuid (:id issue) :project-id project :initiative-id (:initiative-id en)
                     :revision revision :acceptance-unit "one pinned public Itonami manifest digest/freshness observation and AwaiFS/Linear receipt; no Hermes/full-host audit"}}
      cfg {:schema "itonami.original-job-worker.v1" :state-root root :workspace "f8d70247-935b-44ce-a79e-28cd91de96ca"
           :worker-label "network.awai.itonami.manifest.awai2831" :status-url "http://127.0.0.1:8586/itonami-manifest-jobs-AWAI-2831-v1/current.json"
           :orca orca :orca-sha (e/binary-sha orca) :etcd-config (str ctrl "/jun-control-client.edn") :jobs [job]}
      admin (e/client (assoc (edn/read-string (slurp (:etcd-config cfg))) :authenticated-node "root" :cert (str ctrl "/root.pem") :key (str ctrl "/root.key")))
      ks (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en)) manifest (str root "/worker.edn") archive (str root "/source.tar")]
 (h/durable! manifest (pr-str cfg))
 (command! "git" "-C" source-repo "archive" "--format=tar" (str "--output=" archive) revision "otehon/src")
 (command! "tar" "-xf" archive "-C" runtime)
 (assert (and (nil? ((:read admin) (:enrollment ks))) (nil? ((:read admin) (:cursor ks)))) "prior authority exists")
 (assert (:succeeded ((:transact admin) {:compare {(:enrollment ks) nil (:cursor ks) nil} :put {(:enrollment ks) (o/encode en)}})))
 (assert (= en ((:read admin) (:enrollment ks))))
 (h/durable! (str root "/provenance.edn") (pr-str {:issue "AWAI-2831" :owning-issue issue-key :source revision :archive-sha (e/binary-sha archive)
   :manifest-sha (e/binary-sha manifest) :catalog-sha (e/binary-sha catalog-path) :source-cron-sha (e/binary-sha cron-path) :runtime runtime}))
 (prn {:prepared true :jobs 1 :manifest manifest :sha256 (e/binary-sha manifest) :revision revision :cadence (:source compiled) :initial-slot (:initial-slot compiled)}))
