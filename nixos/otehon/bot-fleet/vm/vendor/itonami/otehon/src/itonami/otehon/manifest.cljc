(ns itonami.otehon.manifest
  "What an itonami.edn may say, checked without reading anything.

  A .cljc port of src/itonami/agent/manifest.cljk `validate` (same keys,
  same messages, same levels) plus the Two CLIs rule on :inference
  :deny-hosts. itonami.edn grants nothing: :capabilities is a copy of what
  yakuwari.edn decides, and Hermes skips the file entirely."
  (:require [clojure.string :as str]))

(def schema-v1 "cloud.itonami.profile.v1")
(def schema-v2 "cloud.itonami.profile.v2")
(def schemas #{schema-v1 schema-v2})

(def rails #{:murakumo :kotoba :itonami-p2p :openrouter :muse :codex :Claude})
(def kinds #{:steward :unit :role-bot :organism :worker})
(def worlds #{:etzhayyim :awai :kotoba :host})

;; yakuwari's decision vocabulary and its legacy spellings; any other word
;; reads as :blocked (yakuwari fails closed).
(def decisions #{:autonomous :voice-required :approval-required :blocked})
(def legacy-decisions {:self-executing :autonomous :propose :approval-required :forbidden :blocked})

(def required-deny-host
  "Two CLIs: an itonami profile never reaches the Hermes aggregator rail,
  unless it explicitly opts into the openrouter rail (rails names
  :openrouter and authorities names its host)."
  "openrouter.ai")

(defn openrouter-opt-in?
  "Explicit openrouter opt-in: the profile rides :openrouter and
  authorises its host. Default profiles keep the deny."
  [m]
  (boolean
   (and (some #{:openrouter} (get-in m [:inference :rails]))
        (some #{"openrouter.ai"} (get-in m [:inference :authorities])))))

(def org-keys
  [:agent/kind :org/world :org/path :org/github :org/unit :org/layer :invocation
   :awai/business :ids :authority])

(def known-keys
  (into #{:itonami/schema :profile/id :profile/description :profile/hermes-compatible
          :runtime :placement :inference :state :bundle :capabilities :cron? :terminal :web}
        org-keys))

(defn problem [level path msg] {:level level :path path :message msg})
(defn- err [path msg] (problem :error path msg))
(defn- warn [path msg] (problem :warn path msg))
(defn- vec-of? [pred x] (and (vector? x) (every? pred x)))

(defn- check [m path required? pred msg]
  (let [v (get-in m path ::absent)]
    (cond
      (= ::absent v) (when required? (err path "missing"))
      (not (pred v)) (err path msg))))

(defn- sorted-words [s] (str/join " " (sort (map str s))))

(defn- decision-problems [caps]
  (when (vector? caps)
    (for [[i c] (map-indexed vector caps)
          :let [d (:decision c) path [:capabilities i :decision]]
          p [(when-not (keyword? (:capability c)) (err [:capabilities i :capability] "not a keyword"))
             (cond
               (contains? decisions d) nil
               (contains? legacy-decisions d)
               (warn path (str d " is a legacy spelling; yakuwari reads it as " (get legacy-decisions d)))
               :else (warn path (str (pr-str d) " is not in the yakuwari vocabulary; yakuwari reads it as :blocked")))]
          :when p]
      p)))

(defn validate
  "Problems with a manifest: [{:level :error|:warn :path [...] :message s}],
  [] when it is clean."
  [m]
  (if-not (map? m)
    [(err [] "not a map")]
    (let [v2? (= schema-v2 (:itonami/schema m))
          rail (get-in m [:placement :inference-rail])
          inf-rails (get-in m [:inference :rails])
          deny (get-in m [:inference :deny-hosts])
          world (:org/world m)
          path (:org/path m)]
      (vec
       (concat
        (keep #(apply check m %)
              [[[:itonami/schema] true schemas (str "not one of " (str/join ", " (sort schemas)))]
               [[:profile/id] true #(boolean (and (string? %) (re-matches #"^[a-z0-9][a-z0-9_-]{0,63}$" %))) "not a profile name"]
               [[:profile/description] false #(or (nil? %) (string? %)) "not a string"]
               [[:profile/hermes-compatible] true true? "must be true: Hermes ignores itonami.edn"]
               [[:runtime :engine] true #{:itonami-agent} "not :itonami-agent"]
               [[:runtime :scheduler] true #{:hermes :itonami :launchd} "not one of :hermes :itonami :launchd"]
               [[:placement :mode] true #{:p2p :local} "not one of :p2p :local"]
               [[:placement :order] true #(and (vec-of? #{:peer :local} %) (seq %)) "not a non-empty vector of :peer / :local"]
               [[:placement :peers] false #{:trusted} "not :trusted"]
               [[:placement :inference-rail] true rails "not one of :murakumo :kotoba :itonami-p2p :openrouter :muse :codex :Claude"]
               [[:inference :rails] false #(and (vec-of? rails %) (seq %)) "not a non-empty vector of rails"]
               [[:inference :authorities] false #(vec-of? string? %) "not a vector of host names"]
               [[:inference :deny-hosts] false #(vec-of? string? %) "not a vector of host names"]
               [[:state] true map? "not a map"]
               [[:bundle :cid] true #(and (string? %) (str/starts-with? % "b")) "not a CIDv1 (base32, starts with b)"]
               [[:bundle :files] true nat-int? "not a count"]
               [[:bundle :skills] false #(vec-of? string? %) "not a vector of skill names"]
               [[:bundle :dirs] false #(vec-of? string? %) "not a vector of directories"]
               [[:capabilities] true #(vec-of? map? %) "not a vector of {:capability :decision}"]
               [[:cron?] true boolean? "not a boolean"]
               [[:terminal] false map? "not a map"]
               [[:web] false map? "not a map"]
               [[:agent/kind] false kinds (str "not one of " (sorted-words kinds))]
               [[:org/world] false worlds (str "not one of " (sorted-words worlds))]
               [[:org/path] false #(vec-of? keyword? %) "not a vector of keywords"]
               [[:org/github] false string? "not a GitHub org name"]
               [[:org/unit] false #(or (keyword? %) (string? %)) "not a keyword or string"]
               [[:org/layer] false keyword? "not a keyword"]
               [[:invocation] false #{:resident :on-demand} "not one of :resident :on-demand"]
               [[:awai/business] false keyword? "not a business id"]
               [[:ids] false map? "not a map"]
               [[:ids :did] false #(boolean (re-matches #"^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]+$" (str %))) "not an ed25519 did:key"]
               [[:authority] false map? "not a map"]
               [[:authority :default-decision] false decisions "not in the yakuwari vocabulary"]
               [[:authority :source] false #{:yakuwari} "not :yakuwari"]])
        (keep identity
              [(when (and (seq inf-rails) (keyword? rail) (not (some #{rail} inf-rails)))
                 (err [:placement :inference-rail] "not among :inference :rails"))
               ;; Two CLIs (AGENTS.md): the itonami rail denies the Hermes aggregator,
               ;; unless the profile explicitly opts into :openrouter.
               (when-not (or (and (vector? deny) (some #{required-deny-host} deny))
                               (openrouter-opt-in? m))
                 (err [:inference :deny-hosts] (str "must name " required-deny-host " (Two CLIs: itonami never rides the Hermes rail)")))
               (when (and v2? (nil? world))
                 (warn [:org/world] "v2 manifest not placed in the organisation (profile organize)"))
               (when (and (= :host world) (seq path))
                 (err [:org/path] "a :host profile sits outside the organisation tree"))
               (when (and (contains? worlds world) (not= :host world) (vector? path) (not (some #{world} path)))
                 (err [:org/path] "does not contain :org/world"))])
        (decision-problems (:capabilities m))
        (for [k (keys m) :when (not (contains? known-keys k))]
          (warn [k] "unknown key")))))))

(defn errors [problems] (filterv #(= :error (:level %)) problems))

(defn with-org
  "Project a registry entry onto a manifest and mark it v2. The organisation
  keys are replaced as a set; every other key is untouched. :ids is the
  cross-walk to the profile's source repo and yakuwari id. :authority points
  at yakuwari.edn when the profile has one; without it the profile may only
  ask (:approval-required). Verbatim from manifest.cljk."
  [m entry {:keys [yakuwari?]}]
  (let [repo (get-in entry [:source :repo])
        ;; manifest/agent-registry.edn writes :yakuwari/id; the P1 draft nested it
        yid (or (:yakuwari/id entry) (get-in entry [:yakuwari :id]))
        ids (cond-> {}
              repo (assoc :repo repo)
              yid (assoc :yakuwari/id (str yid))
              (:did entry) (assoc :did (:did entry)))
        org (into {} (remove (comp nil? val))
                  (select-keys entry [:agent/kind :org/world :org/path :org/github :org/unit
                                      :org/layer :invocation :awai/business]))]
    (cond-> (merge (apply dissoc m org-keys) org)
      true (assoc :itonami/schema schema-v2
                  :authority (cond-> {:default-decision :approval-required}
                               yakuwari? (assoc :source :yakuwari :ref "yakuwari.edn")))
      (seq ids) (assoc :ids ids))))
