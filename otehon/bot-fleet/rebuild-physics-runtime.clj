;; Rebuild a physics or material worker's local runtime after its state was lost
;; (AWAI-3470/3477: the 2026-11-13 ~/.itonami reset). Mirrors
;; prepare-physics-fleet.clj, with one difference: enrollments are NOT created.
;; Each job's enrollment is the existing etcd value, read from a read-only dump,
;; so admission bindings match exactly and nothing can widen.
;;
;;   bb -cp RUNTIME/otehon/src rebuild-physics-runtime.clj plan|write \
;;      physics|material DUMP.json OBSERVATION.json CATALOG.json SPEC_DIR LINEAR.json SOURCE_REPO REVISION
;;
;; DUMP.json         etcdctl get /itonami/occurrence/v1/ --prefix -w json (read-only)
;; OBSERVATION.json  the worker's last awai.original-job-observation.v1 (job set, spec digests)
;; CATALOG.json      the awai.bot-fleet.v1 catalog the jobs were prepared from
;; SPEC_DIR          fetch-physics-specs.mjs output (inventory.json + <bot>-<sha>.edn)
;; LINEAR.json       issues with identifier/id (orca linear list-issues --json), for issue UUIDs
;;
;; plan: checks every job in a scratch directory and prints a summary; writes nothing else.
;; write: also creates the runtime capsule, the synthesized profiles and worker.edn.
;; It never writes etcd, never touches launchd and refuses to overwrite anything.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str] '[clojure.java.io :as io]
 '[cheshire.core :as json] '[itonami.otehon.bundle :as b] '[itonami.otehon.etcd :as e]
 '[itonami.otehon.occurrence :as o] '[itonami.otehon.recurring-host :as h])
(import '[java.util Base64])

(defn soul [name]
  (str "Itonami Otehon simulation-only adaptation of " name ". Use only pinned physics data and the approved bounded solver. Native tests, source scripts, code growth, merges and actuation remain unavailable. No model tools or Hermes store access.\n"))
(defn itonami-edn [name]
  (pr-str {:itonami/schema "cloud.itonami.profile.v1" :profile/id name
           :runtime {:engine :itonami-agent :scheduler :itonami} :capabilities [] :authority {:default-decision :blocked}}))

(defn write-profile! [dir name spec-sha spec-text]
  (h/private-dir! (str dir "/workspace/physics"))
  (h/durable! (str dir "/SOUL.md") (soul name))
  (h/durable! (str dir "/itonami.edn") (itonami-edn name))
  (h/durable! (str dir "/workspace/physics/" spec-sha ".edn") spec-text)
  (b/bundle-cid (b/bundle-files dir {})))

(let [[mode worker dump-path obs-path catalog-path spec-dir linear-path source-repo revision] *command-line-args*
      _ (assert (and revision (contains? #{"plan" "write"} mode) (contains? #{"physics" "material"} worker)) "usage: see header")
      home (System/getProperty "user.home")
      b64 #(String. (.decode (Base64/getDecoder) ^String %) "UTF-8")
      dump (json/parse-string (slurp dump-path))
      enrollments (into {} (for [kv (get dump "kvs") :let [k (b64 (get kv "key"))]
                                 :when (str/includes? k "/itonami/occurrence/v1/enrollment/")]
                             (let [v (edn/read-string (b64 (get kv "value")))] [(:job-id v) v])))
      obs (json/parse-string (slurp obs-path) true)
      _ (assert (= "awai.original-job-observation.v1" (:schema obs)) "observation schema")
      catalog (json/parse-string (slurp catalog-path) true)
      bots (into {} (map (juxt :id identity) (get-in catalog [:organization :bots])))
      inventory (json/parse-string (slurp (str spec-dir "/inventory.json")) true)
      _ (assert (= (:catalogSha256 inventory) (e/binary-sha catalog-path)) "spec inventory/catalog mismatch")
      specs (into {} (map (juxt :botId identity) (:rows inventory)))
      uuids (into {} (map (juxt :identifier :id) (get-in (json/parse-string (slurp linear-path) true) [:result :issues])))
      label (if (= worker "material") "network.awai.itonami.material.awai2809" "network.awai.itonami.physics.awai2809")
      root (str home "/.itonami/bot-fleet/" (if (= worker "material") "awai-2809-material-v1" "awai-2809-physics-v1"))
      runtime (str home "/github/workspaces/codex/awai-2809-" worker "-runtime/" (subs revision 0 (if (= worker "material") 7 7)))
      scratch (str (System/getProperty "java.io.tmpdir") "/awai-3477-" worker "-" (random-uuid))
      checked
      (mapv (fn [row]
              (let [job-id (:job-id row) en (get enrollments job-id) name (:bot-id en)
                    bot (get bots (:catalog-bot-id row)) spec (get specs (:catalog-bot-id row))
                    obs-sha (get-in row [:last-result :domain-result :spec-sha])
                    src (first (filter #(str/ends-with? (:name %) "-measure") (get-in bot [:schedule :jobs])))
                    problems (cond-> []
                               (nil? en) (conj "no-enrollment")
                               (and en (not= (:catalog-bot-id row) (str "profile:" name))) (conj "bot-mismatch")
                               (nil? bot) (conj "not-in-catalog")
                               (not= "verified-public" (:state spec)) (conj "spec-unavailable")
                               (and obs-sha (not= obs-sha (:sha256 spec))) (conj "spec-digest-differs-from-last-run")
                               (nil? (get uuids (:issue-id en))) (conj "issue-uuid-unknown")
                               (not= (str (:id src) "-otehon-physics-v1") job-id) (conj "source-job-mismatch")
                               (not= ["jun-control"] (:nodes en)) (conj "node-not-jun-control"))
                    spec-path (when spec (str spec-dir "/" (:file spec)))
                    _ (when (and spec-path (not= (:sha256 spec) (e/binary-sha spec-path))) (throw (ex-info "spec file digest" {})))
                    cid (when (empty? problems) (write-profile! (str scratch "/" name) name (:sha256 spec) (slurp spec-path)))
                    problems (cond-> problems (and cid (not= cid (:profile-cid en))) (conj "profile-cid-mismatch"))]
                {:row row :en en :bot bot :src src :spec spec :spec-path spec-path :problems problems}))
            (:jobs obs))
      bad (filter (comp seq :problems) checked)
      summary {:worker worker :jobs (count checked) :ok (- (count checked) (count bad))
               :problems (frequencies (mapcat :problems bad))
               :problem-bots (mapv #(get-in % [:row :catalog-bot-id]) (take 20 bad))
               :enrolled-not-observed (count (remove (set (map #(get-in % [:row :job-id]) checked))
                                                     (filter #(and (string? %) (str/ends-with? % "-otehon-physics-v1")
                                                                   (= ["jun-control"] (:nodes (get enrollments %))))
                                                             (keys enrollments))))}]
  (println (json/generate-string summary))
  (when (= mode "write")
    (assert (empty? bad) "every job must match its enrollment before anything is written")
    (doseq [p (concat [runtime (str root "/worker.edn") (str root "/provenance.edn")]
                      (map #(str home "/.itonami/profiles/" (get-in % [:en :bot-id])) checked))]
      (assert (not (.exists (io/file p))) (str "refusing to overwrite " p)))
    (let [command! (fn [& argv] (let [r (apply sh/sh (concat argv [:in ""]))] (assert (zero? (:exit r)) (str argv (:err r))) (str/trim (:out r))))
          full (command! "git" "-C" source-repo "rev-parse" (str revision "^{commit}"))
          _ (assert (str/starts-with? full revision))
          orca (command! "which" "orca") bb (command! "which" "bb")
          _ (h/private-dir! root) _ (h/private-dir! runtime)
          archive (str root "/source.tar")
          _ (command! "git" "-C" source-repo "archive" "--format=tar" (str "--output=" archive) full "otehon/src")
          _ (command! "tar" "-xf" archive "-C" runtime)
          pins (->> (file-seq (io/file (str runtime "/otehon/src"))) (filter #(.isFile %))
                    (filter #(str/ends-with? (.getName %) ".cljc"))
                    (mapv (fn [f] [(subs (.getPath f) (inc (count runtime))) (e/binary-sha (.getPath f))])))
          jobs (mapv (fn [{:keys [row en bot src spec spec-path]}]
                       (let [name (:bot-id en) profile (str home "/.itonami/profiles/" name)
                             cid (write-profile! profile name (:sha256 spec) (slurp spec-path))]
                         (assert (= cid (:profile-cid en)) (str "profile-cid " name))
                         {:catalog-bot-id (:id bot) :source-job-id (:id src) :source-profile (:profile bot) :source-interval-minutes 1440
                          :adaptation "pinned Otehon physics only; Native tests/growth/land held"
                          :source-cron {:expr (get-in src [:schedule :expr]) :timezone (or (:timezone src) "Asia/Tokyo")}
                          :enrollment en :physics-spec-sha (:sha256 spec) :physics-repository (:repository spec)
                          :runtime-root runtime :runtime-pins pins :bb bb :bb-sha (e/binary-sha bb)
                          :binding {:issue-id (:issue-id en) :issue-uuid (get uuids (:issue-id en)) :project-id (:project-id en)
                                    :initiative-id (:initiative-id en) :revision full
                                    :acceptance-unit "one pinned Otehon physics probe; Native tests/growth/merge/actuation remain unqualified"}}))
                     checked)
          cfg (cond-> {:schema "itonami.physics-fleet-worker.v1" :state-root root :workspace "f8d70247-935b-44ce-a79e-28cd91de96ca"
                       :etcd-config (str home "/.itonami/control-plane/etcd/awai-bots-v1/jun-control-client.edn")
                       :orca orca :orca-sha (e/binary-sha orca) :max-per-tick (if (= worker "material") 2 4) :jobs jobs}
                (= worker "material") (assoc :worker-label label
                                             :result-url "http://127.0.0.1:8586/itonami-material-jobs-AWAI-2809-v1/current.json"))
          path (str root "/worker.edn")]
      (h/durable! path (pr-str cfg))
      (assert (= cfg (edn/read-string (slurp path))) "manifest readback")
      (h/durable! (str root "/provenance.edn")
                  (pr-str {:issue "AWAI-2809" :rebuild "AWAI-3477" :revision full :runtime runtime
                           :catalog-sha (e/binary-sha catalog-path) :spec-inventory-sha (e/binary-sha (str spec-dir "/inventory.json"))
                           :observation-sha (e/binary-sha obs-path) :etcd-dump-sha (e/binary-sha dump-path)
                           :archive-sha (e/binary-sha archive) :manifest-sha (e/binary-sha path)
                           :note "Manifest regenerated after the 2026-11-13 ~/.itonami reset; enrollments are unchanged etcd values."}))
      (println (json/generate-string {:written true :jobs (count jobs) :manifest path :sha256 (e/binary-sha path) :revision full :runtime runtime})))))
