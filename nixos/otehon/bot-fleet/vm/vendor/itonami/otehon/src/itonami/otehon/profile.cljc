(ns itonami.otehon.profile
  "One profile directory, read and checked, and one cron job dry-run.

  Pure: the caller hands in `read-text` (relative path -> text or nil) and
  the two format readers `parse-edn` / `parse-json`, so the same code runs
  under Basilisp, Babashka and nbb, and the shared cases can feed mutated
  text without touching a disk.

  Layout (Hermes format, itonami store):
    SOUL.md  config.yaml  profile.yaml  cron/jobs.json   read by both CLIs
    itonami.edn  yakuwari.edn                            Hermes skips them
  A profile with itonami.edn is an itonami agent; without it the same files
  are a plain Hermes profile."
  (:require [clojure.string :as str]
            [itonami.otehon.yaml :as yaml]
            [itonami.otehon.manifest :as manifest]
            [itonami.otehon.yakuwari :as yakuwari]
            [itonami.otehon.rail :as rail]
            [itonami.otehon.cron :as cron]))

(def hermes-files ["SOUL.md" "config.yaml" "profile.yaml" "cron/jobs.json"])
(def itonami-files ["itonami.edn" "yakuwari.edn"])

(defn- problem [level file path msg]
  {:level level :file file :path path :message msg})

(defn- ex-msg [e] (str (or (ex-message e) e)))

(defn- parse-with [f file text]
  (try [(f text) nil]
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
         [nil (problem :error file [] (str "unreadable: " (ex-msg e)))])))

(defn load-profile
  "Read a profile through `read-text`. Returns the parsed parts and the
  read problems; never throws on bad input."
  [{:keys [name read-text parse-edn parse-json]}]
  (let [texts (into {} (for [f (concat hermes-files itonami-files)] [f (read-text f)]))
        present (fn [f] (some? (get texts f)))
        [config c-p] (if (present "config.yaml") (parse-with yaml/parse "config.yaml" (get texts "config.yaml")) [{} nil])
        [pyaml p-p] (if (present "profile.yaml") (parse-with yaml/parse "profile.yaml" (get texts "profile.yaml")) [{} nil])
        [jobs-doc j-p] (if (present "cron/jobs.json") (parse-with parse-json "cron/jobs.json" (get texts "cron/jobs.json")) [{"jobs" []} nil])
        [m m-p] (if (present "itonami.edn") (parse-with parse-edn "itonami.edn" (get texts "itonami.edn")) [nil nil])
        [y y-p] (if (present "yakuwari.edn") (parse-with parse-edn "yakuwari.edn" (get texts "yakuwari.edn")) [nil nil])]
    {:name name
     :runtime (rail/runtime-for (present "itonami.edn"))
     :present (vec (filter present (concat hermes-files itonami-files)))
     :config (if (map? config) config {})
     :profile-yaml (if (map? pyaml) pyaml {})
     :jobs (cron/jobs-of jobs-doc)
     :manifest m
     :yakuwari y
     :problems (vec (keep identity [c-p p-p j-p m-p y-p]))}))

(defn- tag [file ps]
  (map #(assoc % :file file) ps))

(defn- rail-problems [{:keys [runtime config jobs manifest]}]
  (let [names (rail/provider-names config jobs)
        provider-only (rail/provider-refs config jobs)]
    (if (= runtime "itonami")
      (let [rails (get-in manifest [:inference :rails])
            primary (name (or (first rails) (get-in manifest [:placement :inference-rail]) ""))]
        (concat
         (let [v (rail/profile-verdict "itonami" true primary)]
           (when (not= v "rail/ok")
             [(problem :error "itonami.edn" [:inference :rails] v)]))
         ;; Provider refs ride rails and are checked strictly; model ids
         ;; are provider-scoped (gpt-5, claude-sonnet) and unchecked.
         (for [n provider-only :let [v (rail/itonami-rail-verdict n)] :when (not= v "rail/ok")]
           (problem :error "config.yaml" [n] v))
         (let [target (rail/resolve-job config {})
               v (rail/inference-verdict (:inference manifest) target)]
           (when (and (:host target) (not= v "rail/ok"))
             [(problem :error "config.yaml" ["model"] (str v " " (:host target)))]))))
      (for [n names :let [v (rail/hermes-provider-verdict n)] :when (not= v "rail/ok")]
        (problem :error "config.yaml" [n] v)))))

(defn check
  "Every problem with a loaded profile: [{:level :file :path :message}].
  A profile is usable when no problem has :level :error."
  [{:keys [name runtime manifest yakuwari profile-yaml present] :as prof}]
  (vec
   (concat
    (:problems prof)
    (when-not (some #{"SOUL.md"} present)
      [(problem :warn "SOUL.md" [] "missing")])
    (when-let [pn (get profile-yaml "name")]
      (when (and name (not= pn name))
        [(problem :warn "profile.yaml" ["name"] (str "names " pn ", directory is " name))]))
    (when (and (= runtime "itonami") (some? manifest))
      (concat
       (tag "itonami.edn" (manifest/validate manifest))
       (when (and name (map? manifest) (not= name (:profile/id manifest)))
         [(problem :error "itonami.edn" [:profile/id] (str "is " (pr-str (:profile/id manifest)) ", directory is " name))])
       (when (some? yakuwari)
         (concat (tag "yakuwari.edn" (yakuwari/validate yakuwari))
                 (tag "itonami.edn" (yakuwari/copy-drift (:capabilities manifest) yakuwari))))))
    (when (and (= runtime "hermes") (some #{"yakuwari.edn"} present))
      [(problem :warn "yakuwari.edn" [] "present without itonami.edn; Hermes ignores it")])
    (rail-problems prof))))

(defn errors [problems] (filterv #(= :error (:level %)) problems))

(defn- refuse [reason & [more]]
  (merge {:status :refused :reason reason} more))

(defn dry-run
  "Plan one cron job of an itonami profile without running it.
  opts :capabilities — the capabilities this run would exercise; each is
  decided by yakuwari.edn. An unattended run proceeds only when all are
  :autonomous; :voice-required / :approval-required hold it for the owner,
  :blocked refuses it."
  [prof job-ref {:keys [capabilities]}]
  (let [problems (check prof)
        errs (errors problems)
        {:keys [config jobs manifest yakuwari]} prof
        job (cron/find-job jobs job-ref)]
    (cond
      (not= "itonami" (:runtime prof))
      (refuse "rail/itonami-without-manifest" {:detail "a Hermes profile; itonami-agent runs itonami profiles only"})

      (seq errs) (refuse "profile/invalid" {:problems errs})

      (false? (:cron? manifest)) (refuse "profile/cron-disabled")

      (nil? job) (refuse "job/not-found" {:job job-ref})

      (not (cron/active? job)) (refuse "job/inactive" {:job (get job "id") :state (get job "state")})

      :else
      (let [target (rail/resolve-job config job)
            verdict (rail/inference-verdict (:inference manifest) target)
            decisions (mapv #(yakuwari/decide yakuwari (:authority manifest) %) capabilities)
            worst (cond (some #(= :blocked (:decision %)) decisions) :blocked
                        (some #(not= :autonomous (:decision %)) decisions) :held
                        :else nil)
            base {:profile (:name prof)
                  :job {:id (get job "id") :name (get job "name")
                        :schedule (cron/schedule-display job)
                        :script (get job "script")}
                  :inference (assoc target :verdict verdict)
                  :toolsets (cron/tool-sets-for config job)
                  :reasoning-effort (cron/effective-reasoning-effort config job)
                  :decisions decisions
                  :plan (cron/plan job)
                  :prompt-head (cron/prompt-preview job 120)
                  :side-effects :none}]
        (cond
          (not= verdict "rail/ok") (merge base (refuse verdict))
          (= worst :blocked) (merge base (refuse "authority/blocked"))
          (= worst :held) (merge base {:status :held :reason "authority/needs-owner"})
          :else (merge base {:status :ok}))))))

(defn summary
  "A short, stable view of a check: counts by level and the error messages."
  [problems]
  {:errors (count (errors problems))
   :warnings (count (filter #(= :warn (:level %)) problems))
   :messages (vec (sort (map #(str (:file %) " " (pr-str (:path %)) " " (:message %)) (errors problems))))})

(defn hermes-view
  "What Hermes would read from the same directory: the profile without the
  two itonami files. Used to show itonami.edn is additive."
  [read-text]
  (fn [f] (when-not (some #{f} itonami-files) (read-text f))))
