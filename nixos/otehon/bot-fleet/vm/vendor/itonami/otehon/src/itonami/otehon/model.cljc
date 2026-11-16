(ns itonami.otehon.model
  "Model/provider display and the textual config.yaml edit.

  Ported from provider.cljk (the chain/resolution display side: Hermes
  `hermes model` / `hermes fallback` show) and profile.cljk
  (set-model-text with its yaml-scalar writer). Pure: the CLI threads the
  profile directory and does the one file write, so the shared cases
  assert the same lines the legacy commands print. The live inference
  calls (complete-hop, breakers) stay host-side work for slice S2."
  (:require [clojure.string :as str]
            [itonami.otehon.text :as text]))

;; ---------------------------------------------------------------- provider chain

(def built-in
  "Provider defaults when the profile names no endpoint of its own.
  Verbatim from provider.cljk, plus the opt-in subscription rails
  (muse/codex/Claude): OpenAI-compatible defaults; per-profile
  providers.<name> base_url/key_env overrides win, and subscription
  OAuth file seams stay host-side reads (never written by the core)."
  {"kotoba"     {"base_url" "https://api.kotoba.cloud/v1"   "key_env" "KOTOBA_API_TOKEN"}
   "murakumo"   {"base_url" "https://api.murakumo.cloud/v1" "key_env" "MURAKUMO_API_TOKEN"}
   "openrouter" {"base_url" "https://openrouter.ai/api/v1"  "key_env" "OPENROUTER_API_KEY"}
   "openrouter-free" {"base_url" "https://openrouter.ai/api/v1" "key_env" "OPENROUTER_API_KEY"}
   "nous"       {"base_url" "https://inference-api.nousresearch.com/v1" "key_env" "NOUS_API_KEY"}
   "openai"     {"base_url" "https://api.openai.com/v1"     "key_env" "OPENAI_API_KEY"}
   "muse"       {"base_url" "https://api.meta.ai/v1"        "key_env" "MUSE_API_TOKEN"}
   "codex"      {"base_url" "https://api.openai.com/v1"     "key_env" "CODEX_API_TOKEN"}
   "Claude"      {"base_url" "https://api.anthropic.com/v1"  "key_env" "ANTHROPIC_API_KEY"}
   "itonami-p2p" {"base_url" "http://127.0.0.1:7420/v1"}})

(def default-headers
  {"HTTP-Referer" "https://itonami.cloud"
   "X-Title" "Itonami By KotobaLabs"})

(defn stream-hop?
  "Whether a hop asks for `stream: true` (SSE). Verbatim from
  provider.cljk: config wins, unset streams only on the murakumo rail."
  [provider pc mc]
  (let [m (get mc "stream") r (get pc "stream")]
    (cond (some? m) (boolean m)
          (some? r) (boolean r)
          :else (= provider "murakumo"))))

(defn- strip-slashes [s]
  (str/replace (str s) #"/+$" ""))

(defn resolve-hop
  "One {provider model base-url key-env ...} entry -> a callable hop.
  Verbatim from provider.cljk, except the itonami-p2p port rides on the
  `peer-port` argument (the legacy reads ITONAMI_PEER_PORT itself) so the
  function stays pure."
  [config {:strs [provider model base_url key_env]} peer-port]
  (let [pc (get-in config ["providers" provider])
        bi (if (= provider "itonami-p2p")
             {"base_url" (str "http://127.0.0.1:" (or peer-port "7420") "/v1")}
             (get built-in provider))
        base (or base_url (get pc "base_url") (get bi "base_url")
                 (when (= provider (get-in config ["model" "provider"]))
                   (get-in config ["model" "base_url"])))
        mc (get-in pc ["models" model])]
    {:provider provider
     :model model
     :base-url (when (some? base) (strip-slashes base))
     :key-env (or key_env (get pc "key_env") (get pc "api_key_env") (get bi "key_env"))
     :headers (merge default-headers (get pc "extra_headers"))
     :extra-body (get pc "extra_body")
     :timeout-s (or (get mc "timeout_seconds") (get pc "request_timeout_seconds") 900)
     :timeout-explicit? (boolean (or (get mc "timeout_seconds") (get pc "request_timeout_seconds")))
     :stream? (stream-hop? provider pc mc)}))

(defn chain
  "The ordered hops for a run. opts: {:model :provider :pinned?} from a
  job or the CLI (-m / --provider). Verbatim from provider.cljk."
  [config {:keys [model provider pinned?]} peer-port]
  (let [m (or model (get-in config ["cron" "model"]) (get-in config ["model" "default"]))
        pv (or provider (get-in config ["cron" "model_provider"]) (get-in config ["model" "provider"]))
        primary (resolve-hop config {"provider" pv "model" m
                                     "base_url" (when (= pv (get-in config ["model" "provider"]))
                                                  (get-in config ["model" "base_url"]))}
                             peer-port)
        fb (let [f (get config "fallback_providers")
                 legacy (get config "fallback_model")]
             (cond (sequential? f) f (map? legacy) [legacy] :else []))
        fb (for [e fb :when (and (get e "provider") (get e "model"))] (resolve-hop config e peer-port))]
    (vec (distinct (if pinned? [primary] (cons primary fb))))))

(defn resolution
  "The effective model resolution for `config` and run `opts`, with the
  SOURCE of each choice — the `model` / `fallback` display side. Sources
  follow the chain verbatim: run override -> cron.model -> model.default,
  override -> cron.model_provider -> model.provider. An override is a PIN.
  `peer-port` feeds itonami-p2p hops (nil = the 7420 default)."
  [config opts peer-port]
  (let [opts (assoc opts :pinned? (boolean (or (:pinned? opts) (:model opts))))
        m (or (:model opts) (get-in config ["cron" "model"]) (get-in config ["model" "default"]))
        m-src (cond (:model opts) "override (-m / job pin)"
                    (get-in config ["cron" "model"]) "cron.model"
                    (get-in config ["model" "default"]) "model.default"
                    :else "unset")
        pv (or (:provider opts) (get-in config ["cron" "model_provider"]) (get-in config ["model" "provider"]))
        pv-src (cond (:provider opts) "override (--provider / job pin)"
                     (get-in config ["cron" "model_provider"]) "cron.model_provider"
                     (get-in config ["model" "provider"]) "model.provider"
                     :else "unset")]
    {:model {:value m :source m-src}
     :provider {:value pv :source pv-src}
     :pinned? (boolean (:pinned? opts))
     :hops (->> (chain config opts peer-port)
                (map (fn [h] {:provider (:provider h) :model (:model h)}))
                distinct
                vec)}))

;; ---------------------------------------------------------------- display lines

(defn model-lines
  "The legacy `model` show lines for a resolution. `written?` adds the
  `(written to config.yaml)` line, exactly as the set path does."
  [{:keys [model provider hops]} written?]
  (vec (concat [(str "model:     " (:value model) "   (" (:source model) ")")
                (str "provider:  " (:value provider) "   (" (:source provider) ")")]
               (when written? ["(written to config.yaml)"])
               ["chain:"]
               (mapv (fn [[i h]] (str "  " (inc i) ". " (:provider h) "/" (:model h)))
                     (map-indexed vector hops)))))

(defn fallback-lines
  "The legacy `fallback` show lines: every hop past the primary, or the
  no-fallback line, plus the pinned-run note."
  [{:keys [hops pinned?]}]
  (vec (concat (if (seq (drop 1 hops))
                 (mapv (fn [[i h]] (str "fallback " (inc i) ". " (:provider h) "/" (:model h)))
                       (map-indexed vector (drop 1 hops)))
                 ["no fallback hops in the effective chain"])
               (when pinned? ["(pinned run — fallback is disabled)"]))))

;; ---------------------------------------------------------------- arg validation

(defn- bad-provider-value? [v]
  (or (not (string? v))
      (text/blank? (str v))
      (text/starts-with? (str v) "-")))

(defn model-request
  "Validate model-command arguments. `pos` = positional strings,
  `run-model` = the -m/--model run override (or nil), `provider` =
  {:present bool :value} for --provider. Mirrors model-cmd's die-2 order;
  returns {:show true} | {:set {:model :provider}} | {:error msg}."
  [pos run-model provider]
  (cond
    (< 1 (count pos))
    {:error "usage: itonami-agent model [NAME] [--provider P] [--profile P]"}

    (and (seq pos) (some? run-model))
    {:error "model NAME and -m/--model cannot combine: NAME writes the default, -m overrides one run"}

    (and (:present provider) (bad-provider-value? (:value provider)))
    {:error "--provider must be a provider name"}

    (seq pos)
    (let [m (str/trim (str (first pos)))]
      (if (str/blank? m)
        {:error "model name must be non-empty"}
        {:set {:model m :provider (:value provider)}}))

    :else {:show true}))

;; ---------------------------------------------------------------- yaml scalar writer

(def ^:private control-chars
  "Code points that cannot round-trip through config.yaml: the C0
  controls except tab/newline plus DEL. Built from code points via
  `char` — no escapes in source, the same idiom text.cljc uses."
  (set (map char (concat (range 0 9) (range 11 14) (range 14 32) [127]))))

(defn- reader-coerces?
  "TRUE when the YAML scalar reader would turn this PLAIN token into a
  non-string (or refuse it). Verbatim from profile.cljk: the exclusion set
  is exactly the reader's behavior, not YAML folklore."
  [s]
  (or (= s "")
      (contains? #{"~" "null" "Null" "NULL"
                   "true" "True" "TRUE" "false" "False" "FALSE"
                   "[]"} s)
      (= s "{}")
      (and (text/starts-with? s "[") (text/ends-with? s "]"))
      (boolean (re-matches #"-?\d+" s))
      (boolean (re-matches #"-?\d+\.\d+([eE][-+]?\d+)?" s))
      (contains? #{"|" ">" "|-" ">-"} s)
      (or (text/starts-with? s "&") (text/starts-with? s "*") (text/starts-with? s "!"))))

(defn yaml-scalar
  "Write a value as a safe YAML scalar. Verbatim from profile.cljk: plain
  only when the reader hands it back as the same string, else a
  double-quoted scalar with exactly the reader's four escapes; any other
  control character refuses the write."
  [v]
  (let [s (str v)]
    (if (and (boolean (re-matches #"[A-Za-z0-9._/-]+" s))
             (not (reader-coerces? s)))
      s
      (do
        (when (some control-chars s)
          (throw (ex-info "this value contains a control character config.yaml cannot round-trip" {})))
        (str (char 34)
             (-> s
                 (str/replace (str (char 92)) (str (char 92) (char 92)))
                 (str/replace (str (char 34)) (str (char 92) (char 34)))
                 (str/replace "\n" (str (char 92) "n"))
                 (str/replace "\t" (str (char 92) "t")))
             (char 34))))))

;; ---------------------------------------------------------------- textual model edit

(defn- line-unclosed-value?
  "TRUE when this line's value is a quoted scalar the reader cannot close.
  Verbatim from profile.cljk (the R9/R11 fold contract)."
  [l]
  (let [v (or (second (re-find #"^\s*(?:-\s+)?(?:\"[^\"]*\"|'[^']*'|[^:]+)\s*:\s*(.*)$" l))
              (second (re-find #"^\s*-\s+(\S.*)$" l)))
        unclosed? (fn [v q esc-form?]
                    (loop [i 1 esc? false]
                      (cond
                        (>= i (count v)) true
                        esc? (recur (inc i) false)
                        (and esc-form? (= (nth v i) (char 92))) (recur (inc i) true)
                        (= (nth v i) q)
                        (if (and (not esc-form?) (= (get v (inc i)) q))
                          (recur (+ i 2) false)
                          (not (boolean (re-matches #"\s*(?:#.*)?" (subs v (inc i))))))
                        :else (recur (inc i) false))))]
    (boolean
     (when v
       (cond
         (text/starts-with? v "\"") (unclosed? v \" true)
         (text/starts-with? v "'") (unclosed? v \' false)
         :else false)))))

(defn set-model-text
  "Write the default model (and optional provider) into config.yaml text.
  The edit is TEXTUAL: comments, formatting and keys outside
  model.default/model.provider survive verbatim. Verbatim from
  profile.cljk, with throws as ex-info carrying the same messages."
  [text model provider]
  (let [lines (str/split-lines (str text))
        strip-comment (fn [l]
                        (loop [i 0 in-q nil esc? false]
                          (if (>= i (count l))
                            l
                            (let [c (nth l i)]
                              (cond
                                esc? (recur (inc i) in-q false)
                                (and (= in-q \") (= c \"))
                                (recur (inc i) nil false)
                                (and (= in-q \') (= c \'))
                                (recur (inc i) nil false)
                                (and (not in-q) (= c \#)
                                     (or (zero? i) (re-matches #"\s" (str (nth l (dec i))))))
                                (subs l 0 i)
                                (and (not in-q) (or (= c \") (= c \')))
                                (recur (inc i) c false)
                                (and (= in-q \") (= c \\))
                                (recur (inc i) in-q true)
                                :else (recur (inc i) in-q false))))))
        top-line? (fn [l]
                    (let [s (strip-comment l)]
                      (and (not (str/blank? l))
                           (not (str/blank? s))
                           (not (boolean (re-matches #"\s+.*" l)))
                           (not (text/starts-with? (str/trim s) "#"))
                           (not= "---" (str/trim s)))))
        start (last (keep-indexed (fn [i l]
                                    (when (and (top-line? l)
                                               (re-matches #"(?:\"model\"|'model'|model)\s*:(\s+(#.*)?)?" l))
                                      i))
                                  lines))
        block-end (if (nil? start)
                    nil
                    (or (first (for [i (range (inc start) (count lines))
                                     :let [l (nth lines i)]
                                     :when (top-line? l)]
                                 i))
                        (count lines)))
        body (when start (vec (subvec (vec lines) start block-end)))
        _ (when (and body (some (fn [l] (boolean (re-matches #"^\s+-.*" l))) body))
            (throw (ex-info "refusing to edit a model block that is a sequence, not a mapping" {})))
        child-indent (when body (or (first (for [l (rest body)
                                                 :when (and (re-matches #"\s+\S.*" l)
                                                            (not (re-matches #"\s*#.*" l)))]
                                             (count (re-find #"^\s*" l))))
                                    2))
        pad (apply str (repeat child-indent " "))
        key-rx (fn [k] (re-pattern (str "^" pad "(?:\"" k "\"|'" k "'|" k ")\\s*:.*$")))
        folded? (fn [ls idx]
                  (let [l (nth ls idx)
                        opens (line-unclosed-value? l)
                        nxt (get ls (inc idx))
                        block-scalar? (let [c (text/index-of l ":")]
                                        (when c
                                          (let [val (str/trim (strip-comment (subs l (inc c))))]
                                            (and (seq val)
                                                 (contains? #{\| \>} (first val))
                                                 (every? #{\- \+} (rest val))
                                                 (<= (count val) 2)))))
                        deeper? (fn [x] (when (and x (re-matches #"\s+\S.*" x)
                                                   (not (re-matches #"\s*#.*" x)))
                                          (> (count (re-find #"^\s*" x))
                                             (count (re-find #"^\s*" l)))))
                        any-deeper? (when block-scalar?
                                      (some (fn [x] (and x (re-matches #"\s+\S.*" x) (deeper? x)))
                                            (drop 1 ls)))]
                    (or opens any-deeper? (deeper? nxt))))
        trailing-comment (fn [l]
                           (loop [i 0 in-q nil esc? false]
                             (if (>= i (count l))
                               nil
                               (let [c (nth l i)]
                                 (cond
                                   esc? (recur (inc i) in-q false)
                                   (and (= in-q \") (= c \"))
                                   (recur (inc i) nil false)
                                   (and (= in-q \') (= c \'))
                                   (recur (inc i) nil false)
                                   (and (not in-q) (= c \#)
                                        (or (zero? i) (re-matches #"\s" (str (nth l (dec i))))))
                                   (subs l i)
                                   (and (not in-q) (or (= c \") (= c \')))
                                   (recur (inc i) c false)
                                   (and (= in-q \") (= c \\))
                                   (recur (inc i) in-q true)
                                   :else (recur (inc i) in-q false))))))
        replace-key (fn [ls k value]
                      (let [rx (key-rx k)
                            hits (keep-indexed (fn [i l] (when (re-matches rx l) i)) ls)
                            idx (last hits)
                            keep (remove (set (butlast hits)) (vec (range (count ls))))
                            ls (mapv #(nth ls %) keep)
                            idx (last (keep-indexed (fn [i l] (when (re-matches rx l) i)) ls))
                            comment (when idx (trailing-comment (nth ls idx)))
                            line (str pad k ": " (yaml-scalar value)
                                      (when comment
                                        (if (text/starts-with? comment " ") comment (str " " comment))))]
                        (if (nil? idx)
                          (conj (vec ls) line)
                          (assoc (vec ls) idx line))))]
    (when (some line-unclosed-value? lines)
      (throw (ex-info "refusing to edit a folded multi-line value (an unclosed quote swallows the file) — unwrap it by hand first" {})))
    (cond
      (nil? start)
      (str (str text)
           (when (and (pos? (count (str text)))
                      (not (text/ends-with? (str text) "\n")))
             "\n")
           (str/join "\n" (filter some? ["model:"
                                          (str "  default: " (yaml-scalar model))
                                          (when-not (str/blank? (str provider))
                                            (str "  provider: " (yaml-scalar provider)))]))
           "\n")

      :else
      (let [key-idxs (fn [k] (keep-indexed (fn [i l] (when (re-matches (key-rx k) l) i)) body))
            _ (doseq [k (cond-> ["default"] (not (str/blank? (str provider))) (conj "provider"))
                      idx (key-idxs k)
                      :when (folded? body idx)]
                (throw (ex-info (str "refusing to edit a folded multi-line model." k
                                     " — unwrap it by hand first") {})))
            body (cond-> body
                   true (replace-key "default" model)
                   (not (str/blank? (str provider))) (replace-key "provider" provider))]
        (str (str/join "\n" (concat (subvec (vec lines) 0 start) body (subvec (vec lines) block-end)))
             (when (seq lines) "\n"))))))
