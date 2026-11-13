;; Otehon operator action; creates a NEW managed deployment. No source job,
;; credential, existing profile, launchd service or enrollment is overwritten.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str]
         '[cheshire.core :as json] '[itonami.otehon.etcd :as e]
         '[itonami.otehon.occurrence :as o] '[itonami.otehon.bundle :as b]
         '[itonami.otehon.muse-host :as h] '[itonami.otehon.muse :as muse]
         '[itonami.otehon.recurring-host :as host])
(let [[catalog-path schedules-path source-repo runtime-root] *command-line-args*
      _ (assert runtime-root "usage: bb -cp ITONAMI/otehon/src prepare-readiness.clj CATALOG SCHEDULES ITONAMI_REPO NEW_RUNTIME_ROOT")
      catalog (json/parse-string (slurp catalog-path) true)
      schedules (json/parse-string (slurp schedules-path) true)
      home (System/getProperty "user.home")
      root (str home "/.itonami/bot-fleet/awai-2795-readiness-v1")
      ctrl (str home "/.itonami/control-plane/etcd/awai-bots-v1")
      selected [["awai-arb" "887b2183be7c" "AWAI-750"] ["mail-relay" "3926a8cfbb1a" "AWAI-893"]
                ["public-bots-registrar" "08c4f34d927f" "AWAI-1012"] ["rule-kaizen" "24b4bec8c51b" "AWAI-755"]
                ["sec-toolkit-maturity" "023434d42feb" "AWAI-943"]]
      command! (fn [& args] (let [r (apply sh/sh args)] (assert (zero? (:exit r)) "operator command failed") (str/trim (:out r))))
      revision (command! "git" "-C" source-repo "rev-parse" "HEAD")
      _ (command! "git" "-C" source-repo "diff" "--quiet" "HEAD" "--" "otehon/src")
      orca (command! "which" "orca") github (command! "which" "gh")
      cluster (edn/read-string (slurp (str ctrl "/jun-control-client.edn")))
      admin (e/client (assoc cluster :authenticated-node "root" :cert (str ctrl "/root.pem") :key (str ctrl "/root.key")))
      profiles (mapv #(str home "/.itonami/profiles/" (first %)) selected)
      _ (doseq [p (concat [root runtime-root] profiles)] (assert (not (.exists (java.io.File. p))) "new deployment paths required; reconcile existing state"))
      _ (host/private-dir! root) _ (host/private-dir! runtime-root)
      archive (str root "/source.tar")
      _ (command! "git" "-C" source-repo "archive" "--format=tar" (str "--output=" archive) revision "otehon/src")
      _ (command! "tar" "-xf" archive "-C" runtime-root)
      now (* 1000 (quot (System/currentTimeMillis) 1000))
      jobs
      (mapv
        (fn [[name job-id issue-id] dir]
          (let [bot (first (filter #(= (str "profile:" name) (:id %)) (get-in catalog [:organization :bots])))
                row (first (filter #(= (:id bot) (:botId %)) schedules))
                src (first (filter #(= job-id (:id %)) (:jobs row)))
                project (get-in bot [:linear :project :uuid]) initiative (get-in bot [:linear :initiative :id])
                pin (:profile bot)
                _ (assert (and (= "verified" (:state row)) (= (:commit pin) (:commit row))
                               (true? (:sourceEnabled src)) (not (:paused src)) (not (:needsScript src))
                               (= "interval" (get-in src [:schedule :kind]))
                               (pos-int? (get-in src [:schedule :minutes])) project initiative))
                issue-raw (json/parse-string (command! orca "linear" "issue" issue-id "--workspace" "f8d70247-935b-44ce-a79e-28cd91de96ca" "--json") true)
                issue (get-in issue-raw [:result :issue])
                _ (assert (and (:ok issue-raw) (= project (get-in issue [:project :id]))
                               (contains? #{"backlog" "unstarted" "started" "triage"} (get-in issue [:state :type]))))
                _ (host/private-dir! dir)
                _ (spit (str dir "/SOUL.md")
                    (str "You are the Itonami Otehon readiness phase of registered Bot " name ".\n"
                         "Role: public repository readiness and owning Linear work organization.\n"
                         "Only tool-free Muse inference is available. Original Hermes scripts, private state, external effects and implementation remain held.\n"
                         "Use only the supplied public data. Never claim you ran a tool, tested code, deployed or completed the original job.\n"))
                _ (spit (str dir "/config.yaml") "model:\n  provider: muse\n  base_url: https://api.meta.ai/v1\n  default: muse-spark-1.3\nagent:\n  max_turns: 1\n  reasoning_effort: low\n")
                manifest {:itonami/schema "cloud.itonami.profile.v1" :profile/id name :profile/hermes-compatible true
                          :profile/description (str "Registered " name " public readiness; original effectful jobs held")
                          :runtime {:engine :itonami-agent :scheduler :itonami} :cron? true
                          :placement {:mode :local :order [:local] :inference-rail :muse}
                          :inference {:rails [:muse] :authorities ["api.meta.ai"] :deny-hosts ["openrouter.ai"]}
                          :state {:secrets :never-leave-host}
                          :authority {:default-decision :blocked :source :yakuwari :ref "yakuwari.edn"}
                          :capabilities [{:capability :inference_muse :decision :autonomous}]}
                _ (spit (str dir "/itonami.edn") (pr-str manifest))
                _ (spit (str dir "/yakuwari.edn") (pr-str {:yakuwari/id (keyword name) :yakuwari/capabilities (:capabilities manifest)}))
                _ (spit (str dir "/itonami.edn") (pr-str (b/with-bundle dir manifest)))
                _ (assert (= :ok (:status (muse/plan (h/load-profile dir) "Review supplied public data only."))))
                minutes (get-in src [:schedule :minutes])
                schedule {:type "interval" :every-ms (* 60000 minutes)}
                enrollment {:schema "itonami.occurrence-enrollment.v1" :bot-id name :job-id (str job-id "-readiness-v1")
                            :issue-id issue-id :project-id project :initiative-id initiative
                            :profile-cid (b/bundle-cid (b/bundle-files dir {}))
                            :schedule-cid (b/cid-raw (o/encode {:source-job job-id :source-commit (:commit pin) :source-sha (:sha256 row)
                                                             :schedule schedule :phase "public-readiness-only"}))
                            :provider "meta" :model "muse-spark-1.3" :capabilities ["inference_muse"]
                            :nodes ["jun-control"] :data-class "public-readiness-only"
                            :missed-slot-policy "skip-completed-only" :schedule schedule :initial-slot now}
                _ (assert (o/enrollment-valid? enrollment))
                prompt (str root "/" name "-prompt.txt")
                _ (spit prompt
                    (str "Registered Bot " name ", readiness phase only. Owning unfinished Linear Issue " issue-id ".\n"
                         "Review the supplied public README for one concrete readiness gap and one next acceptance unit appropriate to this repository.\n"
                         "Original job " job-id " (" (:name src) ") remains HELD: its scripts/private connectors/Git effects are unavailable. Do not claim its work completed.\n"
                         "Return concise Japanese (<=400 words): public evidence and immutable source, observed limits, one proposed next action, required capability, and original-job hold. No invented metrics.\n"))
                forecast {:timestamp (str (java.time.Instant/now)) :metric "provider input/output tokens per selected run"
                          :range {:input [19000 24000] :output [100 1200]} :confidence "low"
                          :basis "prior Meta physical calls ~19374 input plus <=6000 public README chars; readiness output not yet calibrated"}
                binding {:schema "awai.bot-run-binding.v1" :issue-id issue-id :issue-uuid (:id issue) :project-id project
                         :initiative-id initiative :revision revision :acceptance-unit "one public repository readiness assessment; original effectful job remains held"
                         :forecast forecast}]
            {:catalog-bot-id (:id bot) :profile-dir dir :source-profile pin :public-repository (get-in bot [:linear :repository])
             :source-job-id job-id :source-interval-minutes minutes :original-job-state "held-unported-effects"
             :prompt-file prompt :prompt-sha (e/binary-sha prompt) :binding binding :enrollment enrollment})) selected profiles)
      cfg {:schema "itonami.scheduled-readiness-worker.v1" :workspace "f8d70247-935b-44ce-a79e-28cd91de96ca"
           :orca orca :orca-sha (e/binary-sha orca) :github github :github-sha (e/binary-sha github)
           :state-root root :etcd-config (str ctrl "/jun-control-client.edn") :jobs jobs}
      path (str root "/worker.edn")]
  (host/durable! path (pr-str cfg))
  (host/durable! (str root "/provenance.edn")
    (pr-str {:issue "AWAI-2795" :revision revision :archive-sha (e/binary-sha archive)
             :catalog-sha (e/binary-sha catalog-path) :schedules-sha (e/binary-sha schedules-path)
             :scope "public-readiness-only" :original-jobs-enabled false :runtime-root runtime-root}))
  (doseq [job jobs]
    (let [enrollment (:enrollment job) k (:enrollment (o/keys-for (:bot-id enrollment) (:job-id enrollment) (:initial-slot enrollment)))]
      (assert (nil? ((:read admin) k)) "existing enrollment; reconcile, never overwrite")
      (assert (:succeeded ((:transact admin) {:compare {k nil} :put {k (o/encode enrollment)}})))
      (assert (= enrollment ((:read admin) k)))))
  (host/durable! (str root "/prepared.edn") (pr-str {:prepared true :manifest-sha (e/binary-sha path)}))
  (println (pr-str {:prepared true :manifest path :sha256 (e/binary-sha path) :bots (count jobs)
                   :scope "public-readiness-only" :original-jobs-enabled false :revision revision})))
