;; Rebuild the health (cron-health) or manifest (codinator) worker's local
;; runtime after its state was lost (AWAI-3470/3481: the 2026-11-13 ~/.itonami
;; reset). Mirrors prepare-health-job.clj / prepare-manifest-job.clj but never
;; creates an enrollment: the job's enrollment is the existing etcd value from a
;; read-only dump, and the synthesized profile must reproduce its profile-cid.
;;
;;   bb -cp RUNTIME/otehon/src rebuild-adapted-runtime.clj plan|write health|manifest \
;;      DUMP.json CATALOG.json SOURCE_REPO REVISION RUNTIME_DIR
;;
;; RUNTIME_DIR is the exact classpath root the retired plist used (its
;; otehon/src is recreated there with git archive). write never touches etcd or
;; launchd and refuses to overwrite.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str] '[clojure.java.io :as io]
 '[cheshire.core :as json] '[itonami.otehon.bundle :as b] '[itonami.otehon.etcd :as e] '[itonami.otehon.recurring-host :as h])
(import '[java.util Base64])

(def kinds
  {"health" {:bot "cron-health" :job-id "b777d8b13259-itonami-v1" :source-job "b777d8b13259"
             :root "awai-2809-health-jobs-v1" :label "network.awai.itonami.health.awai2809"
             :status-url "http://127.0.0.1:8586/itonami-health-jobs-AWAI-2809-v1/current.json"
             :soul "Itonami fleet health adaptation. Read only the approved public fleet summary. Never access Hermes stores or scripts, edit other profiles, or claim measured uptime/business success. Operator grant alone authorizes host operations.\n"
             :adaptation "itonami-only"
             :acceptance "one measured Itonami-only fleet summary and persisted event; not Hermes health or uptime"}
   "manifest" {:bot "codinator" :job-id "9e8961ac33a4-itonami-manifest-v1" :source-job "9e8961ac33a4"
               :root "awai-2831-manifest-watch-v1" :label "network.awai.itonami.manifest.awai2831"
               :status-url "http://127.0.0.1:8586/itonami-manifest-jobs-AWAI-2831-v1/current.json"
               :soul "Codinator Itonami adaptation: read only the pinned public fleet catalog digest and observation freshness. Record drift; never repair profiles, run source scripts, access Hermes state or invoke models.\n"
               :adaptation "Itonami public manifest digest/freshness only; no Hermes state/source script/repair"
               :acceptance "one pinned public Itonami manifest digest/freshness observation and AwaiFS/Linear receipt; no Hermes/full-host audit"}})

(defn write-profile! [dir {:keys [bot soul]}]
  (h/private-dir! dir)
  (h/durable! (str dir "/SOUL.md") soul)
  (h/durable! (str dir "/itonami.edn") (pr-str {:itonami/schema "cloud.itonami.profile.v1" :profile/id bot
                                               :runtime {:engine :itonami-agent :scheduler :itonami} :capabilities []
                                               :authority {:default-decision :blocked}}))
  (b/bundle-cid (b/bundle-files dir {})))

(let [[mode kind dump-path catalog-path source-repo revision runtime] *command-line-args*
      _ (assert (and runtime (contains? #{"plan" "write"} mode) (contains? kinds kind)) "usage: see header")
      k (kinds kind) home (System/getProperty "user.home")
      b64 #(String. (.decode (Base64/getDecoder) ^String %) "UTF-8")
      en (first (for [kv (get (json/parse-string (slurp dump-path)) "kvs")
                      :let [key (b64 (get kv "key"))]
                      :when (str/includes? key "/itonami/occurrence/v1/enrollment/")
                      :let [v (edn/read-string (b64 (get kv "value")))]
                      :when (and (= (:bot-id v) (:bot k)) (= (:job-id v) (:job-id k)))] v))
      _ (assert en "enrollment not found in dump")
      _ (assert (= ["jun-control"] (:nodes en)) "jun-control enrollment required")
      bot (first (filter #(= (str "profile:" (:bot k)) (:id %)) (get-in (json/parse-string (slurp catalog-path) true) [:organization :bots])))
      src (first (filter #(= (:source-job k) (:id %)) (get-in bot [:schedule :jobs])))
      _ (assert (and bot src) "catalog bot/job")
      command! (fn [& argv] (let [r (apply sh/sh (concat argv [:in ""]))] (assert (zero? (:exit r)) (str argv)) (str/trim (:out r))))
      orca (command! "which" "orca")
      issue (get-in (json/parse-string (command! orca "linear" "issue" (:issue-id en) "--workspace" "f8d70247-935b-44ce-a79e-28cd91de96ca" "--json") true) [:result :issue])
      _ (assert (contains? #{"backlog" "unstarted" "started" "triage"} (get-in issue [:state :type])) "unfinished owning issue required")
      scratch (str (System/getProperty "java.io.tmpdir") "/awai-3481-" kind "-" (random-uuid))
      cid (write-profile! scratch k)
      summary {:kind kind :bot (:bot k) :job (:job-id k) :issue (:issue-id en) :issue-state (get-in issue [:state :type])
               :profile-cid-matches (= cid (:profile-cid en))}]
  (println (json/generate-string summary))
  (assert (:profile-cid-matches summary) "rebuilt profile does not reproduce the enrolled profile-cid")
  (when (= mode "write")
    (let [root (str home "/.itonami/bot-fleet/" (:root k)) profile (str home "/.itonami/profiles/" (:bot k))
          path (str root "/worker.edn")]
      (doseq [p [path (str root "/provenance.edn") profile (str runtime "/otehon")]]
        (assert (not (.exists (io/file p))) (str "refusing to overwrite " p)))
      (assert (str/starts-with? runtime (str home "/github/workspaces/codex/")) "runtime under workspaces/codex")
      (let [full (command! "git" "-C" source-repo "rev-parse" (str revision "^{commit}"))
            _ (h/private-dir! root) _ (h/private-dir! runtime)
            archive (str root "/source.tar")
            _ (command! "git" "-C" source-repo "archive" "--format=tar" (str "--output=" archive) full "otehon/src")
            _ (command! "tar" "-xf" archive "-C" runtime)
            _ (assert (= (:profile-cid en) (write-profile! profile k)) "profile-cid after write")
            job (cond-> {:catalog-bot-id (:id bot) :source-job-id (:id src) :source-profile (:profile bot) :source-interval-minutes 60
                         :adaptation (:adaptation k) :enrollment en :workspace (str profile "/workspace")
                         :binding {:issue-id (:issue-id en) :issue-uuid (:id issue) :project-id (:project-id en)
                                   :initiative-id (:initiative-id en) :revision full :acceptance-unit (:acceptance k)}}
                  (= kind "manifest") (assoc :source-cron {:expr (get-in src [:schedule :expr]) :timezone (or (:timezone src) "Asia/Tokyo")}))
            cfg {:schema "itonami.original-job-worker.v1" :state-root root :workspace "f8d70247-935b-44ce-a79e-28cd91de96ca"
                 :worker-label (:label k) :status-url (:status-url k)
                 :orca orca :orca-sha (e/binary-sha orca)
                 :etcd-config (str home "/.itonami/control-plane/etcd/awai-bots-v1/jun-control-client.edn") :jobs [job]}]
        (h/durable! path (pr-str cfg))
        (assert (= cfg (edn/read-string (slurp path))) "manifest readback")
        (h/durable! (str root "/provenance.edn")
                    (pr-str {:issue "AWAI-3481" :revision full :runtime runtime :archive-sha (e/binary-sha archive)
                             :catalog-sha (e/binary-sha catalog-path) :etcd-dump-sha (e/binary-sha dump-path) :manifest-sha (e/binary-sha path)
                             :note "Manifest regenerated after the 2026-11-13 ~/.itonami reset; the enrollment is the unchanged etcd value."}))
        (println (json/generate-string {:written true :kind kind :manifest path :sha256 (e/binary-sha path) :revision full :runtime runtime}))))))
