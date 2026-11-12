(ns itonami.otehon.rail
  "The one check that keeps Hermes and itonami apart, and where a cron job's
  inference would go.

  Verdict strings are the pinned contract of kotoba/itonami/rail.kotoba
  (com-junkawasaki/root ADR-2610222100): rail/ok, rail/hermes-on-murakumo,
  rail/hermes-with-itonami-manifest, rail/itonami-without-manifest,
  rail/itonami-off-murakumo, rail/itonami-without-rail,
  rail/unknown-runtime. This namespace adds the host checks against
  itonami.edn :inference (:authorities, :deny-hosts)."
  (:require [clojure.string :as str]))

(defn murakumo-rail? [name]
  (let [n (str name)]
    (or (str/starts-with? n "murakumo") (str/starts-with? n "mishima"))))

(def opt-in-rails
  "Itonami opt-in rails beyond murakumo/mishima. The default profile
  stays murakumo-only; a profile names one of these explicitly in
  :inference :rails + :authorities to ride it. Existing-token reuse
  is a host-side read (never written by the core)."
  #{:kotoba :itonami-p2p :openrouter :muse :codex :Claude})

(defn opt-in-rail? [rail]
  (contains? opt-in-rails (keyword (str rail))))

(defn runtime-for [has-itonami-edn] (if has-itonami-edn "itonami" "hermes"))

(defn hermes-provider-verdict [name]
  (if (murakumo-rail? name) "rail/hermes-on-murakumo" "rail/ok"))

(defn itonami-rail-verdict [rail]
  (cond (= (str rail) "") "rail/itonami-without-rail"
        (murakumo-rail? rail) "rail/ok"
        (opt-in-rail? rail) "rail/ok"
        :else "rail/itonami-off-murakumo"))

(defn profile-verdict [registry-runtime has-itonami-edn rail]
  (cond (not= registry-runtime (runtime-for has-itonami-edn))
        (case registry-runtime
          "hermes" "rail/hermes-with-itonami-manifest"
          "itonami" "rail/itonami-without-manifest"
          "rail/unknown-runtime")
        has-itonami-edn (itonami-rail-verdict rail)
        :else (hermes-provider-verdict rail)))

(defn host-of
  "The host of an http(s) URL, lower-cased, or nil."
  [url]
  (some-> (re-find #"^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+)" (str url))
          second
          str/lower-case))

(defn- host-match? [host pattern]
  (or (= host pattern) (str/ends-with? host (str "." pattern))))

(defn provider-refs
  "Provider names only (no model ids): the model provider, providers keys,
  fallback provider fields and job provider pins. Itonami checks these
  against the opted-in rails; model ids are provider-scoped and unchecked
  (a codex profile may call its model gpt-5, a Claude one claude-sonnet)."
  [config jobs]
  (let [model (get config "model")]
    (vec (distinct
          (remove #(or (nil? %) (= "" %))
                  (concat
                   (when (map? model) [(get model "provider")])
                   (keys (get config "providers"))
                   (let [fb (get config "fallback_providers")]
                     (cond (string? fb) [fb]
                           (sequential? fb) (map #(if (map? %) (get % "provider") %) fb)
                           :else []))
                   (map #(get % "provider") jobs)))))))

(defn provider-names
  "Every provider name and model id a profile's config.yaml names, plus each
  cron job's pins: the places Hermes resolves a rail from."
  [config jobs]
  (let [model (get config "model")]
    (vec (distinct
          (remove #(or (nil? %) (= "" %))
                  (concat
                   (if (map? model) [(get model "provider") (get model "default")] [model])
                   (keys (get config "providers"))
                   (let [fb (get config "fallback_providers")]
                     (cond (string? fb) [fb]
                           (sequential? fb) (map #(if (map? %) (get % "provider") %) fb)
                           :else []))
                   (mapcat #(vector (get % "provider") (get % "model")) jobs)))))))

(defn resolve-job
  "Where a cron job's inference goes, Hermes' order: the job's provider /
  model / base_url pin, then config.yaml model:. A pinned job disables
  fallback (cron/scheduler.py)."
  [config job]
  (let [model (get config "model")
        model (if (map? model) model {"default" model})
        provider (or (get job "provider") (get model "provider"))
        model-id (or (get job "model") (get model "default"))
        base-url (or (get job "base_url")
                     (get-in config ["providers" provider "base_url"])
                     (get model "base_url"))]
    {:provider provider
     :model model-id
     :base-url base-url
     :host (host-of base-url)
     :pinned? (boolean (or (get job "provider") (get job "model") (get job "base_url")))}))

(defn inference-verdict
  "rail verdict for one resolved inference target of an itonami profile.
  The provider name must be on the murakumo rail or an explicit opt-in
  rail (:kotoba :itonami-p2p :openrouter :muse :codex :Claude), its host
  must not be in :deny-hosts, and must be one of :authorities when the
  manifest names any."
  [inference {:keys [provider host]}]
  (let [deny (get inference :deny-hosts [])
        auth (get inference :authorities)]
    (cond
      (nil? host) "rail/itonami-without-rail"
      (some #(host-match? host %) deny) "rail/denied-host"
      (and (seq auth) (not (some #(host-match? host %) auth))) "rail/host-not-authorised"
      :else (itonami-rail-verdict provider))))
