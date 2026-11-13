(ns itonami.otehon.bundle
  "The itonami profile bundle: what crosses to a peer, its CID, and the
  manifest lifecycle (itonamify/refresh/rail). Ported from profile.cljk
  (bundle-files, bundle-manifest, bundle-cid, default-manifest,
  with-inference-rail, write-manifest!, with-bundle, refresh-bundle-cid).
  Byte-level notes: the bundle JSON follows JavaScript
  stringify-with-indent-2 exactly; job keys follow the legacy source
  order (not set-iteration order); the written itonami.edn is canon
  rendering (key order normalized — content identical, reads back the
  same); the bundle CID is a portable CIDv1-raw computation."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]
            [itonami.otehon.cron :as cron]
            [itonami.otehon.manifest :as manifest]))

(def host-local-config-keys
  "Same set scripts/hermes-profile-repo.cljk keeps on the host."
  #{"secrets" "command_allowlist" "onboarding" "terminal" "skills"})

(def job-fields
  "The bundle's job keys, in legacy source order (select-keys over the
  legacy set has no portable order, so the order is pinned here)."
  ["id" "name" "prompt" "skills" "skill" "script" "no_agent" "schedule"
   "deliver" "enabled" "enabled_toolsets" "model" "provider" "base_url"
   "workdir" "context_from"])

(def rail-authorities
  "The authority server behind each rail. Subscription rails
  (muse/codex/Claude) and the openrouter opt-in rail resolve here;
  secrets stay host-side and are never written into the bundle."
  {:murakumo ["api.murakumo.cloud"]
   :kotoba ["api.kotoba.cloud"]
   :itonami-p2p ["api.kotoba.cloud" "api.murakumo.cloud"]
   :openrouter ["openrouter.ai"]
   :muse ["api.meta.ai"]
   :codex ["api.openai.com"]
   :Claude ["api.anthropic.com"]})

(defn- base-name [rel]
  (last (str/split (str rel) #"/")))

(defn- json-string
  "A JSON string literal with JavaScript escaping (controls other than
  the named ones pass through raw: byte-identical everywhere, and bundle
  content never carries them)."
  [s]
  (str "\""
       (apply str
              (map (fn [ch]
                     (case ch
                       \" "\\\""
                       \\ "\\\\"
                       \backspace "\\b"
                       \formfeed "\\f"
                       \newline "\\n"
                       \return "\\r"
                       \tab "\\t"
                       (str ch)))
                   (str s)))
       "\""))

(defn json-text
  "JSON text with indent 2, JavaScript stringify semantics, except
  objects render their keys SORTED by name: map iteration order differs
  per runner (bb hash-maps above 8 entries), so the legacy file order
  cannot be reproduced portably. Only bundle CIDs hash this text, and
  those are otehon-computed values, so the order only has to agree
  across the three runners."
  [x]
  (letfn [(pad [d] (apply str (repeat (* 2 d) " ")))
          (emit [x d]
            (let [p1 (pad (inc d)) p0 (pad d)]
              (cond (nil? x) "null"
                    (true? x) "true"
                    (false? x) "false"
                    (number? x) (str x)
                    (string? x) (json-string x)
                    (map? x) (if (empty? x) "{}"
                               (str "{\n"
                                    (str/join ",\n"
                                              (map (fn [[k v]]
                                                     (str p1 (json-string (if (keyword? k) (name k) (str k)))
                                                          ": " (emit v (inc d))))
                                                   (sort-by (fn [[k _]] (json-string (if (keyword? k) (name k) (str k)))) x)))
                                    "\n" p0 "}"))
                    (sequential? x) (if (empty? x) "[]"
                                      (str "[\n"
                                           (str/join ",\n" (map (fn [v] (str p1 (emit v (inc d)))) x))
                                           "\n" p0 "]"))
                    :else (throw (ex-info "json-text: unsupported value" {})))))]
    (emit x 0)))

(def hex-digit
  "Hex char (either case) to its value. A map, not String/indexOf, so
  all three runners read the same table."
  {"0" 0 "1" 1 "2" 2 "3" 3 "4" 4 "5" 5 "6" 6 "7" 7
   "8" 8 "9" 9 "a" 10 "b" 11 "c" 12 "d" 13 "e" 14 "f" 15
   "A" 10 "B" 11 "C" 12 "D" 13 "E" 14 "F" 15})

(defn- hex->bytes
  "Hex text to a vector of 0-255 ints."
  [hex]
  (mapv (fn [[a b]]
          (+ (* 16 (hex-digit (str a))) (hex-digit (str b))))
        (partition 2 (str hex))))

(def base32-alphabet "abcdefghijklmnopqrstuvwxyz234567")

(defn base32-lower
  "RFC 4648 base32, lower case, no padding. Verbatim from host.cljk
  (subs, not charAt, so every runner indexes the same way; arithmetic
  bit-shift-right — every shifted value here is non-negative, so it
  equals the legacy unsigned shift on all three runners)."
  [bytes]
  (loop [i 0 bits 0 value 0 out ""]
    (if (< i (count bytes))
      (let [value (bit-or (bit-shift-left value 8) (nth bytes i))
            bits (+ bits 8)
            [out bits] (loop [out out bits bits]
                         (if (>= bits 5)
                           (recur (str out (subs base32-alphabet
                                                 (bit-and (bit-shift-right value (- bits 5)) 31)
                                                 (inc (bit-and (bit-shift-right value (- bits 5)) 31))))
                                  (- bits 5))
                           [out bits]))]
        (recur (inc i) bits (bit-and value 0xff) out))
      (if (pos? bits)
        (let [idx (bit-and (bit-shift-left value (- 5 bits)) 31)]
          (str out (subs base32-alphabet idx (inc idx))))
        out))))

(defn cid-raw
  "CIDv1, raw codec (0x55), sha2-256 multihash, base32 multibase — the
  same shape murakumo model hosting and kotobase use for content blocks.
  Verbatim from host.cljk."
  [data]
  (str "b" (base32-lower (vec (concat [1 0x55 0x12 0x20]
                                      (hex->bytes (hio/sha256-utf8 (str data))))))))

(defn- bundle-config-text
  "config.yaml minus host-local top-level blocks, textually (comments
  and key order survive)."
  [home]
  (let [p (str home "/config.yaml")]
    (when (hio/file? p)
      (let [lines (str/split-lines (hio/slurp-utf8 p))]
        (loop [[l & more] lines skip? false out []]
          (if (nil? l)
            (str (str/join "\n" out) "\n")
            (let [top (second (re-matches #"^([A-Za-z_][A-Za-z0-9_-]*):.*$" l))]
              (cond
                top (if (host-local-config-keys top) (recur more true out) (recur more false (conj out l)))
                skip? (recur more true out)
                :else (recur more false (conj out l))))))))))

(defn- read-jobs-strict [home]
  (let [p (str home "/cron/jobs.json")]
    (if (hio/file? p) (hio/parse-json (hio/slurp-utf8 p)) {"jobs" []})))

(defn bundle-files
  "path -> string content of what crosses to a peer: the profile's
  definition, never its secrets, workspace, sessions, memories or run
  state."
  [home {:keys [skills dirs]}]
  (let [f (fn [rel] (let [p (str home "/" rel)] (when (hio/file? p) [rel (hio/slurp-utf8 p)])))
        jobs (read-jobs-strict home)
        scripts (->> (hio/walk-files! (str home "/scripts")
                                      (fn [r] (or (str/includes? r "__pycache__")
                                                  (str/starts-with? (base-name r) "."))))
                     (remove #(re-find #"\.(sh|bash)$" %))
                     (map #(f (str "scripts/" %))))
        dir-files (for [d dirs
                        :when (and (string? d) (not (str/includes? d "..")) (not (str/starts-with? d "/"))
                                   (not (#{"workspace" "sessions" "memories" "logs" "cache" "cron" "skills"} d)))
                        r (hio/walk-files! (str home "/" d)
                                           (fn [r] (str/starts-with? (base-name r) ".")))]
                    (f (str d "/" r)))
        skill-files (for [s skills
                          r (hio/walk-files! (str home "/skills/" s)
                                             (fn [r] (str/starts-with? (base-name r) ".")))]
                      (f (str "skills/" s "/" r)))]
    (into {}
          (remove nil?
                  (concat [(f "SOUL.md") (f "profile.yaml") (f "itonami.edn")
                           (when-let [c (bundle-config-text home)] ["config.yaml" c])
                           ["cron/jobs.json"
                            (json-text {"jobs" (mapv (fn [job]
                                                       (into {}
                                                             (mapcat (fn [k] (when (contains? job k)
                                                                                [[k (get job k)]]))
                                                                     job-fields)))
                                                     (get jobs "jobs" []))})]]
                          scripts dir-files skill-files)))))

(defn bundle-manifest
  "Sorted [path sha256] pairs; its CID names the bundle. itonami.edn is
  left out of its own CID (it records the CID)."
  [files]
  (vec (for [[p c] (sort-by first files) :when (not= p "itonami.edn")] [p (hio/sha256-utf8 c)])))

(defn bundle-cid [files]
  (cid-raw (json-text (bundle-manifest files))))

(defn- yakuwari-capabilities [home]
  (let [p (str home "/yakuwari.edn")]
    (when (hio/file? p)
      (try (let [y (hio/parse-edn (hio/slurp-utf8 p))]
             (vec (for [c (:yakuwari/capabilities y)]
                    (select-keys c [:capability :decision :note]))))
           (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))))

(defn default-manifest
  "The itonami.edn a Hermes profile gets when it joins the itonami plane."
  [prof]
  (let [home (:home prof)
        cron? (boolean (seq (cron/jobs-of (:jobs prof))))
        files (bundle-files home {})]
    {:itonami/schema manifest/schema-v2
     :profile/id (:name prof)
     :profile/description (get-in prof [:profile-yaml "description"])
     :profile/hermes-compatible true
     :runtime {:engine :itonami-agent
               :scheduler :hermes}
     :placement {:mode :p2p
                 :order [:peer :local]
                 :peers :trusted
                 :inference-rail :murakumo}
     :inference {:rails [:murakumo]
                 :authorities ["api.murakumo.cloud"]
                 :deny-hosts ["openrouter.ai"]}
     :state {:workspace :host-local
             :results :cid-receipts
             :secrets :never-leave-host}
     :bundle {:cid (bundle-cid files)
              :files (count files)
              :skills []}
     :capabilities (or (yakuwari-capabilities home) [])
     :cron? cron?}))

(defn with-inference-rail
  "Point an itonami manifest at one inference rail. The default deny
  on openrouter.ai stays for every rail except an explicit :openrouter
  opt-in, which authorises its host and lifts the deny."
  [m rail]
  (let [deny (or (get-in m [:inference :deny-hosts]) ["openrouter.ai"])]
    (-> m
        (assoc-in [:placement :inference-rail] rail)
        (assoc-in [:inference :rails] [rail])
        (assoc-in [:inference :authorities] (get rail-authorities rail []))
        (assoc-in [:inference :deny-hosts]
                  (if (= rail :openrouter)
                    (vec (remove #{"openrouter.ai"} deny))
                    (vec (distinct (conj (vec deny) "openrouter.ai"))))))))

(defn sorted-edn
  "pr-str of a manifest with EVERY map level ordered by printed key.
  sorted-map is absent from Basilisp, and parsed-map iteration order
  differs per runner (bb hash-maps above 8 entries), so the order is
  explicit at every level: the same manifest always writes the same
  bytes on all three runners. Vectors keep their order; sets sort too."
  [m]
  (letfn [(emit [x]
            (cond (map? x) (str "{" (str/join ", " (map (fn [[k v]] (str (pr-str k) " " (emit v)))
                                                        (sort-by (fn [[k _]] (pr-str k)) x)))
                                "}")
                  (set? x) (str "#{" (str/join " " (sort (map emit x))) "}")
                  (sequential? x) (str "[" (str/join " " (map emit x)) "]")
                  :else (pr-str x)))]
    (emit m)))

(defn write-manifest!
  "Write an itonami.edn: the header plus sorted-edn (key order
  normalized — content identical, reads back the same)."
  [home m]
  (hio/replace-file! (str home "/itonami.edn")
                     (str ";; itonami profile (" (:itonami/schema m manifest/schema-v2) "). Additive to the Hermes layout:\n"
                          ";; Hermes ignores this file; removing it returns the profile to plain Hermes.\n"
                          (sorted-edn m) "\n")))

(defn with-bundle
  "The manifest with its bundle CID and file count recomputed from the
  profile's current SOUL, config, jobs, scripts and declared skills/dirs."
  [home m]
  (let [files (bundle-files home (select-keys (:bundle m) [:skills :dirs]))]
    (assoc m :bundle (merge (:bundle m) {:cid (bundle-cid files) :files (count files)}))))

(defn read-manifest
  "The profile's itonami.edn, or nil when absent or unparsable."
  [home]
  (let [p (str home "/itonami.edn")]
    (when (hio/file? p)
      (try (hio/parse-edn (hio/slurp-utf8 p))
           (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))))

(defn refresh-bundle-cid
  "Recompute the bundle CID of an itonami profile and write it back.
  Returns the manifest."
  [home]
  (let [m (with-bundle home (read-manifest home))]
    (write-manifest! home m)
    m))

(def definition-files
  "What a profile IS, in the format both stores share. Verbatim from
  profile.cljk: everything else under a profile home is state and stays
  with the store that produced it."
  ["SOUL.md" "profile.yaml" "config.yaml" ".env" "secrets.command"
   "yakuwari.edn" "itonami.edn" "cron/jobs.json"])

(def definition-dirs ["scripts" "skills"])

(defn copy-profile!
  "Copy one profile's DEFINITION from one store's home to another's,
  byte for byte. State never crosses. Returns {:copied [rel ...]} in
  definition order (files) then sorted walk order (dirs). A non-empty
  target is refused unless `force?`. Verbatim from profile.cljk."
  [from-home to-home force?]
  (when-not (hio/dir? from-home)
    (throw (ex-info (str "profile not found: " from-home) {})))
  (when (and (not force?) (hio/dir? to-home) (seq (hio/read-dir-names to-home)))
    (throw (ex-info (str "target is not empty: " to-home) {})))
  (let [files (concat
               (for [f definition-files
                     :let [p (str from-home "/" f)]
                     :when (hio/file? p)]
                 [f p])
               (for [d definition-dirs
                     r (hio/walk-files! (str from-home "/" d)
                                        #(str/starts-with? (hio/basename %) "."))
                     :let [p (str from-home "/" d "/" r)]]
                 [(str d "/" r) p]))]
    (doseq [[rel p] files]
      (hio/copy-file! p (str to-home "/" rel)))
    {:copied (mapv first files)}))
