(ns itonami.otehon.cli
  "itonami-otehon: check a profile, dry-run one cron job, plan a real run,
  gate one turn, plan a store move, run the shared cases.

    check      <profile-dir>
    dry-run    <profile-dir> <job-id-or-name> [--capability <name>]...
    tick       <profile-dir>
    turn-gate  <profile-dir> <prompt> [--capability <name>]...
    oneshot    <profile-dir> <prompt> [--capability <name>]...
    muse-oneshot <profile-dir> <prompt-file> <new-output> <binding.edn>
    run-plan   <profile-dir> <job-id-or-name> [--capability <name>]...
               [--script-file <path> | --script-error <text>] [--script-no-wake]
    store-plan --direction import|export --from <dir> --to <dir> [--force]
    pause      [reason words]...   (the store is ITONAMI_DIR, else ~/.itonami)
    resume
    status
    model      <dir> [NAME] [--provider P] [--model M]
    fallback   <dir> [-m M] [--provider P]
    run-exec   <dir> <job> [--capability c]...   (agent turns stop pending: S2b)
    cas-put    <store> <file>...
    cas-get    <store> <sha> <out>
    cas-verify <store>
    cas-gc     <store> [--apply] [--retain-days N]
    cas-reconcile <store> <peerdir>... [--as <node> --registry <reg.edn>]
    fleet-status <peerdir>... [--as <node> --registry <reg.edn>] [--copies N]
    peer-push  <store> <peerdir> [--as <node> --registry <reg.edn>]
    peer-pull  <store> <peerdir> [--as <node> --registry <reg.edn>]
    peer-repair <store> <peerdir>... [--as <node> --registry <reg.edn>]
    market-match <asks.edn> <bids.edn> [--today YYYY-MM-DD] [--secrets <secrets.edn>]
    market-sign <att.edn> --issuer-secret <secret>
    market-verify <att.edn> --suite-secret <secret> [--today YYYY-MM-DD]
    test       <cases.edn>

  tick, turn-gate and run-plan decide without doing: no script runs, no
  inference is called, nothing is saved (side-effects :none). oneshot
  gates the same way, then applies the host's finished turn (the CLI
  has no executor, so a gated turn without one stays pending, exit 3).
  store-plan
  prints the copy plan; the host copies the bytes. pause, resume and
  status touch and read the store exactly like the legacy CLI (the pause
  marker text and every status line are verbatim), so their shared cases
  assert the same strings.
  Output is one canonical EDN value (sorted map keys) so the three runners
  can be compared byte for byte. Exit 0 ok, 1 refused / errors / failures,
  2 held for the owner, 64 usage."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]
            [itonami.otehon.pause :as pause]
            [itonami.otehon.status :as status]
            [itonami.otehon.model :as model]
            [itonami.otehon.exec :as exec]
            [itonami.otehon.cron :as cron]
            [itonami.otehon.profile :as profile]
            [itonami.otehon.yakuwari :as yakuwari]
            [itonami.otehon.yaml :as yaml]
            [itonami.otehon.text :as text]
            [itonami.otehon.assembly :as assembly]
            [itonami.otehon.confine :as confine]
            [itonami.otehon.quiet :as quiet]
            [itonami.otehon.tick :as tick]
            [itonami.otehon.store :as store]
            [itonami.otehon.turn :as turn]
            [itonami.otehon.muse-host :as muse-host]
            [itonami.otehon.execute :as execute]
            [itonami.otehon.tts :as tts]
            [itonami.otehon.collect :as collect]
            [itonami.otehon.collect-io :as collect-io]
            [itonami.otehon.clarify :as clarify]
            [itonami.otehon.webguard :as webguard]
            [itonami.otehon.browser :as browser]
            [itonami.otehon.browser-cloud :as browser-cloud]
            [itonami.otehon.browser-provider :as browser-provider]
            [itonami.otehon.vault :as vault]
            [itonami.otehon.dapps :as dapps]
            [itonami.otehon.oauth :as oauth]
            [itonami.otehon.connections :as connections]
            [itonami.otehon.rails :as rails]
            [itonami.otehon.mcp :as mcp]
            [itonami.otehon.homeassistant :as homeassistant]
            [itonami.otehon.computer-use :as computer-use]
            [itonami.otehon.code-rpc :as code-rpc]
            [itonami.otehon.run :as run]
            [itonami.otehon.doctor :as doctor]
            [itonami.otehon.sessions :as sessions]
            [itonami.otehon.notepad :as notepad]
            [itonami.otehon.bundle :as bundle]
            [itonami.otehon.manifest :as manifest]
            [itonami.otehon.soul :as soul]
            [itonami.otehon.ed25519 :as ed]
            [itonami.otehon.cas :as cas]
            [itonami.otehon.peer :as peer]
            [itonami.otehon.market :as market]
            [itonami.otehon.queue :as queue]
            [itonami.otehon.ledger :as ledger]
            [itonami.otehon.delivery :as delivery]
            [itonami.otehon.drain :as drain]
            [itonami.otehon.gateway :as gateway]
            [itonami.otehon.process :as process]
            [itonami.otehon.quiet :as quiet]
            [itonami.otehon.watcher :as watcher]
            [itonami.otehon.adapters :as adapters]
            [itonami.otehon.chat :as chat]
            [itonami.otehon.tools :as tools]
            [itonami.otehon.store-fs :as store-fs]
            [itonami.otehon.query-plan :as query-plan]
            [itonami.otehon.scan-budget :as scan-budget]))

;; ---------------------------------------------------------------- canonical print

(defn- esc [s]
  (-> s (str/replace "\\" "\\\\") (str/replace "\"" "\\\"")
      (str/replace "\n" "\\n") (str/replace "\t" "\\t")))

(defn canon
  "A deterministic EDN rendering: map entries sorted by their printed key,
  strings escaped the same way on every runner."
  [x]
  (cond
    (nil? x) "nil"
    (string? x) (str "\"" (esc x) "\"")
    (keyword? x) (str x)
    (boolean? x) (if x "true" "false")
    (map? x) (str "{" (str/join ", " (sort (map (fn [[k v]] (str (canon k) " " (canon v))) x))) "}")
    (set? x) (str "#{" (str/join " " (sort (map canon x))) "}")
    (sequential? x) (str "[" (str/join " " (map canon x)) "]")
    :else (str x)))

;; ---------------------------------------------------------------- profile access

(defn- index-of [s sub] (str/index-of s sub))

(defn- replace-first [s from to]
  (if-let [i (index-of s from)]
    (str (subs s 0 i) to (subs s (+ i (count from))))
    (throw (ex-info (str "edit anchor not found: " from) {:anchor from}))))

(defn- apply-edits
  "Wrap read-text with the case's text edits:
  [file from to] replaces the first `from`; [file :delete] removes the file;
  [file :set text] replaces it whole."
  [read-text edits]
  (reduce (fn [rt [f a b]]
            (fn [rel]
              (let [t (rt rel)]
                (if (not= rel f)
                  t
                  (cond (= a :delete) nil
                        (= a :set) b
                        (nil? t) nil
                        :else (replace-first t a b))))))
          read-text edits))

(defn- load-dir [dir read-text]
  (assoc (profile/load-profile {:name (hio/basename dir) :read-text read-text
                                :parse-edn hio/parse-edn :parse-json hio/parse-json})
         :home dir))

(defn check-result [prof]
  (let [ps (profile/check prof)]
    (merge {:profile (:name prof) :runtime (:runtime prof)} (profile/summary ps))))

;; ---------------------------------------------------------------- shared cases

;; Forward: the store-backed case ops live below with the other store
;; code (gather lives next to its CLI commands), while observe dispatches
;; every op from here. `declare` is the same idiom yaml.cljc uses.
(declare ops-pause ops-status ops-model ops-fallback ops-run ops-oneshot ops-doctor ops-doctor-kinds ops-sessions ops-notepad ops-profile ops-runs ops-incidents ops-queue ops-ledger ops-delivery ops-drain ops-gateway ops-watcher ops-adapters ops-chat ops-quiet ops-confine ops-send ops-peer ops-tools ops-assembly ops-execute ops-tts ops-collect ops-clarify ops-webguard ops-vault ops-browser ops-browser-cloud ops-browser-provider ops-oauth ops-collect-io ops-process ops-dapps ops-connections ops-rails ops-mcp ops-homeassistant ops-computer-use ops-code-rpc)

(defn- subset?
  "Every key of `want` holds in `got` (nested maps compared the same way)."
  [want got]
  (every? (fn [[k v]]
            (let [g (get got k)]
              (if (and (map? v) (map? g)) (subset? v g) (= v g))))
          want))

(defn- includes-all? [msgs needles]
  (every? (fn [n] (some #(str/includes? % n) msgs)) needles))

(defn- observe
  "What one case's operation returns for the given read-text. The :pause
  and :status ops touch a real store instead: they seed a fresh scratch
  directory and run the same gather code the CLI commands use."
  [c dir read-text scratch]
  (case (:op c)
    :pause (ops-pause c scratch)
    :status (ops-status c scratch)
    :model (ops-model c scratch)
    :fallback (ops-fallback c scratch)
    :run (ops-run c scratch)
    :oneshot (ops-oneshot c dir read-text)
    :doctor (ops-doctor c scratch)
    :sessions (ops-sessions c scratch)
    :notepad (ops-notepad c scratch)
    :profile (ops-profile c scratch)
    :runs (ops-runs c scratch)
    :incidents (ops-incidents c scratch)
    :queue (ops-queue c scratch)
    :ledger (ops-ledger c scratch)
    :delivery (ops-delivery c)
    :drain (ops-drain c scratch)
    :gateway (ops-gateway c)
    :watcher (ops-watcher c)
    :adapters (ops-adapters c)
    :chat (ops-chat c scratch)
    :quiet (ops-quiet c)
    :turn-asm (ops-assembly c)
    :turn-exec (ops-execute c)
    :tts (ops-tts c)
    :collect (ops-collect c)
    :clarify (ops-clarify c)
    :webguard (ops-webguard c)
    :vault (ops-vault c)
    :browser (ops-browser c)
    :browser-cloud (ops-browser-cloud c)
    :browser-provider (ops-browser-provider c)
    :oauth (ops-oauth c)
    :collect-io (ops-collect-io c)
    :process (ops-process c)
    :dapps (ops-dapps c scratch)
    :connections (ops-connections c scratch)
    :rails (ops-rails c)
    :mcp (ops-mcp c)
    :homeassistant (ops-homeassistant c)
    :computer-use (ops-computer-use c)
    :code-rpc (ops-code-rpc c)
    :doctor-kinds (ops-doctor-kinds c)
    :confine (ops-confine c scratch)
    :send (ops-send c)
    :peer (ops-peer c scratch)
    :tools (ops-tools c)
    :check (check-result (load-dir dir read-text))
    :dry-run (profile/dry-run (load-dir dir read-text) (:job c) {:capabilities (:capabilities c [])})
    :tick (let [prof (load-dir dir read-text)
                prof (if (contains? c :jobs) (assoc prof :jobs (:jobs c)) prof)]
            (tick/tick-plan (:jobs prof) (:now c)))
    :turn-gate (turn/turn-gate (load-dir dir read-text) (:prompt c "")
                               {:capabilities (:capabilities c [])
                                :toolsets (:toolsets c)
                                :tool-names (:tool-names c)
                                :known-catalog (when (contains? c :known-catalog)
                                                 (set (:known-catalog c)))
                                :platform (:platform c)})
    :run-plan (let [prof (load-dir dir read-text)
                    prof (if (contains? c :jobs) (assoc prof :jobs (:jobs c)) prof)]
                (run/run-plan prof (:job c)
                              {:capabilities (:capabilities c [])
                               :script (:script c)
                               :now (:now c {:iso "2026-11-08T00:00:00+09:00"
                                             :parts {:year 2026 :month 11 :day 8 :hour 0 :minute 0}})
                               :stamp (:stamp c "2026-11-08_00-00-00")
                               :run-at (:run-at c "2026-11-08 00:00:00")}))
    :store (store/plan-copy {:from (:source c {}) :to (:target c {})
                             :force? (:force? c) :direction (:direction c :export)
                             :from-name (:from-name c) :to-name (:to-name c)})
    :apply-order (run/apply-order {:job-id (:job-id c) :stamp (:stamp c)
                                  :status (:result-status c)
                                  :output-path (:output-path c)
                                  :record (:record c) :deliver (:deliver c)})
    :cas-sha {:sha (cas/sha256-hex (:bytes c []))}
    :cas-gc-plan (cas/gc-plan (:manifest c {}) (:inventory c {}))
    :manifest-rebuild (cas/manifest-rebuild (:local c {}) (:objects c []) (:remotes c []))
    :fleet-copies (peer/fleet-copies (:remotes c []))
    :fleet-plan (let [fc (peer/fleet-copies (:remotes c []))
                      plan (peer/replication-plan (:copies fc) (:desired c 2))]
                  (assoc plan :peers (:peers fc) :objects (:objects fc)))
    :retention-plan (cas/retention-plan (:manifest c {}) (:inventory c {})
                                      (:tombs c {}) (:today c "") (:days c 0))
    :cas-parse-int {:value (cas/parse-int (:text c ""))}
    :cas-manifest (let [files (:files c {})
                        tamper (:tamper c {})
                        absent (set (:absent c []))
                        m (reduce (fn [mm [rel bs]] (cas/manifest-add mm rel bs)) {} files)]
                    (cas/verify-manifest m (fn [rel] (if (contains? absent rel) nil (get (merge files tamper) rel)))))
    :peer-plan (peer/sync-plan (:local c {}) (:remote c {}))
    :peer-repair-plan (peer/repair-plan {:mismatch (:mismatch c [])
                                         :missing (:missing c [])}
                                        (:remotes c []))
    :market-match (market/match-orders (:asks c []) (:bids c []))
    :market-attest {:valid (market/valid-attestation? (:att c) (:today c ""))}
    :market-sign {:sig (:sig (market/sign-attestation (:att c {}) (:secret c "")))}
    :market-verify {:valid (market/valid-signature? (:att c {}) (:secrets c {}))}
    :market-match-signed (market/match-signed (:asks c []) (:bids c []) (:secrets c))
    :market-verify-asym (let [called (atom nil)
                              record (fn [p s k] (reset! called {:payload p :sig s :pub k}) true)
                              stub (case (:via c "deny")
                                     "allow" (fn [p s k] (record p s k) true)
                                     "echo" (fn [p s k] (record p s k) {:echoed [p s k]})
                                     "hmac" (fn [p s k] (record p s k)
                                              (market/verify-hmac-sig p s k))
                                     (fn [p s k] (record p s k) false))]
                          (assoc (market/verify-asymmetric (:att c {}) (:pubkeys c {})
                                                           stub (:today c ""))
                                 :called-with @called))
    :decide (let [p (load-dir dir read-text)]
              (yakuwari/decide (:yakuwari p) (get-in p [:manifest :authority]) (:capability c)))
    :additive (let [full (load-dir dir read-text)
                    bare (load-dir dir (profile/hermes-view read-text))]
                {:hermes-files-same (= (select-keys full [:config :profile-yaml :jobs])
                                       (select-keys bare [:config :profile-yaml :jobs]))
                 :runtime-full (:runtime full)
                 :runtime-bare (:runtime bare)})
    :yaml (try {:value (yaml/parse (:text c))}
               (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                 {:refused (or (:yaml/refused (ex-data e)) :error)}))
    :text (let [[f & args] (:call c)]
            {:value (case f
                      "trim" (text/trim (first args))
                      "triml" (text/triml (first args))
                      "trimr" (text/trimr (first args))
                      "blank?" (text/blank? (first args))
                      "starts-with?" (text/starts-with? (first args) (second args))
                      "ends-with?" (text/ends-with? (first args) (second args))
                      "includes?" (text/includes? (first args) (second args))
                      "index-of" (text/index-of (first args) (second args))
                      "lower-case" (text/lower-case (first args))
                      "join" (text/join (first args) (second args))
                      "split" (text/split (first args) (second args))
                      "split-lines" (text/split-lines (first args))
                      "replace" (text/replace (first args) (second args) (nth args 2))
                      (throw (ex-info (str "text: unknown fn " f) {:fn f})))})
    :store-fs (let [[f & args] (:call c)]
                {:value (case f
                          "storage-verdict" (store-fs/storage-verdict (first args))
                          "fs-route-code" (store-fs/fs-route-code (first args))
                          "fs-usage-line-count" (store-fs/fs-usage-line-count (first args))
                          "tier-for" (store-fs/tier-for (first args))
                          "mount-required?" (store-fs/mount-required? (first args))
                          "placement-verdict" (store-fs/placement-verdict (first args) (second args))
                          (throw (ex-info (str "store-fs: unknown fn " f) {:fn f})))})
    :query-plan {:plan (query-plan/plan (:q c {}))}
    :scan-budget (let [[f & args] (:call c)]
                   (case f
                     "check" (scan-budget/check (:budget c {}) (:stats c {}))
                     "over-budget?" {:value (scan-budget/over-budget? (:budget c {}) (:stats c {}))}
                     "add-read" (scan-budget/add-read (:stats c {}) (first args) (second args))
                     "add-matches" (scan-budget/add-matches (:stats c {}) (first args))
                     (throw (ex-info (str "scan-budget: unknown fn " f) {:fn f}))))))

(defn- satisfied? [c got]
  (let [want (:expect c)]
    (and (subset? (dissoc want :messages-include :reason-in :needles) got)
         (includes-all? (:messages got) (:messages-include want []))
         (or (nil? (:reason-in want)) (contains? (:reason-in want) (:reason got))))))

;; ---------------------------------------------------------------- store ops
;; pause / resume / status touch a real store (unlike the fixture-text
;; cases above): each case gets a fresh directory under test/scratch and
;; seeds it with :seed {relative-path text}. The legacy commands never
;; refuse these paths (a missing file reads as absent, garbage as
;; not-live), so there are no negative controls here — the adversarial
;; seeds (garbage pid, unparsable peers, unnamable profile dirs) are the
;; coverage, asserted as positive cases.

(defn- scratch-case-dir [scratch c]
  (str scratch "/" (namespace (:id c)) "-" (name (:id c))))

(defn- seed-files! [dir seeds]
  ;; every store case starts from an empty directory: seeds overwrite,
  ;; but a previous runner's created files (itonamify's manifest, a
  ;; ledger ack) would otherwise leak into the next runner's case
  (hio/wipe-dir! dir)
  (hio/mkdirs! dir)
  (doseq [[rel text] seeds]
    (let [p (str dir "/" rel)]
      (hio/mkdirs! (hio/dirname p))
      (hio/write-text! p (str text)))))

(defn- read-trim [path]
  (let [t (when (hio/file? path) (hio/slurp-utf8 path))]
    (when (some? t) (str/trim t))))

(defn- read-edn-or [path dflt]
  (try (if (hio/file? path)
         (let [v (hio/parse-edn (hio/slurp-utf8 path))]
           (if (nil? v) dflt v))
         dflt)
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ dflt)))

(defn- read-json-or [path dflt]
  (try (if (hio/file? path)
         (let [v (hio/parse-json (hio/slurp-utf8 path))]
           (if (nil? v) dflt v))
         dflt)
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ dflt)))

(defn- listing-names [root]
  "Profile names under a store root: valid names whose directory exists,
  sorted so every runner lists the same order. Mirrors profile.cljk
  names-in (the legacy order is filesystem order, which differs per
  host readdir)."
  (let [d (str root "/profiles")]
    (vec (sort (filter #(and (status/valid-name? %)
                             (hio/dir? (str d "/" %)))
                       (hio/read-dir-names d))))))

(defn- gather-status
  "Read a store root into status/render-status data. Missing files read
  as absent (no profiles, not running, zero peers); an unparsable
  peers.edn reads nil (the legacy `?`)."
  [root]
  (let [marker (str root "/paused")
        paused (when (hio/file? marker) (pause/since-of (hio/slurp-utf8 marker)))
        names (listing-names root)
        rows (mapv (fn [n]
                     (let [home (str root "/profiles/" n)
                           m (read-edn-or (str home "/itonami.edn") nil)
                           jobs (read-json-or (str home "/cron/jobs.json") nil)
                           jobs (if (map? jobs) (get jobs "jobs") jobs)]
                       (status/profile-row n m (if (sequential? jobs) jobs []))))
                   names)
        tick (status/pid-state (read-trim (str root "/gateway.pid"))
                               (hio/pid-alive? (read-trim (str root "/gateway.pid"))))
        serve (status/pid-state (read-trim (str root "/gateway-serve.pid"))
                                (hio/pid-alive? (read-trim (str root "/gateway-serve.pid"))))
        peers (if (hio/file? (str root "/peers.edn"))
                  (try (count (:trusted (hio/parse-edn (hio/slurp-utf8 (str root "/peers.edn")))))
                       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))
                  0)]
    {:paused paused :profiles rows
     :gateway-tick tick :gateway-serve serve :peers-trusted peers}))

(defn- ops-pause [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    {:steps (mapv (fn [st]
                    (case (:action st)
                      "set" (do (hio/mkdirs! dir)
                                (hio/write-text! (pause/marker-path dir)
                                                 (pause/format-record (:at st "2026-11-08T00:00:00+09:00")
                                                                      (:reason st)))
                                {:action "set"
                                 :message (pause/pause-message (:reason st))
                                 :active true
                                 :record (pause/since-of (hio/slurp-utf8 (pause/marker-path dir)))})
                      "show" (let [m (pause/marker-path dir)
                                   on? (hio/file? m)]
                               {:action "show"
                                :active on?
                                :record (when on? (pause/since-of (hio/slurp-utf8 m)))})
                      "lift" (let [m (pause/marker-path dir)
                                   was (hio/file? m)]
                               (when was (hio/delete-file! m))
                               {:action "lift"
                                :message (pause/resume-message was)
                                :was-active was
                                :active (boolean (hio/file? m))})
                      {:action (:action st) :status :refused :reason "pause/unknown-action"}))
                  (:steps c []))}))

(defn- ops-status [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [r (gather-status dir)]
      (assoc r :lines (status/render-status r)))))

;; ---------------------------------------------------------------- model ops

(defn- model-flags
  "Split model/fallback tail args into positionals, the -m/--model run
  override and --provider. Value flags consume the next token verbatim
  (even a dash-prefixed one, even when missing — the legacy parse-args
  rule, so a bare --provider refuses the same way). `--model=` /
  `--provider=` spellings also work."
  [args]
  (loop [as (seq args) pos [] run-model nil provider {:present false :value nil}]
    (cond (nil? as) {:pos pos :run-model run-model :provider provider}
          (or (= "-m" (first as)) (= "--model" (first as)))
          (if (second as)
            (recur (nnext as) pos (second as) provider)
            (recur (next as) pos run-model provider))
          (text/starts-with? (first as) "--model=")
          (recur (next as) pos (subs (first as) 8) provider)
          (= "--provider" (first as))
          (if (second as)
            (recur (nnext as) pos run-model {:present true :value (second as)})
            (recur (next as) pos run-model {:present true :value nil}))
          (text/starts-with? (first as) "--provider=")
          (recur (next as) pos run-model {:present true :value (subs (first as) 11)})
          :else (recur (next as) (conj pos (first as)) run-model provider))))

(defn- resolve-in [dir flags]
  (let [prof (load-dir dir (hio/read-text-fn dir))]
    (model/resolution (:config prof)
                      {:model (:run-model flags) :provider (get-in flags [:provider :value])}
                      (hio/env "ITONAMI_PEER_PORT"))))

(defn- model-input
  "Case input for the :model / :fallback ops: raw CLI tail tokens in
  :args (exercising the flag parser), or a structured :request (which can
  also carry values tokens cannot, like a non-string provider)."
  [c]
  (if (contains? c :args)
    (model-flags (:args c))
    {:pos (get-in c [:request :pos] [])
     :run-model (get-in c [:request :run-model])
     :provider (get-in c [:request :provider] {:present false})}))

(defn- ops-model [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [{:keys [pos run-model provider]} (model-input c)
          req (model/model-request pos run-model provider)]
      (if (:error req)
        req
        (if-let [s (:set req)]
          (let [p (str dir "/config.yaml")
                cur (when (hio/file? p) (hio/slurp-utf8 p))]
            (try
              (let [written (model/set-model-text (or cur "") (:model s) (:provider s))]
                (hio/mkdirs! dir)
                (hio/replace-file! p written)
                (let [r (resolve-in dir {:run-model run-model :provider provider})]
                  {:written written :lines (model/model-lines r true)}))
              (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                {:status :refused :reason (ex-message e)})))
          (let [r (resolve-in dir {:run-model run-model :provider provider})]
            {:lines (model/model-lines r false)}))))))

(defn- ops-fallback [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [{:keys [pos run-model provider]} (model-input c)]
      (if (seq pos)
        {:error "usage: itonami-agent fallback [--profile P] [-m model]"}
        (let [r (resolve-in dir {:run-model run-model :provider provider})]
          {:lines (model/fallback-lines r)})))))

;; ---------------------------------------------------------------- run execution

(defn- safe-parse [s]
  (try (hio/parse-json (str s))
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))

(defn- jobs-file [home] (str home "/cron/jobs.json"))

(defn- read-jobs-vec [home]
  (try (let [p (jobs-file home)]
         (if (hio/file? p)
           (vec (cron/jobs-of (hio/parse-json (hio/slurp-utf8 p))))
           []))
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ [])))

(defn- update-jobs-doc!
  "Read/modify/write cron/jobs.json preserving top-level extension fields
  and stamping updated_at — the legacy write-jobs-unlocked! contract
  (formatting stays compact; parsed content is what both sides read).
  `f` takes the doc and its jobs vector and returns the updated doc
  (with \"jobs\" replaced)."
  [home micros f]
  (let [doc (try (let [v (when (hio/file? (jobs-file home))
                              (hio/parse-json (hio/slurp-utf8 (jobs-file home))))]
                      (if (map? v) v {}))
                    (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ {}))
        jobs (vec (cron/jobs-of doc))]
    (hio/mkdirs! (str home "/cron"))
    (hio/replace-file! (jobs-file home)
                       (hio/json-str (assoc (f doc jobs) "updated_at" micros)))))

(defn- hy-deps
  "Resolve Hy's site-packages for script runs. `env-map` is the merged
  profile+host env. Verbatim from the cron.cljk resolution, minus the
  memo (one CLI run resolves once); POSIX separators only — Otehon has
  no Windows runner."
  [prof env-map]
  (let [configured (or (get env-map "KOTOBA_HY_DEPS") (hio/env "KOTOBA_HY_DEPS"))
        paths (when (string? configured) (remove str/blank? (str/split configured #":")))
        valid? (and (seq paths)
                    (some #(hio/file? (str % "/hy/__init__.py")) paths)
                    (some #(hio/file? (str % "/funcparserlib/__init__.py")) paths))
        home (:home prof)
        hermes-root (or (some-> (hio/env "ITONAMI_HERMES_ROOT") (exec/expand-home (hio/env "HOME")))
                        (when (and (string? home) (str/includes? home "/.hermes/profiles/"))
                          (hio/dirname (hio/dirname home))))]
    (or (when valid? (str/join ":" paths))
        (when hermes-root
          (let [installs (str hermes-root "/installs")
                cands (for [install (hio/read-dir-names installs)
                            :let [envs (str installs "/" install "/environments")]
                            environment (hio/read-dir-names envs)
                            :let [libs (str envs "/" environment "/venv/lib")]
                            py-version (hio/read-dir-names libs)
                            :let [sp (str libs "/" py-version "/site-packages")]
                            :when (and (hio/file? (str sp "/hy/__init__.py"))
                                       (hio/file? (str sp "/funcparserlib/__init__.py")))]
                        sp)]
            (when (seq cands) (str/join ":" cands)))))))

(defn- script-env
  [prof home script-ref]
  (let [base (merge (:env prof {}) {"HERMES_HOME" home "ITONAMI_PROFILE_HOME" home})]
    (if (boolean (re-find #"\.hy$" (str/lower-case (str script-ref))))
      (if-let [deps (hy-deps prof base)]
        (assoc base "KOTOBA_HY_DEPS" deps)
        base)
      base)))

(defn- spawn-script!
  "Run one job script ref; always returns {:ok? :output :wake?}. The wake
  flag is true unless the last output line parses as wakeAgent false —
  the run-plan contract (a failed gate still skips the turn). Paths the
  child sees are absolute: it resolves relatives against its own cwd."
  [prof job script-ref]
  (let [home (hio/abs-path (:home prof))
        scripts (str home "/scripts")
        check (exec/check-script scripts script-ref {:symlink? hio/symlink? :file? hio/file?})]
    (if (not= :ok (:status check))
      {:ok? false :output (:reason check) :wake? true}
      (let [env (script-env prof home script-ref)
            workdir (exec/expand-home (or (get job "workdir") scripts) (hio/env "HOME"))
            argv (exec/script-argv script-ref (:path check)
                                   [(get job "interpreter")
                                    (get-in prof [:config "cron" "script_python"])
                                    (get env "ITONAMI_PYTHON")
                                    (get env "HERMES_PYTHON")])
            res (hio/spawn-sync! argv {:cwd workdir
                                       :timeout-ms (* 1000 (exec/script-timeout-s (:config prof) env))
                                       :env env})
            [ok? out] (exec/script-result res)]
        {:ok? ok? :output out :wake? (not (exec/wake-false? out safe-parse))}))))

(defn- current-row [home job-id]
  (first (filter #(= job-id (get % "id")) (read-jobs-vec home))))

(defn- append-error-section
  "A failed run's doc appends the raw error under `## Error`, and the job
  row records the full text as last_error. Verbatim from run-job-core."
  [doc err-text]
  (str doc "\n## Error\n\n```\n" err-text "\n```\n"))

(defn- apply-and-save!
  "Write the output doc, prune past 50, and apply the finished-run record
  to the CURRENT jobs.json row. Returns the output path."
  [home job-id doc failed? error delivery-error stamp micros]
  (let [outdir (str home "/cron/output/" job-id)
        f (str outdir "/" stamp ".md")]
    (hio/mkdirs! outdir)
    (hio/replace-file! f doc)
    (doseq [old (exec/prune-outputs (hio/read-dir-names outdir))]
      (hio/delete-file! (str outdir "/" old)))
    (let [jobs (read-jobs-vec home)
          cur (first (filter #(= job-id (get % "id")) jobs))]
      (when cur
        (update-jobs-doc! home micros
          (fn [doc js] (assoc doc "jobs" (exec/jobs-with js (exec/apply-record cur micros failed? error delivery-error)))))))
    f))

(defn- run-monitor!
  "Evaluate a job's monitor_script (monitor_url refuses: fetching needs
  the network). Applies the snapshot + monitor_state writes on change. Returns nil
  (no monitor), {:refused ...}, or the exec/monitor-decide verdict with
  the script result attached."
  [prof job micros]
  (let [ms (some-> (get job "monitor_script") str/trim not-empty)
        url (some-> (get job "monitor_url") str/trim not-empty)]
    (cond
      (some? ms)
      (let [home (:home prof)
            id (get job "id")
            s (spawn-script! prof job ms)
            digest (hio/sha256-utf8 (:output s))
            snap (str home "/cron/output/" id "/monitor_last_output.txt")
            old (when (hio/file? snap) (hio/slurp-utf8 snap))
            state (get (current-row home id) "monitor_state")
            d (exec/monitor-decide {:ok? (:ok? s) :output (:output s)}
                                   {:digest digest :old-output old :old-hash (get state "last_output_hash")}
                                   micros)]
        (when (:changed? d)
          (hio/mkdirs! (str home "/cron/output/" id))
          (hio/replace-file! snap (:snapshot d))
          (let [jobs (read-jobs-vec home)
                cur (first (filter #(= id (get % "id")) jobs))]
            (when cur
              (update-jobs-doc! home micros
                (fn [doc js] (assoc doc "jobs" (exec/jobs-with js (assoc cur "monitor_state" (:state d)))))))))
        (assoc d :script s))
      (some? url) {:refused "monitor/monitor-url-unavailable"}
      :else nil)))

(defn- exec-plan [prof job-ref capabilities now stamp run-at script monitor-context notepad]
  (run/run-plan prof job-ref {:capabilities capabilities :script script :now now
                              :stamp stamp :run-at run-at
                              :notepad notepad :linked nil :monitor-context monitor-context}))

(defn- run-step-stub
  "The host's live step-fn, as a stub (mirrors the `:turn-exec` `:via`
  selection): the `:request` `:step` name picks the rail outcome. `ok`
  returns the legacy turn fields with `:status :ok`; anything else fails
  the way a real rail failure would (failed map, throw, garbage)."
  [name]
  (case (str name)
    "fail" (fn [_] {:status :failed :reason "rail/unavailable"})
    "throw" (fn [_] (throw (ex-info "run: stub threw" {})))
    "bad" (fn [_] "ran-inference")
    (fn [_] {:status :ok :final "live did it" :exit-reason "completed"
             :turns 1 :provider "murakumo" :model "mishima"
             :usage {"prompt_tokens" 10 "completion_tokens" 20 "total_tokens" 30}
             :attempts [{:provider "murakumo" :model "mishima" :status "ok"}]})))

(defn- apply-turn!
  "Apply a finished agent turn: doc, jobs.json record and audit rows.
  Verbatim from run-job-core. `turn` is the executor result; `deliver`
  emulates the delivery adapter (\"ok\" or an error string; nil means no
  adapter is configured). The executions ledger and the delivery queue
  stay slice S5, so only their observable inputs (status, messages, rows)
  are produced here."
  [home job prompt turn deliver micros stamp run-at]
  (let [started (hio/now-ms)
        {:keys [final failed? silent? err-text]} (exec/turn-outcome turn)
        response (if failed?
                   (str final (when err-text (str "\n\n## Error\n\n```\n" err-text "\n```")))
                   final)
        doc (run/output-doc job {:prompt prompt :response response :failed? failed?
                                 :status-line (exec/turn-status-line turn)} run-at)
        target (exec/deliver-target job failed?)
        delivery-error (when-not silent? (exec/turn-delivery-error target deliver))
        f (apply-and-save! home (get job "id") doc failed? err-text delivery-error stamp micros)
        status (exec/turn-status failed? delivery-error silent?)
        execution-id (hio/random-hex 16)
        usage (exec/usage-entry {:ts micros :job-id (get job "id") :fire-id (hio/random-hex 8)
                                 :prompt-tokens (get-in turn [:usage "prompt_tokens"])
                                 :completion-tokens (get-in turn [:usage "completion_tokens"])
                                 :total-tokens (get-in turn [:usage "total_tokens"])
                                 :silent? silent? :deliver-target target
                                 :delivery-error delivery-error :model (:model turn)
                                 :duration-ms (- (hio/now-ms) started) :error err-text})
        run-row (exec/run-entry {:ts micros :job-id (get job "id") :execution-id execution-id
                                 :manual? true :status status :exit-reason (:exit-reason turn)
                                 :turns (:turns turn) :provider (:provider turn) :model (:model turn)
                                 :peer (:peer turn) :receipt (:receipt turn) :placement (:placement turn)
                                 :attempts (:attempts turn) :output-file f})]
    (hio/append-text! (str home "/cron/usage_audit.jsonl") (str (hio/json-str usage) "\n"))
    (hio/append-text! (str home "/cron/itonami-runs.jsonl") (str (hio/json-str run-row) "\n"))
    {:exit (if (= "error" status) 1 0)
     :lines [(str "ran " (get job "id") ": " status)]
     :detail {:status status :output-file f :output-doc doc
              :job-after (current-row home (get job "id"))
              :usage-row usage :run-row run-row}}))

(defn- apply-planned-turn!
  "Apply a `:planned` turn with the host's live `:step-fn`: run the
  plan's `:exec` through `execute/run-turn`, fold the transcript into
  the legacy turn shape, and save it the legacy way. `mon` carries the
  monitor snapshot/state passthrough."
  [home job prompt plan mon opts micros stamp run-at]
  (let [transcript (execute/run-turn {:status :ok :exec (:exec plan)}
                                     {:step-fn (:step-fn opts)})
        turn (execute/turn-from-transcript transcript)
        r (apply-turn! home job prompt turn (:deliver opts) micros stamp run-at)]
    (update r :detail assoc :snapshot (:snapshot mon) :monitor-state (:state mon))))

(defn- execute-run
  "Run one job's host side now. `now-map` = {:iso :parts :ms}; `opts`
  carries the test-only turn injection {:turn :deliver} and the live
  step-fn injection {:step-fn :deliver} (the product command has no
  executor yet, so a planned turn with neither stays pending).
  Returns {:exit :lines :detail}: detail carries :status plus
  the saved artifacts (output-doc, job-after, snapshot, monitor-state,
  audit rows) for the shared cases."
  [prof job-ref capabilities now-map opts]
  (let [home (:home prof)
        iso (:iso now-map)
        now {:iso iso :parts (:parts now-map)}
        stamp (exec/stamp-of iso)
        run-at (exec/human-of iso)
        micros (exec/micros-of iso (:ms now-map))
        ;; the notepad section rides agent-turn prompts only (read-only;
        ;; a missing store reads as empty). no_agent docs never render it,
        ;; exactly like the legacy no-agent path.
        found (cron/find-job (:jobs prof) job-ref)
        nsec (when (and (some? found) (not (true? (get found "no_agent"))))
               (notepad/render-section home (get found "id")))
        plan (exec-plan prof job-ref capabilities now stamp run-at nil nil nsec)]
    (cond
      (= :refused (:status plan))
      {:exit 1 :lines [(str "refused: " (:reason plan))] :detail {:status "refused" :reason (:reason plan)}}

      (= :held (:status plan))
      {:exit 2 :lines [(str "held: " (:reason plan))] :detail {:status "held" :reason (:reason plan)}}

      (contains? #{:silent :ok} (:status plan))
      (let [f (apply-and-save! home (get-in plan [:job :id]) (:output-doc plan) false nil nil stamp micros)
            id (get-in plan [:job :id])]
        {:exit 0
         :lines [(str "ran " id ": " (name (:status plan)))]
         :detail {:status (name (:status plan)) :output-file f
                 :output-doc (:output-doc plan) :job-after (current-row home id)}})

      :else
      (let [job (cron/find-job (:jobs prof) job-ref)
            has-mon (or (some-> (get job "monitor_script") str/trim not-empty)
                        (some-> (get job "monitor_url") str/trim not-empty))
            mon (when (and (some? job) (some? has-mon)) (run-monitor! prof job micros))]
        (cond
          (some? (:refused mon))
          {:exit 1 :lines [(:refused mon)] :detail {:status "refused" :reason (:refused mon)}}

          (and (some? mon) (false? (:ok? mon)))
          (let [msg (str "Monitor source failed: " (:error mon))
                doc (append-error-section
                     (run/output-doc job {:prompt (or (get job "prompt") "")
                                          :response (str "[CRON_FAILURE] " msg)
                                          :failed? true} run-at)
                     msg)
                f (apply-and-save! home (get job "id") doc true msg nil stamp micros)]
            {:exit 1
             :lines [(str "ran " (get job "id") ": error")]
             :detail {:status "error" :output-file f :output-doc doc
                      :job-after (current-row home (get job "id"))}})

          (and (some? mon) (false? (:changed? mon)))
          (let [doc (run/output-doc job {:prompt "" :response "[SILENT]"
                                         :status-line "**Status:** monitor output unchanged"} run-at)
                f (apply-and-save! home (get job "id") doc false nil nil stamp micros)]
            {:exit 0
             :lines [(str "ran " (get job "id") ": silent")]
             :detail {:status "silent" :output-file f :output-doc doc
                      :job-after (current-row home (get job "id"))}})

          :else
          (let [plan2 (if (and (some? mon) (:changed? mon))
                        (exec-plan prof job-ref capabilities now stamp run-at nil (:context mon) nsec)
                        plan)
                req (first (:exec plan2))]
            (cond
              (contains? #{:silent :ok} (:status plan2))
              (let [failed? (= "script_error" (:exit-reason plan2))
                    err-text (when failed?
                               (str/replace-first (str (:final plan2))
                                                  (str run/failure-token " ") ""))
                    doc (if failed? (append-error-section (:output-doc plan2) err-text)
                            (:output-doc plan2))
                    f (apply-and-save! home (get-in plan2 [:job :id]) doc
                                       failed? err-text nil stamp micros)
                    id (get-in plan2 [:job :id])]
                {:exit (if failed? 1 0)
                 :lines [(str "ran " id ": " (if failed? "error" (name (:status plan2))))]
                 :detail {:status (if failed? "error" (name (:status plan2)))
                          :output-file f :output-doc doc
                          :job-after (current-row home id)
                          :snapshot (:snapshot mon) :monitor-state (:state mon)}})

              (and (= :planned (:status plan2)) (= "script" (:id req)))
              (let [script (spawn-script! prof (cron/find-job (:jobs prof) job-ref)
                                          (get-in plan2 [:job :script]))
                    plan3 (exec-plan prof job-ref capabilities now stamp run-at script
                                     (when (and (some? mon) (:changed? mon)) (:context mon)) nsec)]
                (cond
                  (contains? #{:silent :ok} (:status plan3))
                  (let [failed? (= "script_error" (:exit-reason plan3))
                        err-text (when failed?
                                   (str/replace-first (str (:final plan3))
                                                      (str run/failure-token " ") ""))
                        doc (if failed? (append-error-section (:output-doc plan3) err-text)
                                (:output-doc plan3))
                        f (apply-and-save! home (get-in plan3 [:job :id]) doc
                                           failed? err-text nil stamp micros)
                        id (get-in plan3 [:job :id])]
                    {:exit (if failed? 1 0)
                     :lines [(str "ran " id ": " (if failed? "error" (name (:status plan3))))]
                     :detail {:status (if failed? "error" (name (:status plan3)))
                              :output-file f :output-doc doc
                              :job-after (current-row home id)
                              :snapshot (:snapshot mon) :monitor-state (:state mon)}})

                  (= :planned (:status plan3))
                  (cond (:step-fn opts)
                        (apply-planned-turn! home job (:prompt plan3) plan3
                                             mon opts micros stamp run-at)

                        (:turn opts)
                        (let [r (apply-turn! home job (:prompt plan3)
                                             (:turn opts) (:deliver opts) micros stamp run-at)]
                          (update r :detail assoc :snapshot (:snapshot mon) :monitor-state (:state mon)))

                        :else
                        {:exit 3
                         :lines [(str "inference pending for " (get-in plan3 [:job :id])) (canon plan3)]
                         :detail {:status "pending" :plan (canon plan3)
                                  :snapshot (:snapshot mon) :monitor-state (:state mon)}})

                  :else
                  {:exit (if (= :held (:status plan3)) 2 1)
                   :lines [(str (name (:status plan3)) ": " (:reason plan3))]
                   :detail {:status (name (:status plan3)) :reason (:reason plan3)}}))

              (= :planned (:status plan2))
              (cond (:step-fn opts)
                    (apply-planned-turn! home job (:prompt plan2) plan2
                                         mon opts micros stamp run-at)

                    (:turn opts)
                    (let [r (apply-turn! home job (:prompt plan2)
                                         (:turn opts) (:deliver opts) micros stamp run-at)]
                      (update r :detail assoc :snapshot (:snapshot mon) :monitor-state (:state mon)))

                    :else
                    {:exit 3
                     :lines [(str "inference pending for " (get-in plan2 [:job :id])) (canon plan2)]
                     :detail {:status "pending" :plan (canon plan2)
                              :snapshot (:snapshot mon) :monitor-state (:state mon)}})

              :else
              {:exit (if (= :held (:status plan2)) 2 1)
               :lines [(str (name (:status plan2)) ": " (:reason plan2))]
               :detail {:status (name (:status plan2)) :reason (:reason plan2)}})))))))

(defn- execute-oneshot
  "Run one ad-hoc turn's host side: gate, then apply the finished turn.
  Verbatim from main.cljk oneshot + quiet/turn-failed?: the final text
  prints when the turn completed with a non-blank answer, otherwise
  exit 1 with the exit reason (a hard failure or a cancellation never
  prints). The live inference call stays the host's job (the CLI has no
  executor, so a gated turn without one stays pending, exit 3 — the
  same seam run-exec uses for agent turns)."
  [prof prompt capabilities opts]
  (let [gate (turn/turn-gate prof prompt {:capabilities capabilities})]
    (cond
      (= :refused (:status gate))
      {:exit 1 :lines [(str "refused: " (:reason gate))] :detail {:status "refused" :reason (:reason gate)}}

      (= :held (:status gate))
      {:exit 2 :lines [(str "held: " (:reason gate))] :detail {:status "held" :reason (:reason gate)}}

      :else
      (if-let [turn (:turn opts)]
        (let [final (str (:final turn))
              failed? (or (some? (:error turn)) (= "interrupted" (:exit-reason turn)))]
          (if (and (not failed?) (= "completed" (:exit-reason turn)) (not (str/blank? final)))
            {:exit 0 :lines [final]
             :detail {:status "ok" :final final :exit-reason "completed"
                      :provider (:provider turn) :model (:model turn) :turns (:turns turn)}}
            {:exit 1 :lines [(str "itonami-agent -z: " (:exit-reason turn)
                                 (when-let [e (get-in turn [:error :error])] (str ": " e)))]
             :detail {:status "error" :exit-reason (:exit-reason turn)
                      :error (get-in turn [:error :error]) :final final}}))
        {:exit 3
         :lines [(str "inference pending for " (:profile gate)) (canon gate)]
         :detail {:status "pending" :plan (canon gate)}}))))

(defn- ops-oneshot
  "The shared-case op for oneshot: the fixture profile gates the prompt,
  then the case's injected :turn applies (the product command has no
  executor yet, so a case without one stays pending)."
  [c dir read-text]
  (let [prof (load-dir dir read-text)
        r (execute-oneshot prof (:prompt c "") (vec (:capabilities c [])) {:turn (:turn c)})]
    (merge {:exit (:exit r) :lines (:lines r) :first-line (first (:lines r))
            :messages (:lines r)}
           (:detail r))))

(defn- host-now []
  (let [np (hio/now-parts)]
    {:iso (:iso np) :parts (:parts np) :ms (hio/now-ms)}))

(defn- ops-run [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [req (:request c {})
          prof (load-dir dir (hio/read-text-fn dir))
          r (execute-run prof (:job req) (vec (:capabilities req []))
                         (merge {:iso "2026-11-08T00:00:00+09:00"
                                 :ms 0
                                 :parts {:year 2026 :month 11 :day 8 :hour 0 :minute 0}}
                                (:now req))
                         {:turn (:turn req) :deliver (:deliver req)
                          :step-fn (when-let [s (:step req)] (run-step-stub s))})
          doc (or (:output-doc (:detail r)) "")
          jobs-doc (try (when (hio/file? (jobs-file dir))
                          (hio/parse-json (hio/slurp-utf8 (jobs-file dir))))
                        (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))
          snap-path (str dir "/cron/output/" (:job req) "/monitor_last_output.txt")]
      (merge {:exit (:exit r) :lines (:lines r) :first-line (first (:lines r))
              :messages (:lines r)}
             (:detail r)
             {:jobs-doc jobs-doc
              :snapshot-file (when (hio/file? snap-path) (hio/slurp-utf8 snap-path))
              :doc-has (into {} (map (fn [n] [n (boolean (str/includes? doc (str n)))])
                                     (:needles (:expect c []))))}))))

(defn- doctor-for
  "Doctor findings for one profile: reads, checks, renders. `store` is
  the store root (home = store/profiles/<name>); `env` is the host env
  map for token checks. Shared by the :doctor op and the product command."
  [store name env model-override]
  (let [home (str store "/profiles/" name)
        prof (assoc (profile/load-profile {:name name :read-text (hio/read-text-fn home)
                                            :parse-edn hio/parse-edn :parse-json hio/parse-json})
                    :home home)
        jobs-path (str home "/cron/jobs.json")
        raw (when (hio/file? jobs-path) (hio/slurp-utf8 jobs-path))
        parsed (when (some? raw)
                 (try (hio/parse-json raw)
                      (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                        {:error (ex-message e)})))]
    (if (:error parsed)
      (let [msg (str (:error parsed))]
        {:exit 1
         :lines [(str "profile-load-failed: " (subs msg 0 (min 200 (count msg))))
                 "1 finding(s)"]})
      (let [marker (str store "/paused")
            paused (when (hio/file? marker) (pause/since-of (hio/slurp-utf8 marker)))
            findings (doctor/profile-findings
                      {:config (:config prof) :home home :jobs (:jobs prof)}
                      {:env env :model-override model-override
                       :paused-record paused
                       :state-db? (hio/file? (str home "/state.db"))
                       :hy-deps (hy-deps prof env)
                       :probes {:file? hio/file? :symlink? hio/symlink?}})]
        (doctor/render findings)))))

(defn- ops-doctor-kinds [c]
  (let [[verb arg arg2 arg3 arg4 arg5 arg6 arg7] (:call c)]
    {:value (case verb
              "toolsets" (doctor/toolset-findings arg arg2 arg3 arg4)
              "tools" (doctor/tool-findings arg arg2 arg3 arg4 arg5 arg6 arg7)
              "browser" (doctor/browser-findings arg arg2 arg3)
              "oauth" (doctor/oauth-findings arg arg2 arg3)
              (throw (ex-info (str "doctor-kinds: unknown call " verb) {:verb verb})))}))

(defn- ops-doctor [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [req (:request c {})
          r (doctor-for dir (or (:profile req) "default")
                        (or (:env req) (hio/all-env))
                        (:model req))]
      (assoc r :messages (:lines r)))))

(defn- sessions-for
  "One `sessions` invocation against a store. `sub`/`id`/`limit-raw`
  mirror the legacy CLI args. Shared by the :sessions op and the product
  command."
  [store name sub id limit-raw]
  (let [home (str store "/profiles/" name)
        db-path (str home "/state.db")
        limit (sessions/bounded-limit limit-raw 200)]
    (if (and (some? limit-raw) (nil? limit))
      {:exit 2 :lines ["sessions: --limit must be a positive integer"]}
      (let [limit (or limit 20)]
        (case (str sub)
          ("" "list")
          (let [res (sessions/browse db-path limit)]
            (if (:error res)
              {:exit 1 :lines [(str "sessions: " (:error res))]}
              {:exit 0 :lines (sessions/browse-lines (:rows res))}))
          "show"
          (if (nil? id)
            {:exit 2 :lines ["sessions show: a session id is required"]}
            (let [res (sessions/latest-messages db-path id (min limit 50))]
              (if (:error res)
                {:exit 1 :lines [(str "sessions show: " (:error res))]}
                (if (seq (:rows res))
                  {:exit 0 :lines (sessions/show-lines (:rows res))}
                  {:exit 1 :lines [(str "session not found: " id)]}))))
          "resume"
          {:exit 2 :lines ["sessions resume: not implemented yet (lands with history re-entry)"]}
          {:exit 2 :lines ["usage: itonami-agent sessions [list] [--limit N] | show <id> | resume <id>"]})))))

(defn- ops-sessions [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [req (:request c {})
          home (str dir "/profiles/" (or (:profile req) "default"))]
      (when (seq (:setup-sql req))
        (hio/sqlite-exec! (str home "/state.db")
                          (str/join ";\n" (concat ["DROP TABLE IF EXISTS messages"
                                                   "DROP TABLE IF EXISTS sessions"]
                                                  (:setup-sql req)))))
      (let [r (sessions-for dir (or (:profile req) "default")
                            (:sub req) (:id req) (:limit req))]
        (assoc r :messages (:lines r))))))

(def notepad-usage
  "usage: itonami-agent cron notepad <job-id> set <key> <value> | get <key> | delete <key> | list")

(defn- notepad-for
  "One notepad invocation against a profile home. `verb`/`key`/`value`
  mirror the legacy `cron notepad` args. Shared by the :notepad op and
  the product command."
  [home job verb key value now-iso]
  (try
    (case (str verb)
      "set" (if (nil? value)
              {:exit 2 :lines ["usage: itonami-agent cron notepad <job-id> set <key> <value>"]}
              (let [saved (notepad/set-note home job key value now-iso)]
                {:exit 0 :lines [(str (get saved "key") " = " (get saved "value"))]}))
      "get" (if-let [v (notepad/get-note home job key)]
              {:exit 0 :lines [v]}
              {:exit 0 :lines [(str key " is not set")]})
      "delete" {:exit 0 :lines [(if (notepad/delete-note home job key)
                                  "deleted"
                                  (str "no such key: " key))]}
      "list" {:exit 0 :lines (mapv (fn [n] (str (get n "key") " = " (get n "value")))
                                   (notepad/list-notes home job))}
      {:exit 2 :lines [notepad-usage]})
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
      {:exit 1 :lines [(ex-message e)]})))

(defn- ops-notepad [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [req (:request c {})
          home (str dir "/profiles/" (or (:profile req) "default"))
          job (str (:job req ""))]
      (doseq [{:keys [key value]} (:setup req [])]
        (notepad/set-note home job key value "2026-11-08T00:00:00+09:00"))
      (let [r (notepad-for home job (:sub req) (:key req) (:value req)
                           "2026-11-08T00:00:00+09:00")]
        (assoc r :messages (:lines r))))))

(defn- load-home
  "A store profile as the legacy load-profile callers see it (lite
  loader, plus its home directory)."
  [store name]
  (assoc (profile/load-profile
          {:name name :read-text (hio/read-text-fn (str store "/profiles/" name))
           :parse-edn hio/parse-edn :parse-json hio/parse-json})
         :home (str store "/profiles/" name)))

(defn- profile-list-lines
  [store]
  (vec (concat [(str (text/pad-end "Profile" 34) (text/pad-end "Model" 34)
                     (text/pad-end "itonami" 9) "Scheduler")]
               (mapv (fn [n]
                       (let [prof (load-home store n)
                             cfg (:config prof)
                             m (:manifest prof)]
                         (str (text/pad-end n 34)
                              (text/pad-end (str (get-in cfg ["model" "default"])) 34)
                              (text/pad-end (if m "yes" "-") 9)
                              (if m (name (get-in m [:runtime :scheduler] :hermes)) "hermes"))))
                     ;; the legacy default row reads the store root; every
                     ;; otehon profile (default included) lives under
                     ;; profiles/, so the row reads profiles/default
                     (vec (distinct (cons "default" (listing-names store))))))))

(defn- profile-show-lines
  [store name]
  (let [home (str store "/profiles/" name)]
    (if-not (hio/dir? home)
      {:exit 1 :lines [(str "profile not found: " name)]}
      (let [prof (load-home store name)
            cfg (:config prof)]
        {:exit 0
         :lines [(str "profile: " name)
                 (str "home: " home)
                 (str "description: " (get-in prof [:profile-yaml "description"]))
                 (str "model: " (get-in cfg ["model" "provider"]) "/"
                      (get-in cfg ["model" "default"]))
                 (str "jobs: " (count (:jobs prof)))
                 (str "itonami: " (if (:manifest prof)
                                    (let [m (:manifest prof)]
                                      (str "{"
                                           (str/join ", "
                                                     (keep (fn [k]
                                                             (when (contains? m k)
                                                               (str k " " (pr-str (get m k)))))
                                                           [:runtime :placement :bundle]))
                                           "}"))
                                    "no"))]}))))

(defn- check-lines
  "The `profile check` lines for target profiles: one line per problem,
  then the profile count with its error/warning counts. Otehon drift is
  empty (soul-block tracking is a later slice), so the drift suffix the
  legacy command appends never appears."
  [store targets summary?]
  (let [rs (mapv (fn [n]
                   {:profile n :problems (profile/check (load-home store n))})
                 targets)
        level-count (fn [lvl]
                      (count (filter (fn [r] (some #(= lvl (:level %)) (:problems r))) rs)))]
    {:exit (if (pos? (level-count :error)) 1 0)
     :lines (vec (concat (when-not summary?
                           (mapcat (fn [{:keys [profile problems]}]
                                     (mapv (fn [{:keys [level path message]}]
                                             (str (text/pad-end (name level) 7) profile "  "
                                                  (pr-str path) " " message))
                                           problems))
                                   rs))
                         [(str (count rs) " profile(s): " (level-count :error) " with errors, "
                               (level-count :warn) " with warnings")]))}))

(defn- issue-summary
  "One readiness line's issue counts by code, details in brackets.
  Verbatim from main.cljk."
  [issues]
  (->> issues
       (group-by :code)
       (map (fn [[code rows]]
              (let [details (->> rows (keep :detail) (mapcat #(str/split % #",\s*")) distinct sort)
                    summary (str (name code) "=" (count rows))]
                (if (seq details) (str summary "[" (str/join "," details) "]") summary))))
       sort
       (str/join ", ")))

(defn- job-issues-for
  "Job-level readiness issues for a loaded profile: what `readiness`,
  `adopt` and `hy-migrate` refuse on. The S6-owned kotoba-job-issues
  kinds (toolsets/tools, browser backends, oauth cache) are deferred."
  [prof home env]
  (doctor/readiness-issues (:jobs prof) home
                           {:file? hio/file? :symlink? hio/symlink?}
                           (hy-deps prof env)))

(defn- profile-issues
  "Job-level readiness issues for one store profile: {:error msg} when
  its jobs.json is malformed (the legacy loader throws there; the lite
  loader records the problem, so the raw text is parsed again here),
  else {:findings [...]}."
  [store name env]
  (let [home (str store "/profiles/" name)
        raw (when (hio/file? (str home "/cron/jobs.json"))
              (hio/slurp-utf8 (str home "/cron/jobs.json")))
        parsed (when (some? raw)
                 (try (hio/parse-json raw)
                      (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                        {:error (ex-message e)})))]
    (if (:error parsed)
      {:error (str (:error parsed))}
      {:findings (job-issues-for (load-home store name) home env)})))

(defn- readiness-one
  "Readiness for one profile: the job-level findings summarized the way
  the legacy command prints them. Model, state.db, pause and token
  findings are doctor-only: the legacy readiness reads active jobs and
  nothing else (corrected in S4d from the S4b full-findings port)."
  [store name env]
  (let [{:keys [error findings]} (profile-issues store name env)]
    (if error
      {:blocked 1 :issues 1
       :lines [(str "error   " name "  " error)]}
      (if (seq findings)
        {:blocked 1 :issues (count findings)
         :lines [(str "blocked " name "  " (issue-summary findings))]}
        {:blocked 0 :issues 0 :lines [(str "ready   " name)]}))))

(defn- readiness-lines
  [store targets env]
  (let [rs (mapv #(readiness-one store % env) targets)
        blocked (reduce + 0 (map :blocked rs))
        issues (reduce + 0 (map :issues rs))]
    {:exit 0
     :lines (vec (concat (mapcat :lines rs)
                         [(str blocked " profile(s) blocked; " issues " compatibility issue(s)")]))}))

(defn- refresh-lines
  "The `profile refresh` lines: recompute each itonami profile's bundle
  CID and write it back. Verbatim from main.cljk; a missing home reads
  as no itonami.edn because refresh never creates a profile."
  [store targets dry-run?]
  (if (empty? targets)
    {:exit 2 :lines ["usage: itonami-agent profile refresh <p>|--all [--dry-run]"]}
    (let [n (atom 0)
          lines (mapv (fn [t]
                        (let [home (str store "/profiles/" t)
                              m (bundle/read-manifest home)
                              m' (when (some? m) (bundle/with-bundle home m))]
                          (cond
                            (nil? m) (str "skip    " t "  no itonami.edn")
                            (= m m') (str "keep    " t)
                            :else (do (when-not dry-run? (bundle/write-manifest! home m'))
                                      (swap! n inc)
                                      (str (if dry-run? "would  " "wrote   ") t "  "
                                           (get-in m [:bundle :cid]) " -> " (get-in m' [:bundle :cid]))))))
                      targets)]
      {:exit 0 :lines (conj lines (str @n " bundle CID(s) " (if dry-run? "would be " "") "refreshed"))})))

(defn- itonamify-lines
  "The `profile itonamify` lines. Verbatim from main.cljk; a missing
  home is skipped (the legacy loader throws there; the lite loader
  builds an empty profile, so the guard lives here)."
  [store targets force? dry-run?]
  (let [n (atom 0)
        lines (mapv (fn [t]
                      (let [home (str store "/profiles/" t)]
                        (if-not (hio/dir? home)
                          (str "skip    " t "  no such profile")
                          (let [prof (load-home store t)
                                m (:manifest prof)]
                            (if (and (some? m) (not force?))
                              (str "keep    " t "  " (get-in m [:bundle :cid]))
                              (let [m' (merge (bundle/default-manifest prof)
                                              (select-keys m (into [:runtime :placement :inference
                                                                    :terminal :web]
                                                                   manifest/org-keys)))]
                                (when-not dry-run? (bundle/write-manifest! home m'))
                                (swap! n inc)
                                (str (if dry-run? "would  " "wrote   ") t "  "
                                     (get-in m' [:bundle :cid]))))))))
                    targets)]
    {:exit 0 :lines (conj lines (str @n " profile(s) " (if dry-run? "would be " "") "itonamified"))}))

(def valid-rails #{:murakumo :kotoba :itonami-p2p :openrouter :muse :codex :Claude})

(defn- rail-lines
  "The `profile rail` lines: point itonami profiles at one inference
  rail. Verbatim from main.cljk."
  [store targets rail dry-run?]
  (if (or (not (contains? valid-rails rail)) (empty? targets))
    {:exit 2 :lines ["usage: itonami-agent profile rail <p>|--all --to murakumo|kotoba|itonami-p2p|openrouter|muse|codex|Claude [--dry-run]"]}
    (let [n (atom 0)
          lines (mapv (fn [t]
                        (let [home (str store "/profiles/" t)
                              m (bundle/read-manifest home)
                              m' (when (some? m) (bundle/with-inference-rail m rail))]
                          (cond
                            (nil? m) (str "skip    " t "  no itonami.edn")
                            (= m m') (str "keep    " t)
                            :else (do (when-not dry-run? (bundle/write-manifest! home m'))
                                      (swap! n inc)
                                      (str (if dry-run? "would  " "wrote   ") t "  "
                                           (some-> (get-in m [:placement :inference-rail]) name)
                                           " -> " (name rail))))))
                      targets)]
      {:exit 0 :lines (conj lines (str @n " profile(s) " (if dry-run? "would be " "") "pointed at " (name rail)))})))

(defn- js-parse-int
  "JS parseInt with radix 10: optional sign and leading digits, the
  rest ignored; nil when the text starts with no digits."
  [s]
  (let [t (str/replace (str s) #"^\s+" "")
        m (re-find #"^[+-]?\d+" t)]
    (when m
      (let [neg? (str/starts-with? m "-")
            ds (str/replace m #"^[+-]" "")
            n (reduce (fn [a ch] (+ (* a 10) (get bundle/hex-digit (str ch) 0))) 0 ds)]
        (if neg? (- n) n)))))

(defn- runs-for
  "One `cron runs` invocation against a store: execution rows newest
  first, the take-last limit verbatim (the legacy command keeps the
  oldest rows of that order), joined with the run receipts in
  cron/itonami-runs.jsonl. A missing ledger reads as no runs — the
  legacy open-db creates the file there; otehon leaves reads
  side-effect-free."
  [store name limit-raw]
  (let [home (str store "/profiles/" name)
        db (str home "/cron/executions.db")
        rows (if (hio/file? db)
               (try (hio/sqlite-rows db "SELECT * FROM executions ORDER BY claimed_at DESC,id DESC" [])
                    (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                      {:error (ex-message e)}))
               [])]
    (if (:error rows)
      {:exit 1 :lines [(str "runs: " (:error rows))]}
      (let [f (str home "/cron/itonami-runs.jsonl")
            details (if (hio/file? f)
                      (mapv hio/parse-json (remove str/blank? (str/split-lines (hio/slurp-utf8 f))))
                      [])
            by-id (into {} (keep (fn [r] (when-let [id (get r "execution_id")] [id r])) details))
            n (or (js-parse-int (if (nil? limit-raw) "20" (str limit-raw))) 0)]
        {:exit 0
         :lines (mapv (fn [r]
                        (let [detail (by-id (get r "id"))]
                          (str (text/pad-end (str (get r "status")) 9)
                               "  job=" (get r "job_id") "  " (get r "claimed_at")
                               "  id=" (get r "id") "  source=" (get r "source")
                               (when (get r "delivery_outcome")
                                 (str "  delivery=" (get r "delivery_outcome")))
                               (when detail
                                 (str "  " (get detail "provider") "/" (get detail "model")))
                               (when (and detail (get detail "peer"))
                                 (str "  peer=" (get detail "peer"))))))
                      (take-last n rows))}))))

(defn- incidents-for
  "One `cron incidents` invocation: list every incident newest first,
  or close one signature. The ack UPDATE is fenced on the current
  state, so closing an unknown or already-closed signature answers the
  same way without a changes count."
  [store name sub id]
  (let [home (str store "/profiles/" name)
        db (str home "/cron/executions.db")]
    (if (= (str sub) "ack")
      (let [rows (if (hio/file? db)
                   (try (hio/sqlite-rows db "SELECT state FROM cron_incidents WHERE id=?" [(str id)])
                        (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                          {:error (ex-message e)}))
                   [])]
        (cond
          (:error rows) {:exit 1 :lines [(str "incidents: " (:error rows))]}
          (and (seq rows) (not= "closed" (get (first rows) "state")))
          (do (hio/sqlite-run! db "UPDATE cron_incidents SET state='closed',acked_at=?,closed_at=? WHERE id=? AND state!='closed'"
                               ["2026-11-08T00:00:00+09:00" "2026-11-08T00:00:00+09:00" (str id)])
              {:exit 0 :lines [(str "closed incident " id)]})
          :else {:exit 2 :lines [(str "no such incident: " id)]}))
      (let [rows (if (hio/file? db)
                   (try (hio/sqlite-rows db "SELECT * FROM cron_incidents ORDER BY last_seen_at DESC,id DESC" [])
                        (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                          {:error (ex-message e)}))
                   [])]
        (if (:error rows)
          {:exit 1 :lines [(str "incidents: " (:error rows))]}
          {:exit 0
           :lines (mapv (fn [r]
                          (str (text/pad-end (str (get r "state")) 9)
                               " job=" (get r "job_id")
                               " type=" (get r "failure_type")
                               " id=" (get r "id")
                               " last=" (get r "last_seen_at")))
                        rows)})))))

(defn- set-parked!
  "Park (or unpark) a profile home for Hermes' gateway: the marker file
  `gateway.parked` is what `hermes -p X gateway stop` writes. The stamp
  text is never read back, only the file's presence. Verbatim from
  main.cljk."
  [home parked? now-iso]
  (let [f (str home "/gateway.parked")]
    (if parked?
      (hio/write-text! f (str "parked by itonami-agent profile adopt at " now-iso "\n"))
      (hio/delete-file! f))))

(defn- refresh-bundle-lines
  "The `profile refresh-bundle` line: recompute one manifest's bundle
  CID and write it back. A profile without a manifest refuses with the
  itonamify hint (the legacy loader's throw on a missing home reads the
  same way: lite loading never throws, so the guard lives here)."
  [store name]
  (let [home (str store "/profiles/" name)
        prof (load-home store name)
        m (:manifest prof)]
    (if (nil? m)
      {:exit 2 :lines [(str "profile " name " is not itonamified; run profile itonamify first")]}
      (let [m' (bundle/refresh-bundle-cid home)]
        {:exit 0 :lines [(str "refreshed " name " bundle " (get-in m' [:bundle :cid]))]}))))

(defn- release-lines
  "The `profile release` lines: hand scheduler ownership back to Hermes
  (manifest scheduler flip when a manifest exists, marker lifted
  always). Verbatim from main.cljk; a missing home is skipped (the
  legacy loader throws there), and a missing name is a usage refusal
  (the legacy blank-name keep line is an accident of load-profile(nil)
  reading the store root, which has no otehon meaning)."
  [store targets dry-run? now-iso]
  (if (some nil? targets)
    {:exit 2 :lines ["usage: itonami-agent profile release <p>|--all [--dry-run]"]}
    (let [changed (atom 0)
          lines (mapv (fn [n]
                        (let [home (str store "/profiles/" n)]
                          (if-not (hio/dir? home)
                            (str "skip    " n "  no such profile")
                            (let [prof (load-home store n)
                                  owned? (or (= :itonami (get-in prof [:manifest :runtime :scheduler]))
                                             (hio/file? (str home "/gateway.parked")))]
                              (cond
                                (not owned?) (str "keep    " n "  already Hermes-scheduled")
                                dry-run? (do (swap! changed inc) (str "would   release " n))
                                :else (do
                                        (when (:manifest prof)
                                          (bundle/write-manifest! home (assoc-in (:manifest prof) [:runtime :scheduler] :hermes)))
                                        (set-parked! home false now-iso)
                                        (swap! changed inc)
                                        (str "released " n ": Hermes ticks cron again")))))))
                      targets)]
      {:exit 0 :lines (conj lines (str @changed " profile(s) " (if dry-run? "would be " "") "released"))})))

(defn- hy-script-target
  "The .hy sibling a .py script ref rewrites to, when the .py file exists
  and the .hy file exists below the same scripts/ tree. Verbatim from
  main.cljk (POSIX separators only — Otehon has no Windows runner)."
  [home rel]
  (when (and (string? rel) (str/ends-with? rel ".py"))
    (let [scripts (str home "/scripts")
          target (str (subs rel 0 (- (count rel) 3)) ".hy")
          source (str scripts "/" rel)
          abs (str scripts "/" target)
          source-contained? (try
                              (let [root (hio/realpath scripts)
                                    resolved (hio/realpath source)]
                                (str/starts-with? resolved (str root "/")))
                              (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ false))]
      (when (and (exec/script-path-safe? scripts target hio/symlink?)
                 source-contained?
                 (hio/file? source)
                 (hio/file? abs))
        target))))

(defn- rewrite-job-hy-refs
  "Rewrite a jobs vector's .py refs to their .hy siblings. Verbatim from
  main.cljk (pure: counts how many refs moved per field)."
  [home jobs]
  (let [counts (atom {"script" 0 "monitor_script" 0})
        updated
        (mapv (fn [job]
                (if-not (map? job) job
                  (reduce (fn [j field]
                            (if-let [target (hy-script-target home (get j field))]
                              (do (swap! counts update field inc)
                                  (assoc j field target))
                              j))
                          job ["script" "monitor_script"])))
              jobs)]
    {:jobs updated :counts @counts}))

(defn- jobs-doc
  "The parsed jobs.json document, or {} when it is missing or malformed."
  [home]
  (try (let [v (when (hio/file? (jobs-file home))
                 (hio/parse-json (hio/slurp-utf8 (jobs-file home))))]
         (if (map? v) v {}))
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ {})))

(defn- transform-jobs!
  "Apply one locked transformation to the current jobs vector, preserving
  top-level fields and stamping updated_at. Verbatim from cron.cljk
  (JUN-1036 S2a established update-jobs-doc! for the write itself)."
  [home micros f]
  (let [lock (str home "/cron/.itonami-jobs.lock")]
    (if-not (hio/acquire-lock! lock)
      (throw (ex-info "cron jobs are being updated by another process" {:lock lock}))
      (try (let [before (vec (cron/jobs-of (jobs-doc home)))
                 after (vec (f before))]
             (when-not (= before after)
               (update-jobs-doc! home micros (fn [doc _] (assoc doc "jobs" after))))
             after)
           (finally (hio/release-lock! lock))))))

(defn- adopt-lines
  "The `profile adopt` lines: hand scheduler ownership to Kotoba (manifest
  flip, Hermes parked, bundle CID refreshed). Entries that are not
  Kotoba-ready refuse; --all refuses the whole batch when any entry
  blocks. Verbatim from main.cljk; a missing home is skipped (the legacy
  loader throws there), and a missing name is a usage refusal (the
  legacy blank-name outcomes are accidents of load-profile(nil))."
  [store targets all? env dry-run? now-iso]
  (if (some nil? targets)
    {:exit 2 :lines ["usage: itonami-agent profile adopt <p>|--all [--dry-run]"]}
    (let [entries (mapv (fn [n]
                          (let [home (str store "/profiles/" n)]
                            (if-not (hio/dir? home)
                              {:name n :error "no such profile"}
                              (try
                                (let [prof (load-home store n)
                                      m (or (:manifest prof) (bundle/default-manifest prof))
                                      scheduler (or (get-in m [:runtime :scheduler]) :hermes)]
                                  {:name n :profile prof :manifest m
                                   :error (when-not (contains? #{:hermes :itonami} scheduler)
                                            (str "scheduler " (name scheduler)
                                                 " must be retired before Kotoba adoption"))
                                   :already? (and (= :itonami (get-in m [:runtime :scheduler]))
                                                  (hio/file? (str home "/gateway.parked")))
                                   :issues (:findings (profile-issues store n env))})
                                (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                                  {:name n :error (ex-message e)})))))
                        targets)
          blockers (filter #(or (:error %) (seq (:issues %))) entries)
          changed (atom 0)]
      (if (and all? (seq blockers))
        {:exit 0
         :lines (vec (concat (mapv (fn [{:keys [name error issues]}]
                                     (str (if error "error   " "blocked ") name "  "
                                          (or error (issue-summary issues))))
                                   blockers)
                             [(str "refused all-profile adoption; " (count blockers)
                                   " of " (count entries) " profiles are not Kotoba-ready; no profiles changed")]))}
        {:exit 0
         :lines (vec (concat
                      (mapv (fn [{:keys [name profile manifest already? issues error]}]
                              (cond
                                error (str "error   " name "  " error)
                                already? (str "keep    " name "  already Kotoba-scheduled")
                                (seq issues) (str "blocked " name "  " (issue-summary issues))
                                dry-run? (do (swap! changed inc) (str "would   adopt " name))
                                :else (let [home (str store "/profiles/" name)]
                                        (bundle/write-manifest! home (assoc-in manifest [:runtime :scheduler] :itonami))
                                        (set-parked! home true now-iso)
                                        (bundle/refresh-bundle-cid home)
                                        (swap! changed inc)
                                        (str "adopted " name ": Kotoba ticks cron; Hermes is parked"))))
                            entries)
                      [(str @changed " profile(s) " (if dry-run? "would be " "") "adopted")]))}))))

(defn- read-edn-opt
  "A parsed EDN file, or nil when it is missing or malformed."
  [path]
  (try (when (hio/file? path) (hio/parse-edn (hio/slurp-utf8 path)))
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))

(defn- soul-lines
  "The `profile soul` lines: render the world/unit/role blocks from the
  registry and worlds files and splice them into SOUL.md, with a backup
  and an EDN receipt. Verbatim from main.cljk (unit filter, limit and
  body refusals, keep, dry-run shapes, exit 1 on refusal)."
  [store targets reg-path worlds-path unit dry-run? now-iso]
  (let [reg (when reg-path (read-edn-opt reg-path))
        worlds (when worlds-path (read-edn-opt worlds-path))
        by-id (into {} (map (juxt :agent/id identity)) (:agents reg))
        live (vec (filter some? targets))]
    (if-not (and (seq by-id) (map? (:worlds worlds)) (seq live))
      {:exit 2 :lines ["usage: itonami-agent profile soul <p>|--all --registry <agent-registry.edn> --worlds <worlds.edn> [--unit U] [--dry-run]"]}
      (let [stamp (str/replace (subs now-iso 0 19) #"[^0-9T]" "")
            backup-dir (str store "/state/soul-blocks/" stamp)
            written (atom [])
            refused (atom 0)
            lines (vec (mapcat
                        (fn [t]
                          (let [e (get by-id t)]
                            (when (or (nil? unit) (= (str unit) (some-> (:org/unit e) name)))
                              (let [home (str store "/profiles/" t)
                                    path (str home "/SOUL.md")
                                    text (when (hio/file? path) (hio/slurp-utf8 path))
                                    m (read-edn-opt (str home "/itonami.edn"))
                                    y (read-edn-opt (str home "/yakuwari.edn"))]
                                (cond
                                  (nil? e) [(str "skip    " t "  not in the registry")]
                                  (nil? text) [(str "skip    " t "  no SOUL.md")]
                                  :else
                                  (let [blocks (soul/render e worlds (vec (:yakuwari/capabilities y)) (:authority m))
                                        size (soul/generated-size blocks)
                                        new (soul/splice text blocks)]
                                    (cond
                                      (> size soul/limit)
                                      (do (swap! refused inc)
                                          [(str "refuse  " t "  generated blocks are " size
                                                " chars (limit " soul/limit ")")])
                                      (not= (soul/strip new) (soul/strip text))
                                      (do (swap! refused inc)
                                          [(str "refuse  " t "  the body would change")])
                                      (= new text) [(str "keep    " t)]
                                      :else
                                      (do (when-not dry-run?
                                            (hio/mkdirs! (str backup-dir "/" t))
                                            (hio/write-text! (str backup-dir "/" t "/SOUL.md") text)
                                            (hio/replace-file! path new))
                                          (swap! written conj {:profile t
                                                               :before (hio/sha256-utf8 text)
                                                               :after (hio/sha256-utf8 new)
                                                               :generated-chars size})
                                          [(str (if dry-run? "would  " "wrote   ") t "  " size " chars")]))))))))
                        live))]
        (when (and (seq @written) (not dry-run?))
          (hio/write-text! (str backup-dir "/receipt.edn")
                           (pr-str {:at now-iso :registry reg-path :worlds worlds-path :written @written})))
        {:exit (if (pos? @refused) 1 0)
         :soul-written @written
         :lines (conj lines (str (count @written) " SOUL(s) " (if dry-run? "would be " "")
                                 "rewritten, " @refused " refused"
                                 (when (and (seq @written) (not dry-run?))
                                   (str "; backups and receipt in " backup-dir))))}))))

(defn- organize-line
  "One `profile organize` line for a target home. The manifest rewrite
  and counter bump live here so the shape stays small enough to verify."
  [home t m e dry-run? changed]
  (let [m' (when (and m e)
             (manifest/with-org m e {:yakuwari? (hio/file? (str home "/yakuwari.edn"))}))
        bad (some-> m' manifest/errors first)]
    (cond
      (nil? m) (str "skip    " t "  no itonami.edn")
      (nil? e) (str "skip    " t "  not in the registry")
      bad (str "refuse  " t "  " (pr-str (:path bad)) " " (:message bad))
      (= m m') (str "keep    " t)
      :else (do (when-not dry-run? (bundle/write-manifest! home m'))
                (swap! changed inc)
                (str (if dry-run? "would  " "wrote   ") t "  "
                     (str/join " > " (map name (:org/path m' [:host])))
                     " (" (some-> (:agent/kind m') name) ")")))))

(defn- organize-lines
  "The `profile organize` lines: project a registry entry onto each
  manifest (organisation keys replaced as a set, schema marked v2).
  Verbatim from main.cljk (skip/keep/refuse/would shapes, exit 0)."
  [store targets reg-path dry-run?]
  (let [reg (when reg-path (read-edn-opt reg-path))
        by-id (into {} (map (juxt :agent/id identity)) (:agents reg))
        live (vec (filter some? targets))]
    (if-not (and (seq by-id) (seq live))
      {:exit 2 :lines ["usage: itonami-agent profile organize <p>|--all --registry <agent-registry.edn> [--dry-run]"]}
      (let [changed (atom 0)
            lines (mapv (fn [t]
                          (let [home (str store "/profiles/" t)
                                m (read-edn-opt (str home "/itonami.edn"))
                                e (get by-id t)]
                            (organize-line home t m e dry-run? changed)))
                        live)]
        {:exit 0
         :lines (conj lines (str @changed " profile(s) " (if dry-run? "would be " "") "organized"))}))))

(defn- stage-profile-hy!
  "Stage one profile's Hy migration payload: hash-check every record and
  copy the new .hy sources into scripts/. Verbatim from main.cljk (the
  payload lives under <artifact>/<profile>/scripts/)."
  [store name artifact-root records dry-run?]
  (let [home (str store "/profiles/" name)
        scripts (str home "/scripts")
        payload-scripts (str artifact-root "/" name "/scripts")
        selected (filter #(= name (get % "profile")) records)
        plan
        (mapv (fn [rec]
                (let [source (get rec "source")
                      target (get rec "target")
                      source-sha (get rec "source_sha256")
                      target-sha (get rec "target_sha256")
                      target-rel (some-> target (str/replace-first #"^scripts/" ""))
                      source-path (str home "/" source)
                      payload-path (str artifact-root "/" name "/" target)
                      target-path (str home "/" target)
                      scripts-real (try (hio/realpath scripts) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))
                      source-real (try (hio/realpath source-path) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))
                      source-safe? (and scripts-real source-real
                                        (str/starts-with? source-real (str scripts-real "/")))]
                  (when-not (and (string? source) (string? target)
                                 (str/starts-with? source "scripts/")
                                 (str/starts-with? target "scripts/")
                                 (str/ends-with? source ".py")
                                 (= target (str (subs source 0 (- (count source) 3)) ".hy"))
                                 (re-matches #"^[0-9a-f]{64}$" (str source-sha))
                                 (re-matches #"^[0-9a-f]{64}$" (str target-sha))
                                 (exec/script-path-safe? scripts target-rel hio/symlink?)
                                 (exec/script-path-safe? payload-scripts target-rel hio/symlink?)
                                 (hio/file? source-path) source-safe?
                                 (hio/file? payload-path) (not (hio/symlink? payload-path)))
                    (throw (ex-info (str "invalid or missing Hy migration payload for " name ": " target) {})))
                  (let [source-hash (cas/sha256-hex (hio/bytes-of (hio/read-latin1 source-path)))
                        target-hash (cas/sha256-hex (hio/bytes-of (hio/read-latin1 payload-path)))
                        existing-hash (when (hio/file? target-path)
                                        (cas/sha256-hex (hio/bytes-of (hio/read-latin1 target-path))))]
                    (when-not (= source-sha source-hash)
                      (throw (ex-info (str "Python source drift for " name ": " source) {})))
                    (when-not (= target-sha target-hash)
                      (throw (ex-info (str "Hy payload hash mismatch for " name ": " target) {})))
                    (when (and existing-hash (not= existing-hash target-sha))
                      (throw (ex-info (str "refusing to replace different Hy source for " name ": " target) {})))
                    {:target target-path :content (hio/slurp-utf8 payload-path) :existing? (some? existing-hash)})))
              selected)
        missing (remove :existing? plan)
        _ (when (and (seq plan) (not (hio/dir? scripts)))
            (throw (ex-info (str "profile scripts directory is missing: " name) {})))]
    (when-not dry-run?
      (doseq [{:keys [target content]} missing]
        (hio/replace-file! target content))
      (when (and (seq missing) (:manifest (load-home store name)))
        (bundle/refresh-bundle-cid home)))
    {:files (count plan) :staged (count missing) :existing (- (count plan) (count missing))
     :written (if dry-run?
                []
                (mapv (fn [{:keys [target content]}]
                        {:file (subs target (inc (count home))) :text content})
                      missing))}))

(defn- hy-stage-lines
  "The `profile hy-stage` lines: stage every target's Hy payload, then
  the totals. Verbatim from main.cljk (per-target skip, exit 0)."
  [store targets artifact-dir dry-run?]
  (let [manifest-path (when artifact-dir (str artifact-dir "/migration.json"))
        manifest (when (and manifest-path (hio/file? manifest-path))
                   (hio/parse-json (hio/slurp-utf8 manifest-path)))]
    (if-not (= "kotoba-hermes-cron-hy-patch-v2" (get manifest "format"))
      {:exit 2 :lines [(str "invalid Hy migration manifest: " manifest-path)]}
      (let [records (get manifest "script_files" [])
            staged-total (atom 0)
            existing-total (atom 0)
            skipped (atom 0)
            written (atom {})
            lines (mapv (fn [n]
                          (try
                            (let [{:keys [files staged existing] w :written}
                                  (stage-profile-hy! store n artifact-dir records dry-run?)]
                              (swap! staged-total + staged)
                              (swap! existing-total + existing)
                              (swap! written into (map (juxt :file :text)) w)
                              (str (if dry-run? "would  " "staged ") n
                                   "  files=" files " new=" staged " present=" existing))
                            (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                              (swap! skipped inc)
                              (str "skip    " n "  " (ex-message e)))))
                        (filter some? targets))]
        {:exit 0
         :lines (conj lines (str @staged-total " Hy source file(s) " (if dry-run? "would be " "")
                                 "staged; " @existing-total " already present; " @skipped " profile(s) skipped"))
         :staged @written}))))

(defn- hy-migrate-lines
  "The `profile hy-migrate` lines: rewrite a Kotoba-owned profile's .py
  refs to their .hy siblings under the tick lock. Verbatim from
  main.cljk (skip/blocked/keep/would/converted shapes, tick-busy skip,
  error catch-all, exit 0)."
  [store targets env dry-run? micros]
  (let [converted (atom 0)
        skipped (atom 0)
        lines (mapv (fn [n]
                      (let [home (str store "/profiles/" n)]
                        (if-not (hio/dir? home)
                          (do (swap! skipped inc)
                              (str "error   " n "  no such profile"))
                          (try
                            (let [prof (load-home store n)
                                  scheduler (get-in prof [:manifest :runtime :scheduler])
                                  parked? (hio/file? (str home "/gateway.parked"))
                                  jobs (vec (cron/jobs-of (jobs-doc home)))
                                  rewritten (rewrite-job-hy-refs home jobs)
                                  counts (:counts rewritten)
                                  runtime-issues (mapcat #(doctor/script-runtime-issues
                                                          % home {:file? hio/file? :symlink? hio/symlink?}
                                                          (hy-deps prof env))
                                                        (filter map? (:jobs rewritten)))
                                  issues (concat (:findings (profile-issues store n env)) runtime-issues)
                                  nrefs (+ (get counts "script" 0) (get counts "monitor_script" 0))]
                              (cond
                                (or (not= :itonami scheduler) (not parked?))
                                (do (swap! skipped inc)
                                    (str "skip    " n "  scheduler is not Kotoba-owned"))
                                (seq issues)
                                (do (swap! skipped inc)
                                    (str "blocked " n "  " (issue-summary issues)))
                                (zero? nrefs)
                                (str "keep    " n "  no .py refs with sibling .hy files")
                                dry-run?
                                (do (swap! converted + nrefs)
                                    (str "would   convert " n "  script=" (get counts "script")
                                         " monitor_script=" (get counts "monitor_script")))
                                :else
                                (let [tick-lock (str home "/cron/.itonami-tick.lock")]
                                  (if-not (hio/acquire-lock! tick-lock)
                                    (do (swap! skipped inc)
                                        (str "skip    " n "  Kotoba tick is in progress"))
                                    (try
                                      (let [counts* (atom {"script" 0 "monitor_script" 0})]
                                        (transform-jobs! home micros
                                                         (fn [current]
                                                           (let [{:keys [jobs counts]} (rewrite-job-hy-refs home current)
                                                                 runtime-issues (mapcat #(doctor/script-runtime-issues
                                                                                           % home {:file? hio/file? :symlink? hio/symlink?}
                                                                                           (hy-deps prof env))
                                                                                         (filter map? jobs))]
                                                             (when (seq runtime-issues)
                                                               (throw (ex-info (str "Hy runtime unavailable: "
                                                                                     (issue-summary runtime-issues))
                                                                               {:issues runtime-issues})))
                                                             (reset! counts* counts)
                                                             jobs)))
                                        (let [counts @counts*
                                              nrefs (+ (get counts "script" 0) (get counts "monitor_script" 0))]
                                          (if (pos? nrefs)
                                            (do (bundle/refresh-bundle-cid home)
                                                (swap! converted + nrefs)
                                                (str "converted " n "  script=" (get counts "script")
                                                     " monitor_script=" (get counts "monitor_script")))
                                            (str "keep    " n "  references already converted"))))
                                      (finally (hio/release-lock! tick-lock)))))))
                            (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                              (swap! skipped inc)
                              (str "error   " n "  " (ex-message e)))))))
                    (filter some? targets))]
    {:exit 0
     :lines (conj lines (str @converted " script ref(s) " (if dry-run? "would be " "")
                             "converted; " @skipped " profile(s) skipped"))}))

(defn- did-lines
  "The `profile did` lines: per-profile did:key from the fleet seed, the
  epoch from the registry, an optional public-keys EDN file. Verbatim
  from main.cljk (seed REFUSED exit 2, usage without targets, sorted
  --all, exit 0 with the count line)."
  [store name all? env reg-path out-path]
  (let [seed (ed/parse-seed (get env ed/seed-env-name))]
    (if (nil? seed)
      {:exit 2 :lines [(str "REFUSED: " ed/seed-env-name " is not set (64 hex characters). Fill it from the kagi item shared/agent-identity-seed in a human session, for this one command; it is never printed.")]}
      (let [reg (when reg-path (read-edn-opt reg-path))
            by-id (into {} (map (juxt :agent/id identity)) (:agents reg))
            targets (if all?
                      (if (seq by-id) (sort (keys by-id)) (listing-names store))
                      [name])]
        (if-not (first targets)
          {:exit 2 :lines ["usage: itonami-agent profile did <p>|--all [--registry <agent-registry.edn>] [--out <file>]"]}
          (let [out (mapv (fn [t]
                            (let [epoch (or (:did/epoch (get by-id t)) 0)]
                              [t {:did (ed/did-of seed t epoch) :epoch epoch}]))
                          targets)
                doc (str ";; per-profile did:key (ADR-2610141512 D7). Public keys only.\n"
                         "{" (str/join ", " (map (fn [[t {:keys [did epoch]}]]
                                                    (str (pr-str t) " {:did " (pr-str did)
                                                         " :epoch " epoch "}"))
                                                  out))
                         "}\n")]
            (when out-path (hio/write-text! out-path doc))
            {:exit 0
             :did-out (when out-path doc)
             :lines (conj (mapv (fn [[t {:keys [did epoch]}]]
                                  (str t "  " did "  epoch " epoch))
                                out)
                          (str (count out) " DID(s)"
                               (when out-path (str " written to " out-path))))}))))))

(defn- bundle-lines
  "The `profile bundle` lines: print one profile's bundle CID and file
  manifest, read-only. Verbatim from main.cljk; a missing home errors
  (the legacy loader throws there — the lite loader never does, so the
  error line lives here, adopt-style, exit 0)."
  [store name]
  (let [home (str store "/profiles/" name)]
    (if-not (hio/dir? home)
      {:exit 0 :lines [(str "error   " name "  no such profile")]}
      (let [prof (load-home store name)
            files (bundle/bundle-files home (select-keys (get-in prof [:manifest :bundle]) [:skills :dirs]))]
        {:exit 0 :lines (into [(bundle/bundle-cid files)]
                              (map (fn [[p sha]] (str "  " (subs sha 0 12) "  " p))
                                   (bundle/bundle-manifest files)))}))))

(defn- transfer-usage [sub]
  (str "usage: itonami-agent profile " sub " <p>|--all [--"
       (if (= sub "export") "to" "from") " DIR] [--force] [--dry-run]"))

(defn- transfer-lines
  "The `profile import`/`export` lines: copy profile definitions between
  two store roots and, on export, park the Hermes side when the copied
  profile is Kotoba-scheduled. Verbatim from main.cljk; the roots come
  from the request (the legacy host-root defaults have no meaning for a
  scratch store, so missing roots refuse with the usage text)."
  [sub from-root to-root targets dry-run? force? now-iso]
  (if (or (nil? from-root) (nil? to-root))
    {:exit 2 :lines [(transfer-usage sub)]}
    (let [out? (= sub "export")
          copied (atom [])
          lines (mapv (fn [t]
                        (try
                          (let [from (str from-root "/profiles/" t)
                                to (str to-root "/profiles/" t)]
                            (if dry-run?
                              (str "would  " sub " " t "  " from " -> " to)
                              (let [r (bundle/copy-profile! from to force?)
                                    scheduled (get-in (bundle/read-manifest from) [:runtime :scheduler])]
                                (when (and out? (= :itonami scheduled))
                                  (set-parked! to true now-iso))
                                (swap! copied conj (:copied r))
                                (str "copied  " t "  " (count (:copied r)) " file(s)  " from " -> " to))))
                          (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                            (str "skip    " t "  " (ex-message e)))))
                      targets)]
      {:exit 0
       :lines (conj lines (str (count @copied) " profile(s) " (if dry-run? "would be " "") "copied"))
       :copied (vec (apply concat @copied))})))

(defn- ops-profile [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [req (:request c {})
          sub (str (:sub req "list"))
          targets (if (:all req) (listing-names dir) [(or (:name req) "default")])
          env (or (:env req) (hio/all-env))
          r (case sub
              "list" {:exit 0 :lines (profile-list-lines dir)}
              "show" (profile-show-lines dir (or (:name req) "default"))
              "check" (check-lines dir targets (boolean (:summary req)))
              "readiness" (readiness-lines dir targets env)
              "refresh" (refresh-lines dir targets (boolean (:dry-run req)))
              "itonamify" (itonamify-lines dir targets (boolean (:force req)) (boolean (:dry-run req)))
              "rail" (rail-lines dir targets
                                 (when (:to req) (keyword (str (:to req))))
                                 (boolean (:dry-run req)))
              "refresh-bundle" (refresh-bundle-lines dir (:name req))
              "release" (release-lines dir (if (:all req) (listing-names dir) [(:name req)])
                                        (boolean (:dry-run req)) "2026-11-08T00:00:00+09:00")
              ("import" "export")
              (let [t (cond (:all req) (when (:from req)
                                         (let [ts (listing-names (str dir "/" (:from req)))]
                                           (when (seq ts) ts)))
                            (:name req) [(:name req)])]
                (if (nil? t)
                  {:exit 2 :lines [(transfer-usage sub)]}
                  (transfer-lines sub
                                   (when (:from req) (str dir "/" (:from req)))
                                   (when (:to req) (str dir "/" (:to req)))
                                   t
                                   (boolean (:dry-run req)) (boolean (:force req))
                                   "2026-11-08T00:00:00+09:00")))
              "adopt" (adopt-lines dir (if (:all req) (listing-names dir) [(:name req)])
                                   (:all req) env (boolean (:dry-run req)) "2026-11-08T00:00:00+09:00")
              "soul" (soul-lines dir (if (:all req) (listing-names dir) [(:name req)])
                                  (when (:registry req) (str dir "/" (:registry req)))
                                  (when (:worlds req) (str dir "/" (:worlds req)))
                                  (:unit req)
                                  (boolean (:dry-run req)) "2026-11-08T00:00:00+09:00")
              "organize" (organize-lines dir (if (:all req) (listing-names dir) [(:name req)])
                                           (when (:registry req) (str dir "/" (:registry req)))
                                           (boolean (:dry-run req)))
              "hy-stage" (hy-stage-lines dir (if (:all req) (listing-names dir) [(:name req)])
                                          (when (:artifact req) (str dir "/" (:artifact req)))
                                          (boolean (:dry-run req)))
              "hy-migrate" (hy-migrate-lines dir (if (:all req) (listing-names dir) [(:name req)])
                                             env (boolean (:dry-run req)) "2026-11-08T00:00:00.000000+09:00")
              "did" (did-lines dir (:name req) (boolean (:all req)) env
                                (when (:registry req) (str dir "/" (:registry req)))
                                (when (:out req) (str dir "/" (:out req))))
              "bundle" (bundle-lines dir (or (:name req) "default"))
              {:exit 2 :lines [(str "unknown profile command: " (:sub req))]})
          in-place? (and (not (:all req)) (:name req)
                         (contains? #{"refresh" "itonamify" "rail" "refresh-bundle" "release"
                                       "adopt" "organize" "hy-migrate" "hy-stage"} sub))
          copied-here? (and (contains? #{"import" "export"} sub)
                            (not (:all req)) (:to req) (:name req))
          manifest-file
          (cond in-place?
                (let [p (str dir "/profiles/" (:name req) "/itonami.edn")]
                  (when (hio/file? p) (hio/slurp-utf8 p)))
                copied-here?
                (let [p (str dir "/" (:to req) "/profiles/" (:name req) "/itonami.edn")]
                  (when (hio/file? p) (hio/slurp-utf8 p)))
                :else nil)
          parked?
          (cond (and (contains? #{"release" "adopt"} sub) in-place?)
                (hio/file? (str dir "/profiles/" (:name req) "/gateway.parked"))
                copied-here?
                (hio/file? (str dir "/" (:to req) "/profiles/" (:name req) "/gateway.parked"))
                :else nil)
          jobs-doc
          (when (and (= sub "hy-migrate") (not (:all req)) (:name req))
            (let [p (str dir "/profiles/" (:name req) "/cron/jobs.json")]
              (when (hio/file? p) (hio/slurp-utf8 p))))
          staged (when (= sub "hy-stage") (:staged r))
          soul-written (when (= sub "soul") (:soul-written r))
          did-out (when (= sub "did") (:did-out r))
          soul-backup
          (when (and (= sub "soul") (not (:all req)) (:name req))
            (let [stamp (str/replace (subs "2026-11-08T00:00:00+09:00" 0 19) #"[^0-9T]" "")
                  p (str dir "/state/soul-blocks/" stamp "/" (:name req) "/SOUL.md")]
              (when (hio/file? p) (hio/slurp-utf8 p))))]
      (assoc (cond-> r
               manifest-file (assoc :manifest-file manifest-file)
               (some? parked?) (assoc :parked? parked?)
               jobs-doc (assoc :jobs-doc jobs-doc)
               staged (assoc :staged staged)
               (some? soul-written) (assoc :soul-written soul-written)
               soul-backup (assoc :soul-backup soul-backup)
               did-out (assoc :did-out did-out))
             :messages (:lines r)))))

(defn- ops-runs [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [req (:request c {})
          home (str dir "/profiles/" (or (:profile req) "default"))]
      (when (seq (:setup-sql req))
        (hio/mkdirs! (str home "/cron"))
        (hio/sqlite-exec! (str home "/cron/executions.db")
                          (str/join ";\n" (concat ["DROP TABLE IF EXISTS executions"
                                                   "DROP TABLE IF EXISTS cron_incidents"]
                                                  (:setup-sql req)))))
      (let [r (runs-for dir (or (:profile req) "default") (:limit req))]
        (assoc r :messages (:lines r))))))

(defn- ops-incidents [c scratch]
  (let [dir (scratch-case-dir scratch c)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [req (:request c {})
          home (str dir "/profiles/" (or (:profile req) "default"))]
      (when (seq (:setup-sql req))
        (hio/mkdirs! (str home "/cron"))
        (hio/sqlite-exec! (str home "/cron/executions.db")
                          (str/join ";\n" (concat ["DROP TABLE IF EXISTS executions"
                                                   "DROP TABLE IF EXISTS cron_incidents"]
                                                  (:setup-sql req)))))
      (let [r (incidents-for dir (or (:profile req) "default") (:sub req) (:id req))]
        (assoc r :messages (:lines r))))))

;; ---------------------------------------------------------------- queue / ledger case ops
;; S5a state-plane coverage: the queue and ledger write paths run against a
;; fresh scratch home per case (both db files removed first, so a previous
;; run's rows can never leak in). Every step returns deterministic data:
;; random ids, pids and live stamps never appear in results — volatile
;; columns are stripped from row projections, and every timestamp is an
;; explicit step argument. Timestamps below are fixed strings, so the three
;; runners agree byte for byte.

(defn- stable-queue-row [r]
  (when r (dissoc r "owner_process_id" "owner_pid" "owner_started_at")))

(defn- stable-exec-row [r]
  (when r (dissoc r "process_id" "pid" "process_started_at")))

(defn- queue-home [dir req]
  (str dir "/profiles/" (or (:profile req) "p1")))

(defn- fresh-state-home! [home]
  (doseq [f [(str home "/cron/deliveries.db") (str home "/cron/executions.db")]]
    (when (hio/file? f) (hio/delete-file! f)))
  (hio/mkdirs! (str home "/cron")))

(defn- run-queue-step [home [verb & args]]
  (case verb
    "enqueue" (let [[exec-id job content for-failure? t] args]
                (stable-queue-row (queue/enqueue! home (str exec-id) job (str content) (boolean for-failure?) (str t))))
    "status" (stable-queue-row (queue/get-status home (str (first args))))
    "claim" (let [[exec-id t-ms pid] args]
              {:claimed (queue/claim-row! home (str exec-id) (long (or t-ms 0)) (long (or pid (hio/process-id))))})
    "claim-next" (let [[t-ms pid] args]
                   (stable-queue-row (queue/claim-next! home (long (or t-ms 0)) (long (or pid (hio/process-id))))))
    "finish" (let [[exec-id status error t] args]
               {:finished (queue/finish! home (str exec-id) (str status) (when error (str error)) (str t))})
    "recover" {:recovered (mapv stable-queue-row (queue/recover-abandoned! home (str (first args))))}
    "tombstones" (hio/sqlite-rows (queue/db-path home)
                   "SELECT execution_id,terminal_status,finished_at FROM delivery_tombstones ORDER BY execution_id" [])
    "deliveries" (mapv #(get % "execution_id")
                   (hio/sqlite-rows (queue/db-path home) "SELECT execution_id FROM deliveries ORDER BY execution_id" []))
    "seed-terminal" (let [[prefix n t] args]
                      (queue/open-db home)
                      ;; One transaction: 1005 autocommit INSERTs fsync
                      ;; per row (79s on JuiceFS, over the 30s bb spawn
                      ;; cap); a single COMMIT fsyncs once (0.17s).
                      ;; Same rows, same order, same assertions.
                      (hio/sqlite-exec! (queue/db-path home)
                        (str "BEGIN;\n"
                          (str/join ";\n"
                            (for [i (range (long (or n 0)))]
                              (str "INSERT INTO deliveries(execution_id,job_json,content,for_failure,status,created_at,finished_at)"
                                   " VALUES ('" prefix (let [s (str i)] (str (subs "0000" 0 (- 4 (count s))) s))
                                   "','{}','',0,'delivered','" t "','" t "')")))
                          ";\nCOMMIT;"))
                      {:seeded (long (or n 0))})
    (throw (ex-info (str "queue: unknown step " verb) {:verb verb}))))

(defn- ops-queue [c scratch]
  (let [dir (scratch-case-dir scratch c)
        req (:request c {})
        home (queue-home dir req)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (fresh-state-home! home)
    (when (seq (:setup-sql req))
      (queue/open-db home)
      (hio/sqlite-exec! (queue/db-path home) (str/join ";\n" (:setup-sql req))))
    {:results (mapv #(run-queue-step home %) (:steps req []))}))

(defn- run-ledger-step [home [verb & args]]
  ;; "claim" is handled by ops-ledger (it records the live id alias).
  (case verb
    "handoff" (let [[id t-sec] args]
                {:pending (ledger/mark-handoff-pending! home (str id) (double (or t-sec 0)))})
    "adopt" (let [[id t] args]
              {:adopted (ledger/adopt-claimed! home (str id) (str t))})
    "run" (let [[id t] args]
            {:running (ledger/mark-running! home (str id) (str t))})
    "finish" (let [[id success? outcome t] args]
               {:finished (ledger/finish! home (str id) (boolean success?) (str outcome) (str t))})
    "outcome" (let [[id outcome] args]
                {:settled (ledger/set-delivery-outcome! home (str id) (str outcome))})
    "upsert" (let [[job-id error output-file t] args]
               (ledger/upsert-incident! home (str job-id) (str error) (when output-file (str output-file)) (str t)))
    "incident" (let [[id] args]
                 (ledger/get-incident home (str id)))
    "incidents" (ledger/incidents home)
    "ack" (let [[id t] args]
            {:closed (ledger/ack-incident! home (str id) (str t))})
    "alerted" (let [[id t] args]
                {:alerted (ledger/mark-incident-alerted! home (str id) (str t))})
    "resolve" (let [[job-id t] args]
                {:resolved (ledger/resolve-incidents! home (str job-id) (str t))})
    "withhold" (let [[job-id config error output-file t] args]
                 (ledger/upsert-incident-for-failure! home {"id" (str job-id)} (or config {}) (str error)
                                                         (when output-file (str output-file)) (str t)))
    "rows" (mapv stable-exec-row (ledger/rows home (when-let [j (first args)] (str j))))
    "terminal-count" {:terminal (count (filter #(contains? #{"completed" "failed" "unknown"} (str (get % "status")))
                                               (ledger/rows home nil)))}
    "seed-terminal" (let [[prefix n t] args]
                      (ledger/open-db home)
                      ;; One transaction: same fsync-per-row reason as
                      ;; the queue seed above. Same rows, same order.
                      (hio/sqlite-exec! (ledger/db-path home)
                        (str "BEGIN;\n"
                          (str/join ";\n"
                            (for [i (range (long (or n 0)))]
                              (str "INSERT INTO executions(id,job_id,source,process_id,pid,status,claimed_at,finished_at)"
                                   " VALUES ('" prefix (let [s (str i)] (str (subs "0000" 0 (- 4 (count s))) s))
                                   "','seed-job','cron','seed',1,'completed','" t "','" t "')")))
                          ";\nCOMMIT;"))
                      {:seeded (long (or n 0))})
    (throw (ex-info (str "ledger: unknown step " verb) {:verb verb}))))

(defn- run-ledger-case
  ;; One ledger step. Live claim ids are random per run: later steps name
  ;; them "$live", and results never contain them (boolean steps only),
  ;; so every runner agrees byte for byte.
  [home live-id [verb & args]]
  (if (= (str verb) "claim")
    (let [[job-id source t] args]
      (try
        (reset! live-id (ledger/claim! home {"id" (str job-id)} (str source) (str t)))
        {:claimed true}
        (catch #?(:lpy python/Exception :clj Exception :cljs :default) _
          {:claimed false :reason "active-exists"})))
    (let [resolve-live (fn [a] (if (and (string? a) (= "$live" a)) @live-id a))]
      (run-ledger-step home (into [(str verb)] (map resolve-live args))))))

(defn- ops-ledger [c scratch]
  (let [dir (scratch-case-dir scratch c)
        req (:request c {})
        home (queue-home dir req)
        live-id (atom nil)]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (fresh-state-home! home)
    (when (seq (:setup-sql req))
      (ledger/open-db home)
      (hio/sqlite-exec! (ledger/db-path home) (str/join ";\n" (:setup-sql req))))
    {:results (mapv #(run-ledger-case home live-id %) (:steps req []))}))

(defn- ops-delivery [c]
  (let [[verb arg] (:call c)]
    {:value (case verb
              "normalize" (delivery/normalize-deliver-value arg)
              "lanes" (delivery/lanes arg)
              "token" (delivery/parse-bot-chat-token arg)
              "classify" (delivery/classify-outcome arg)
              (throw (ex-info (str "delivery: unknown call " verb) {:verb verb})))}))

;; ---------------------------------------------------------------- drain / gateway case ops
;; S5b: the drain rail runs against a fresh cron dir per case (DBs,
;; jobs.json, jsonl and output docs all start empty). Adapter behavior
;; is declarative: for-lane maps lane names to "ok", "err:<msg>",
;; "false" or "throw:<msg>" specs, and the op builds the stub fns.

(defn- stub-adapter [spec calls]
  (cond (= spec "ok") (fn [job lane content opts]
                        (swap! calls conj {"lane" (str lane) "content" (str content)})
                        nil)
        (= spec "false") (fn [job lane content opts]
                           (swap! calls conj {"lane" (str lane) "content" (str content)})
                           false)
        (str/starts-with? (str spec) "err:") (fn [job lane content opts]
                                               (swap! calls conj {"lane" (str lane) "content" (str content)})
                                               {:error (subs (str spec) 4)})
        (str/starts-with? (str spec) "throw:") (fn [job lane content opts]
                                                 (swap! calls conj {"lane" (str lane) "content" (str content)})
                                                 (throw (ex-info (subs (str spec) 6) {})))
        :else (throw (ex-info (str "drain: unknown adapter spec " spec) {:spec spec}))))

(defn- stub-gateway-send [spec calls]
  (let [rec (fn [chat-id text meta]
              (swap! calls conj {"chat" (str chat-id) "text" (str text) "meta" meta}))]
    (cond (= spec "ok") (fn [chat-id text meta] (rec chat-id text meta) nil)
          (= spec "false") (fn [chat-id text meta] (rec chat-id text meta) false)
          (str/starts-with? (str spec) "err:") (fn [chat-id text meta] (rec chat-id text meta) {:error (subs (str spec) 4)})
          (str/starts-with? (str spec) "throw:") (fn [chat-id text meta] (rec chat-id text meta) (throw (ex-info (subs (str spec) 6) {})))
          :else (throw (ex-info (str "gateway: unknown adapter spec " spec) {:spec spec})))))

(defn- run-drain-step [home prof calls warns for-lane delivery-fn config [verb & args]]
  (case verb
    "deliver" (let [[exec-id job-id content failed? t] args
                    job (drain/job-row home (str job-id))]
                (drain/deliver-output home (str exec-id) job (str content) (boolean failed?)
                                      delivery-fn config for-lane (str t)))
    "drain" (let [[t] args]
              {:drained (drain/drain-queued! prof for-lane (str t))})
    "settle" (let [[exec-id job-id error status] args]
               (drain/settle-queued-delivery! home (str exec-id) (str job-id)
                                              (when error (str error)) (str status)))
    "abandoned" (let [[t] args]
                  {:recovered (drain/tick-abandoned! home (str t))})
    "finish" (let [[job-id result t-start t-finished] args
                   job (drain/job-row home (str job-id))]
               (drain/finish-run! home job result (str t-start) (str t-finished)
                                  delivery-fn config for-lane))
    "job" (drain/job-row home (str (first args)))
    "queue" (let [r (queue/get-status home (str (first args)))]
              (when r (dissoc r "owner_process_id" "owner_pid" "owner_started_at")))
    "exec" (let [row (ledger/get-execution home (str (first args)))]
             (when row (dissoc row "process_id" "pid" "process_started_at")))
    "incidents" (ledger/incidents home)
    "run-line" (let [p (str home "/cron/itonami-runs.jsonl")]
                 (when (hio/file? p)
                   (let [lines (str/split-lines (hio/slurp-utf8 p))
                         row (hio/parse-json (last (filter (complement str/blank?) lines)))]
                     (select-keys row ["job_id" "status" "execution_id"]))))
    "usage-line" (let [p (str home "/cron/usage_audit.jsonl")]
                   (when (hio/file? p)
                     (let [lines (str/split-lines (hio/slurp-utf8 p))
                           row (hio/parse-json (last (filter (complement str/blank?) lines)))]
                       (select-keys row ["job_id" "deliver_target" "delivery_error" "response_silent" "duration_ms" "error"]))))
    "calls" @calls
    "doc" (let [[job-id t-start] args
                s (subs (str t-start) 0 19)
                fname (str (subs s 0 10) "_" (str/replace (subs s 11) ":" "-") ".md")
                p (str home "/cron/output/" (str job-id) "/" fname)]
            (when (hio/file? p) (hio/slurp-utf8 p)))
    (throw (ex-info (str "drain: unknown step " verb) {:verb verb}))))

(defn- ops-drain [c scratch]
  (let [dir (scratch-case-dir scratch c)
        req (:request c {})
        home (str dir "/profiles/" (or (:profile req) "p1"))
        cron (str home "/cron")
        calls (atom [])
        for-lane (let [specs (or (:for-lane req) {})]
                   (when (seq specs)
                     (fn [lane config]
                       (when-let [s (get specs (str lane))]
                         (stub-adapter s calls)))))
        delivery-fn (when-let [s (:delivery-fn req)]
                      (stub-adapter s calls))
        config (or (:config req) {})
        prof {:home home :config config}]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (hio/wipe-dir! cron)
    (hio/mkdirs! cron)
    (when (seq (:jobs req))
      (hio/write-text! (str cron "/jobs.json") (hio/json-str {"jobs" (vec (:jobs req))})))
    (when (seq (:setup-sql req))
      (queue/open-db home)
      (ledger/open-db home)
      (doseq [[db-file script] (:setup-sql req)]
        (hio/sqlite-exec! (str cron "/" (str db-file)) (str/join ";\n" script))))
    {:results (mapv #(run-drain-step home prof calls nil for-lane delivery-fn config %) (:steps req []))}))

(defn- stub-fetch [calls specs]
  (let [s (atom (vec specs))]
    (fn [url opts]
      (swap! calls conj {"url" (str url) "method" (str (:method opts)) "body" (str (:body opts))})
      (let [spec (first @s)]
        (when (nil? spec) (throw (ex-info "stub-fetch: exhausted" {})))
        (reset! s (vec (rest @s)))
        (case (str (get spec "kind"))
          "updates" {:ok true :status 200
                     :body-text (hio/json-str {"ok" true "result" (vec (get spec "updates" []))})}
          "json" {:ok true :status (or (get spec "status") 200) :json (get spec "json")
                     :body (get spec "json") :body-text (hio/json-str (get spec "json"))}
          "http" {:ok false :status (get spec "status") :json (get spec "json") :body-text ""}
          "throw" (throw (ex-info (str (get spec "message" "bang")) {}))
          (throw (ex-info (str "stub-fetch: unknown kind " (get spec "kind")) {})))))))

(defn- fanin-surface [calls req surface-spec]
  (let [deliver-answers (atom (vec (or (:deliver req) [])))
        deliver! (fn [text cand]
                   (swap! calls conj {"fanin-deliver"
                                      (subs (str text) 0 (min 120 (count (str text))))})
                   (let [a (first @deliver-answers)]
                     (reset! deliver-answers (vec (rest @deliver-answers)))
                     a))
        record! (when (get surface-spec "record")
                  (fn [evts]
                    (swap! calls conj {"coalesced" (mapv #(str (get % "session_id")) evts)})
                    nil))
        authority (get surface-spec "authority")]
    (cond-> {:deliver! deliver!
             :surface-child? (boolean (get surface-spec "surface-child?"))
             :batch-window (or (get surface-spec "window") 0.1)}
      record! (assoc :record-coalesced-siblings! record!)
      (get surface-spec "redact")
      (assoc :redact (let [k (str (get surface-spec "redact"))]
                       (if (= k "upper") (fn [t] (str/upper-case (str t))) (fn [t] (str t)))))
      authority (assoc :session-authority (str authority)
                       :lookup-session (let [m (or (get surface-spec "sessions") {})]
                                         (fn [k] (get m (str k))))
                       :list-admissions (let [rows (vec (or (get surface-spec "admissions") []))]
                                          (fn [_ _] rows))
                       :route-owner (fn [_ _] (str (get surface-spec "owner" "")))))))

(defn- run-gateway-step [ctx [verb & args]]
  (let [{:keys [adapters platforms calls warns fans settled next-hid]} ctx]
    (case verb
      "resolve" (let [[platform] args
                      t (gateway/resolve-delivery-transport (str platform) platforms adapters)]
                  (when t {"transport-platform" (str (:transport-platform t))
                           "config" (:config t)}))
      "inject" (let [[platform] args]
                 {:found (boolean (gateway/resolve-injection-adapter platforms adapters (str platform)))})
      "send" (let [[platform chat-id thread-id text] args
                   warns-atom warns]
               (gateway/send-watcher-message!
                {:platforms platforms :adapters adapters
                 :warn-fn (fn [m] (swap! warns-atom conj (str m)))}
                (str platform) (when (some? chat-id) (str chat-id))
                (when (some? thread-id) (str thread-id)) (str text)))
      "send-transport" (let [[spec logical chat-id text meta] args
                             answer (atom (get spec "answer"))
                             rec (fn [label a]
                                   (swap! calls conj {"transport-send" label "chat" (str a)})
                                   (let [r @answer] (reset! answer nil) r))]
                         (if (= "relay" (str (get spec "kind")))
                           (gateway/send-transport!
                            {:transport-platform "relay"
                             :adapter {:send-for-platform (fn [p c t m] (rec "relay" c))}}
                            (str logical) (str chat-id) (str text) meta)
                           (gateway/send-transport!
                            {:adapter {:send (fn [c t m] (rec "native" c))}}
                            (str logical) (str chat-id) (str text) meta)))
      "route-key" (let [[evt fields] args]
                    (gateway/event-route-key evt (mapv str fields)))
      "delivery-identity" (let [[evt] args]
                            (gateway/completion-delivery-identity evt))
      "producer-identity" (let [[evt] args]
                            (gateway/producer-identity evt))
      "admit" (let [[surface-spec event] args
                    surface (fanin-surface calls {} surface-spec)]
                (gateway/completion-admission surface event))
      "format-coalesced" (let [[redact-kind entries] args
                               redact (if (= "upper" (str redact-kind))
                                        (fn [t] (str/upper-case (str t)))
                                        (fn [t] (str t)))]
                           (gateway/format-coalesced-process-completions redact entries))
      "fan-in" (let [[which & rest-args] args]
                 (case (str which)
                   "new" (let [hid @next-hid]
                           (swap! next-hid inc)
                           (swap! fans assoc hid
                                  (gateway/completion-fan-in
                                   (fanin-surface calls (:req ctx) (first rest-args))))
                           hid)
                   "enqueue" (let [[hid text evt] rest-args
                                   fan (get @fans hid)
                                   r (gateway/enqueue-process-completion-notification!
                                      fan (str text) evt)]
                               (if (or (nil? r) (false? r))
                                 r
                                 (let [idx (count @settled)]
                                   (swap! settled conj r)
                                   idx)))
                   "flush" (let [[hid key] rest-args]
                             (gateway/flush-batch! (get @fans hid) (mapv str key)))
                   "settled" (let [[idx] rest-args]
                                @(nth @settled idx))
                   "batches" (let [[hid] rest-args]
                               (into {} (for [[k v] @(get (get @fans hid) :batches)]
                                          [(vec k) (count v)])))
                   "cancel" (let [[hid] rest-args]
                              (gateway/cancel-completion-batches! (get @fans hid))
                              nil)
                   (throw (ex-info (str "gateway: unknown fan-in step " which) {}))))
      "calls" @calls
      "warns" @warns
      (throw (ex-info (str "gateway: unknown step " verb) {:verb verb})))))

(defn- ops-gateway [c]
  (let [req (:request c {})
        calls (atom [])
        warns (atom [])
        adapters (into {} (for [[lane spec] (or (:adapters req) {})]
                             [(gateway/platform-value (str lane))
                              {:send (stub-gateway-send spec calls)}]))
        adapters (if-let [fronts (:relay-fronts req)]
                   (assoc adapters gateway/relay-platform
                          {:send (stub-gateway-send (or (:relay-send req) "ok") calls)
                           :fronts-platform (let [s (set (map str fronts))]
                                              (fn [p] (contains? s (gateway/platform-value p))))})
                   adapters)
        platforms (or (:platforms req) {})
        ctx {:req req :adapters adapters :platforms platforms :calls calls :warns warns
             :fans (atom {}) :settled (atom []) :next-hid (atom 0)}]
    {:results (mapv #(run-gateway-step ctx %) (:steps req []))}))

(defn- make-test-session [data]
  {:started-at (get data "started-at")
   :command (str (get data "command" ""))
   :exit-code (atom (get data "exit-code" 0))
   :output (atom (str (get data "output" "")))
   :owner-task-id (atom (str (get data "owner-task-id" "")))
   :task-id (atom (str (get data "task-id" "")))
   :state (atom (keyword (str (get data "state" "running"))))
   :completion-reason (atom (get data "completion-reason"))
   :termination-source (atom (str (get data "termination-source" "")))
   :parent-session-id (atom (str (get data "parent-session-id" "")))})

(defn- whole-number [v]
  (if (and (number? v) (== v (long v))) (long v) v))

(defn- run-watcher-step [ctx [verb & args]]
  (let [{:keys [sessions calls enqueues warns sleeps waits]} ctx
        {:keys [watcher config env consumed-ids launching-turn admission
                enqueue-answers max-ticks now-ms]} ctx]
    (case verb
      "watch" (let [seq-atom (atom (vec (:session-seq ctx)))
                    session-fn (fn [_id]
                                 (let [s @seq-atom]
                                   (if (empty? s)
                                     nil
                                     (do (reset! seq-atom (vec (rest s)))
                                         (when-let [id (first s)]
                                           (get sessions (str id)))))))
                    eq-atom (atom (vec enqueue-answers))
                    enqueue! (fn [text evt]
                               (swap! enqueues conj
                                      {"session" (str (get evt "session_id"))
                                       "head" (subs (str text) 0 (min 200 (count (str text))))})
                               (let [a @eq-atom]
                                 (if (empty? a)
                                   nil
                                   (do (reset! eq-atom (vec (rest a)))
                                       (when (= "refuse" (str (first a))) false)))))
                    send! (fn [platform chat-id thread-id text _watcher]
                            (swap! calls conj {"chat" (str chat-id) "text" (str text)
                                               "thread" (str thread-id)})
                            nil)]
                (watcher/run-process-watcher!
                 watcher
                 {:config config :env env
                  :session-fn session-fn :send! send!
                  :enqueue! enqueue!
                  :launching-turn-active? (fn [_ _] (boolean launching-turn))
                  :admission-recheck (when (some? admission)
                                       (fn [_] (boolean admission)))
                  :sleep-fn (fn [s] (swap! sleeps conj (whole-number s)) nil)
                  :now-fn (fn [] now-ms)
                  :consumed?-fn (fn [id] (contains? (set (map str consumed-ids)) (str id)))
                  :warn-fn (fn [m] (swap! warns conj (str m)) nil)
                  :max-ticks (or max-ticks 10000)}))
      "sends" @calls
      "enqueues" @enqueues
      "sleeps" @sleeps
      "warns" @warns
      "waits" @waits
      "mode" (process/background-notifications-mode (first args) (second args))
      "backoff" (whole-number (process/jittered-backoff (first args) (second args) (nth args 2)))
      "age" (process/format-age (first args))
      "notify" (process/format-completion-notification (first args))
      "short-command" (process/short-command (first args))
      "display-text" (process/process-completion-display-text (first args))
      "final" (let [[id mode now] args]
                (process/format-process-final-message (str id) (get sessions (str id)) (str mode) now))
      "running" (process/format-process-running-message (get sessions (str (first args))))
      "completion-event" (let [[w id] args]
                           (process/build-process-completion-event w (get sessions (str id)) (str id)))
      "batch" (process/notification-batch-text (first args) (set (map str (or (second args) []))))
      "drain" (process/drain-notifications!
               (let [o (first args)]
                 {:session-key (get o "session-key")
                  :skip-poll-observed? (if (contains? o "skip-poll-observed?") (boolean (get o "skip-poll-observed?")) true)
                  :surface-child? (boolean (get o "surface-child?"))
                  :queue (get o "queue") :consumed (set (map str (or (get o "consumed") [])))
                  :poll-observed (set (map str (or (get o "poll-observed") [])))}))
      "pending" (process/pending-notification-messages
                 (let [o (first args)]
                   {:session-key (get o "session-key")
                    :skip-poll-observed? (if (contains? o "skip-poll-observed?") (boolean (get o "skip-poll-observed?")) true)
                    :surface-child? (boolean (get o "surface-child?"))
                    :queue (get o "queue") :consumed (set (map str (or (get o "consumed") [])))
                    :poll-observed (set (map str (or (get o "poll-observed") [])))}))
      "linger" (whole-number (quiet/quiet-notify-linger-seconds (first args)))
      "suppress" (quiet/warning-notifications-enabled? (str (first args)) (second args))
      "diag" (quiet/diagnostic-process-event? (first args))
      "wake-muted" (quiet/diagnostic-only-wake-muted? (first args) (second args))
      "turn-failed" (quiet/turn-failed? (first args))
      "oneshot" (do (quiet/oneshot-exit-linger!
                     (first args) (boolean (second args))
                     {:wait-fn (fn [o] (swap! waits conj o) nil)})
                    nil)
      "continue" (let [[run-results drain-pairs wait-maps now] args
                       rr (atom (vec run-results))
                       dp (atom (vec drain-pairs))
                       wm (atom (vec wait-maps))]
                   (quiet/continue-quiet-notify-completions!
                    "sk"
                    (fn [texts] (let [r (first @rr)] (reset! rr (vec (rest @rr))) r))
                    {:config (:config ctx)
                     :linger-budget 600
                     :max-rounds (or (:max-rounds ctx) 8)
                     :surface-child? false
                     :now-fn (fn [] (or now 0))
                     :wait-fn (fn [_ _] (let [w (first @wm)] (reset! wm (vec (rest @wm))) (or w {})))
                     :drain-fn (fn [_] (let [d (first @dp)] (reset! dp (vec (rest @dp))) (or d [])))}))
      (throw (ex-info (str "watcher: unknown step " verb) {:verb verb})))))

(defn- ops-watcher [c]
  (let [req (:request c {})
        sessions (into {} (for [[id data] (or (:sessions req) {})]
                             [(str id) (make-test-session data)]))
        ctx {:watcher (or (:watcher req) {})
             :config (or (:config req) {})
             :env (or (:env req) {})
             :sessions sessions
             :session-seq (vec (or (:session-seq req) []))
             :consumed-ids (or (:consumed-ids req) [])
             :launching-turn (:launching-turn req)
             :admission (:admission req)
             :enqueue-answers (vec (or (:enqueue req) []))
             :max-ticks (:max-ticks req)
             :max-rounds (:max-rounds req)
             :now-ms (or (:now req) 0)
             :calls (atom []) :enqueues (atom []) :warns (atom [])
             :sleeps (atom []) :waits (atom [])}]
    {:results (mapv #(run-watcher-step ctx %) (:steps req []))}))

(defn- run-adapters-step [ctx [verb & args]]
  (let [{:keys [calls env fetch]} ctx]
    (case verb
      "build" (let [[lane params] args
                    p (or params {})
                    built (case (str lane)
                  "telegram" (adapters/telegram-request (str (get p "token")) (str (get p "chat")) (str (get p "text")))
                  "telegram-thread" (adapters/telegram-request (str (get p "token")) (str (get p "chat")) (str (get p "text")) (get p "thread"))
                  "slack" (adapters/slack-request (str (get p "token")) (str (get p "channel")) (str (get p "text")))
                  "discord" (adapters/discord-request (str (get p "webhook")) (str (get p "text")))
                  "discord-bot" (adapters/discord-bot-request (str (get p "token")) (str (get p "channel")) (str (get p "text")))
                  "mattermost" (adapters/mattermost-request (str (get p "webhook")) (str (get p "text")))
                  "matrix" (adapters/matrix-request (str (get p "home")) (str (get p "token")) (str (get p "room")) (str (get p "text")))
                  "feishu" (adapters/feishu-request (str (get p "token")) (str (get p "chat")) (str (get p "text")))
                  "dingtalk" (adapters/dingtalk-request (str (get p "token")) (str (get p "robot")) (str (get p "user")) (str (get p "text")))
                  "wecom" (adapters/wecom-request (str (get p "token")) (str (get p "to")) (get p "agent") (str (get p "text")))
                  "whatsapp" (adapters/whatsapp-request (str (get p "token")) (str (get p "phone")) (str (get p "to")) (str (get p "text")))
                  (throw (ex-info (str "adapters: unknown lane " lane) {})))]
                ;; the matrix txn id is random per send (legacy); normalize
                ;; for golden comparison (core behavior unchanged).
                (if (= "matrix" (str lane))
                  (update built :url (fn [u] (str/replace u #"/[0-9a-f]{24}$" "/TXN")))
                  built))
      "token-env" (let [[lane config] args]
                    (adapters/token-env-name (str lane) config))
      "token-defaults" adapters/token-env-defaults
      "resolve" (let [[lane config] args]
                  (boolean (adapters/for-lane (str lane) config env)))
      "send" (let [[lane config content opts] args
                   f (adapters/for-lane (str lane) config env)]
               (if (nil? f)
                 (str "no adapter for " (str lane))
                 (f {} (str lane) (str content) (assoc (or opts {}) :fetch fetch))))
      "calls" @calls
      (throw (ex-info (str "adapters: unknown step " verb) {:verb verb})))))

(defn- ops-adapters [c]
  (let [req (:request c {})
        calls (atom [])
        env (or (:env req) {})
        ctx {:calls calls :env env :fetch (stub-fetch calls (vec (or (:fetches req) [])))}]
    {:results (mapv #(run-adapters-step ctx %) (:steps req []))}))

(defn- ops-chat [c scratch]
  (let [req (:request c {})
        dir (scratch-case-dir scratch c)
        ;; every chat case starts from an empty directory: history jsonl
        ;; and the serve offset would otherwise leak from a previous run
        _ (hio/wipe-dir! dir)
        _ (hio/mkdirs! dir)
        calls (atom [])
        events (atom [])
        env (or (:env req) {})
        fetch (stub-fetch calls (vec (or (:fetches req) [])))
        turns (atom (vec (or (:turns req) [])))
        seen (atom #{})
        executor (fn [_prof _prompt _opts]
                   (let [t (first @turns)]
                     (reset! turns (vec (rest @turns)))
                     (if (and (map? t) (some? (get t "throw")))
                       (throw (ex-info (str (get t "throw")) {}))
                       t)))
        send! (fn [prof msg text]
                (chat/send-reply! prof msg (str text) fetch env))
        profiles (mapv (fn [p]
                         {:name (str (:name p))
                          :config (or (:config p) {})
                          :home (str dir "/profiles/" (str (:name p)))})
                       (or (:profiles req) []))
        dispatcher (chat/make-dispatcher
                    {:profiles profiles
                     :executor executor
                     :run-opts (fn [_ _] {})
                     :send! send!
                     :on-event (fn [e] (swap! events conj e))})]
    {:results
     (mapv
      (fn [[verb & args]]
        (case verb
          "normalize" (let [[platform raw] args]
                        (chat/normalize (str platform) raw))
          "guard" (let [[msg] args]
                    (chat/guard-message seen msg))
          "route" (let [[msg] args]
                    (chat/route-chat profiles msg))
          "history" (let [[platform chat-id] args]
                      (chat/load-history (str dir "/profiles/" (str (or (:home-profile req) "p1")))
                                         (str platform) (str chat-id)))
          "append" (let [[platform chat-id rows] args
                         home (str dir "/profiles/" (str (or (:home-profile req) "p1")))]
                      (chat/append-history! home (str platform) (str chat-id) rows)
                      (chat/load-history home (str platform) (str chat-id)))
          "dispatch" (let [[platform raw] args]
                       (dispatcher (str platform) raw))
          "events" @events
          "sends" @calls
          "token" (chat/telegram-token (or (:token-config req) {}) env)
          "backoff" (chat/backoff-ms (first args))
          "write-offset" (let [[n] args
                               f (str dir "/offset.json")]
                           (hio/replace-file! f (hio/json-str {"offset" n}))
                           n)
          "read-offset" (let [f (str dir "/offset.json")]
                          (if (hio/file? f)
                            (get (hio/parse-json (hio/slurp-utf8 f)) "offset")
                            "nofile"))
          "poll" (let [[token offset timeout] args]
                   (chat/telegram-poll! {:fetch fetch :token (str token)
                                         :offset offset :timeout timeout}))
          "serve" (let [[max-ticks stop-after] args
                        tick (atom 0)]
                    (chat/serve! {:fetch fetch :token (str (or (:serve-token req) "TOK"))
                                  :dispatch (fn [raw] (dispatcher "telegram" raw))
                                  :on-error (fn [e] (swap! events conj {:event :serve-error :error (str e)}))
                                  :interval (or (:serve-interval req) 5000)
                                  :max-ticks max-ticks
                                  :poll-timeout 25
                                  :offset-file (str dir "/offset.json")
                                  :sleep-fn (fn [ms] (swap! calls conj {"sleep-ms" ms}) nil)
                                  :stop? (if stop-after
                                           (fn [] (let [t (swap! tick inc)] (>= t stop-after)))
                                           (fn [] false))}))
          "chunk" (let [[text limit] args]
                    (if (some? limit)
                      (chat/chunk-text (str text) limit)
                      (chat/chunk-text (str text))))
          "prepare" (let [[platform chat-id] args
                          prof {:name "p1" :config (or (:profile-config req) {})}]
                      (chat/prepare-send-profile prof (str platform) (str chat-id)))
          "send-reply" (let [[msg text] args
                              prof {:name "p1" :config (or (:profile-config req) {})}]
                          (chat/send-reply! prof msg (str text) fetch env))
          (throw (ex-info (str "chat: unknown step " verb) {:verb verb}))))
      (:steps req []))}))
(defn- ops-assembly [c]
  (let [[verb arg arg2 arg3] (:call c)]
    {:value (case verb
              "history-messages" (assembly/history-messages arg)
              "wrap-up?" (assembly/wrap-up? arg arg2)
              "inject-wrapup" (let [seen (atom false)
                                    first (assembly/maybe-inject-run-budget-wrapup arg seen arg2 arg3)
                                    latched @seen
                                    second (assembly/maybe-inject-run-budget-wrapup first seen arg2 arg3)]
                                {:first first :latched latched :second second})
              "resolve-turn-limit" (if (some? arg2)
                                     (assembly/resolve-turn-limit arg arg2)
                                     (assembly/resolve-turn-limit arg))
              "resolve-max-turns" (assembly/resolve-max-turns arg arg2 arg3)
              "spellings" (sort assembly/unlimited-spellings)
              (throw (ex-info (str "turn-asm: unknown call " verb) {:verb verb})))}))

(defn- ops-execute [c]
  (let [calls (atom 0)
        stub (case (:via c "ok")
               "fail-1" (fn [step] (let [i (swap! calls inc)]
                                     (if (= i 2)
                                       {:status :failed :reason "turn/step-failed" :id (:id step)}
                                       {:status :ok :id (:id step)})))
               "unknown" (fn [step] {:status :unknown :id (:id step)})
               "bad" (fn [step] (str "ran-" (:id step)))
               "throw" (fn [step] (swap! calls inc)
                         (throw (ex-info "turn-exec: stub threw" {:id (:id step)})))
               (fn [step] (swap! calls inc) {:status :ok :id (:id step)}))]
    (let [res (execute/run-turn (:plan c) {:step-fn stub})]
      (cond (:fold c) {:turn (execute/turn-from-transcript res)}
            (:render c) {:rendered (execute/render-transcript
                                    res {:prompt (:prompt c "") :run-at (:run-at c)})}
            :else (assoc res :stub-calls @calls)))))

(defn- ops-quiet [c]
  (let [[verb arg arg2] (:call c)]
    {:value (case verb
              "warn-enabled?" (quiet/warning-notifications-enabled? arg arg2)
              "diagnostic-event?" (quiet/diagnostic-process-event? arg)
              "wake-muted?" (quiet/diagnostic-only-wake-muted? arg arg2)
              "linger-seconds" (quiet/quiet-notify-linger-seconds arg)
              "turn-failed?" (quiet/turn-failed? arg)
              (throw (ex-info (str "quiet: unknown call " verb) {:verb verb})))}))

(defn- ops-confine [c scratch]
  (let [dir (hio/abs-path (scratch-case-dir scratch c))]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (let [home (str dir "/home")
          idir (str dir "/itonami")]
      (hio/mkdirs! home)
      (hio/mkdirs! idir)
      (let [[verb arg arg2] (:call c)
            rel (fn [p] (str home "/" p))
            redact (fn [s] (-> (str s)
                               (str/replace (try (hio/realpath idir) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ idir)) "<idir>")
                               (str/replace (try (hio/realpath home) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ home)) "<home>")))
            redacted (letfn [(redacted [v] (cond (string? v) (redact v)
                                                     (map? v) (into {} (map (fn [[k x]] [k (redacted x)]) v))
                                                     (sequential? v) (mapv redacted v)
                                                     :else v))] redacted)]
        {:value (redacted
                 (case verb
                   "policy" (confine/policy arg (or arg2 {}))
                   "secret-paths" (confine/secret-paths home idir)
                   "read-denial" (confine/read-denial arg {:path (rel (:path arg2))
                                                           :roots (mapv rel (:roots arg2 []))
                                                           :home home :itonami-dir idir})
                   "confine-env" (confine/confine-env arg (:tool-env arg2 {}) (:tmpdir arg2))
                   "seatbelt-profile" (confine/seatbelt-profile
                                       {:write-roots (mapv rel (:write-roots arg []))
                                        :read-roots (mapv rel (:read-roots arg []))
                                        :read-scope (:read-scope arg)
                                        :home home :network? (:network? arg)
                                        :itonami-dir idir})
                   "bwrap-args" (confine/bwrap-args
                                 {:write-roots (mapv rel (:write-roots arg []))
                                  :read-roots (mapv rel (:read-roots arg []))
                                  :home home :network? (:network? arg)
                                  :itonami-dir idir
                                  :scan-fn (constantly (mapv rel (:found arg [])))})
                   "command" (dissoc (confine/command arg {:cmd (:cmd arg2) :argv (:argv arg2)
                                                           :write-roots (mapv rel (:write-roots arg2 []))
                                                           :read-roots (mapv rel (:read-roots arg2 []))
                                                           :tool-env (:tool-env arg2 {})
                                                           :home home :backend (some-> (:backend arg2) keyword)
                                                           :tmpdir (some-> (:tmpdir arg2) rel)
                                                           :itonami-dir idir
                                                           :scan-fn (when (contains? arg2 :found)
                                                                      (constantly (mapv rel (:found arg2))))}) :env)
                   (throw (ex-info (str "confine: unknown call " verb) {:verb verb}))))}))))

(defn- run-send-step [ctx [_ platform chat-id thread-id text]]
  (let [{:keys [profile-config env fetch]} ctx
        platform (str/lower-case (str (or platform "telegram")))]
    (cond
      (nil? chat-id)
      {:error "send: --chat-id is required"}
      (or (boolean? chat-id)
          (contains? #{"true" "false"} (str chat-id))
          (str/blank? (str chat-id)))
      {:error "send: --chat-id needs a chat id value (e.g. --chat-id -100123)"}
      (str/blank? (str text))
      {:error "send: message text is required"}
      :else
      (let [prof {:name "p1" :config (or profile-config {})}
            prepared (chat/prepare-send-profile prof platform (str chat-id))]
        (if-let [e (:error prepared)]
          {:error (str "send: " e)}
          (let [res (chat/send-reply! (:prof prepared)
                                      {"platform" platform
                                       "chat_id" (str chat-id)
                                       "thread_id" (str (or thread-id ""))}
                                      (str text) fetch env)]
            (if (nil? res)
              {:sent (str platform ":" chat-id)}
              {:error (str "send failed: " res)})))))))

(defn- run-tools-step [ctx [verb & args]]
  (case (str verb)
    "names" (let [[sets] args] (tools/tool-names (vec sets)))
    "toolsets" (vec (sort (keys tools/toolsets)))
    "unsupported-tools" (let [[names] args] (tools/unsupported-tools (vec names)))
    "unsupported-toolsets" (let [[sets additional] args]
                             (tools/unsupported-toolsets (vec sets) (set (or additional []))))
    "approval" (let [[name args] args] (tools/approval-required? (str name) (or args {})))
    "enabled" (let [[requested disabled] args]
                (tools/enabled-tool-names (vec requested) (vec disabled)))
    "execution-disabled" (let [[config platform] args]
                           (tools/execution-disabled-toolsets (or config {}) (str platform)))
    "runtime" (let [[requested disabled cdp? browser? computer?] args]
                (tools/runtime-tool-names (vec requested) (vec disabled)
                                          (boolean cdp?) (boolean browser?) (boolean computer?)))
    "schemas" (let [[names] args] (tools/tool-schemas (vec names)))
    (throw (ex-info (str "tools: unknown step " verb) {:verb verb}))))

(defn- ops-tools [c]
  (let [req (:request c {})]
    {:results (mapv #(run-tools-step {} %) (:steps req []))}))

(defn- ops-tts [c]
  (let [[verb arg arg2 arg3 arg4] (:call c)]
    {:value (case verb
              "configured" (tts/configured arg)
              "request" (tts/speech-request arg arg2 arg3 arg4)
              "format" (tts/safe-format arg)
              "timeout" (tts/clamp-timeout-s arg)
              (throw (ex-info (str "tts: unknown call " verb) {:verb verb})))}))

(defn- collect-stub
  "The outbox's injected fns, as a stub (mirrors the `:turn-exec`
  `:via` selection): `ok` signs and receipts; the rest fail the way a
  real signer/appender would (no signature, no receipt, throw)."
  [name]
  (case (str name)
    "no-sig" {:sign-fn (fn [_] nil)
              :append-fn (fn [_ _] {:transfer-id "t1"})}
    "no-receipt" {:sign-fn (fn [_] "sig")
                  :append-fn (fn [_ _] {})}
    "bare-receipt" {:sign-fn (fn [_] "sig")
                    :append-fn (fn [_ _] {:transfer-id "t1"})}
    "throw" {:sign-fn (fn [_] (throw (ex-info "collect: stub threw" {})))
             :append-fn (fn [_ _] {:transfer-id "t1"})}
    {:sign-fn (fn [_] "sig")
     :append-fn (fn [_ _] {:transfer-id "t1" :signed-by "tester"
                           :appended-at "2026-11-09T00:00:00+09:00"})}))

(defn- ops-collect [c]
  (let [[verb arg arg2] (:call c)]
    {:value (case verb
              "row" (collect/certify-row arg (collect-stub arg2))
              "certify" (collect/certify arg (collect-stub arg2))
              "reconcile" (collect/reconcile arg arg2)
              (throw (ex-info (str "collect: unknown call " verb) {:verb verb})))}))

(defn- ops-clarify [c]
  (let [[verb arg arg2 arg3] (:call c)]
    {:value (case verb
              "strip" (clarify/strip-recommended arg)
              "mark" (clarify/mark-recommended arg)
              "clean" (clarify/clean-answer arg arg2)
              "normalize" (clarify/normalize-questions arg)
              "status" (clarify/response-status arg arg2 arg3)
              "result" (clarify/result-json arg arg2)
              (throw (ex-info (str "clarify: unknown call " verb) {:verb verb})))}))

(defn- ops-webguard [c]
  (let [[verb arg arg2] (:call c)]
    {:value (case verb
              "blocked" (webguard/blocked-address? arg arg2)
              "allowed" (webguard/host-allowed? arg arg2)
              "refusal" (webguard/query-refusal arg)
              (throw (ex-info (str "webguard: unknown call " verb) {:verb verb})))}))

(defn- ops-vault [c]
  (let [[verb arg arg2 arg3] (:call c)]
    {:value (case verb
              "meta" (vault/login-meta arg arg2)
              "add" (vault/add-login arg arg2 arg3)
              "remove" (vault/remove-login arg arg2)
              "secret" (vault/secret arg arg2 arg3)
              "list" (vault/list-rows arg)
              "format" (vault/format-row arg)
              "totp" (vault/mint-totp arg arg2)
              "base32" (vault/base32-decode arg)
              (throw (ex-info (str "vault: unknown call " verb) {:verb verb})))}))

(defn- browser-file-stub
  "The screenshot `file?` witness, by name (mirrors the `:turn-exec`
  `:via` selection): `all` exists, `none` exists not, `png-only`
  keeps .png paths."
  [name]
  (case (str name)
    "all" (constantly true)
    "none" (constantly false)
    "png-only" (fn [p] (str/ends-with? (str p) ".png"))
    (throw (ex-info (str "browser: unknown file stub " name) {:stub name}))))

(defn- ops-browser [c]
  (let [[verb arg arg2] (:call c)]
    {:value (case verb
              "secret" (browser/secret-url? arg)
              "allowed" (browser/allowed-host? arg arg2)
              "connect" (browser/parse-connect-target arg arg2)
              "scrub" (browser/scrub-output arg)
              "redact" (browser/redact-cdp-output arg)
              "clamp" (browser/clamp-timeout arg)
              "shot" (browser/screenshot-path arg (browser-file-stub arg2))
              (throw (ex-info (str "browser: unknown call " verb) {:verb verb})))}))

(defn- ops-browser-cloud [c]
  (let [[verb arg arg2 arg3 arg4 arg5] (:call c)]
    {:value (case verb
              "name" (browser-cloud/session-name arg arg2)
              "bb-config" (browser-cloud/browserbase-config arg arg2 arg3)
              "bu-config" (browser-cloud/browser-use-config arg)
              "payload" (browser-cloud/browserbase-payload arg arg2)
              "downgrade" (browser-cloud/downgrade-payload arg)
              "features" (browser-cloud/browserbase-features arg arg2 arg3 arg4 arg5)
              "bb-session" (browser-cloud/browserbase-session arg arg2 arg3)
              "bu-session" (browser-cloud/browser-use-session arg arg2)
              "bb-close" (browser-cloud/browserbase-close arg arg2)
              "bu-close" (browser-cloud/browser-use-close arg arg2)
              (throw (ex-info (str "browser-cloud: unknown call " verb) {:verb verb})))}))

(defn- ops-browser-provider [c]
  (let [[verb arg arg2 arg3] (:call c)]
    {:value (case verb
              "normalize" (browser-provider/normalize-provider arg)
              "resolve" (browser-provider/resolve-provider arg arg2 arg3)
              (throw (ex-info (str "browser-provider: unknown call " verb) {:verb verb})))}))

(defn- ops-oauth [c]
  (let [[verb arg arg2 arg3 arg4 arg5] (:call c)]
    {:value (case verb
              "store-name" (oauth/store-name arg)
              "challenge" (oauth/verify-challenge arg)
              "pkce" (oauth/pkce-pair arg)
              "params" (oauth/auth-params arg arg2 arg3 arg4 arg5)
              "discovery" (oauth/discovery-record arg arg2)
              "reg-body" (oauth/registration-body arg)
              "reg-record" (oauth/registration-record arg)
              "token-record" (oauth/token-record arg arg2 arg3)
              (throw (ex-info (str "oauth: unknown call " verb) {:verb verb})))}))

(defn- ops-collect-io [c]
  (let [[verb arg arg2] (:call c)]
    {:value (case verb
              "receipt" (collect-io/receipt arg arg2)
              (throw (ex-info (str "collect-io: unknown call " verb) {:verb verb})))}))

(defn- ops-process [c]
  (let [[verb arg] (:call c)]
    {:value (case verb
              "redact" (process/redact-command arg)
              (throw (ex-info (str "process: unknown call " verb) {:verb verb})))}))

(defn- ops-dapps [c scratch]
  (let [dir (scratch-case-dir scratch c)
        [verb arg arg2 arg3 arg4] (:call c)
        req (:request c {})
        env (or (:env req) (hio/all-env))]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (case verb
      "status" {:rows (dapps/status env)}
      "with-servers" (dapps/with-servers arg arg2 env)
      "select-servers" {:value (dapps/select-servers arg arg2 arg3 arg4)}
      (throw (ex-info (str "dapps: unknown call " verb) {:verb verb})))))

(defn- ops-mcp [c]
  (let [[verb arg arg2 arg3 arg4 arg5 arg6 arg7] (:call c)
        req (:request c {})
        env (or (:env req) (hio/all-env))]
    {:value (case verb
              "enabled?" (mcp/enabled? arg)
              "names-for" (mcp/names-for arg arg2 arg3)
              "command-for" (mcp/command-for arg env)
              "server-env" (mcp/server-env arg env)
              "tool-name" (mcp/tool-name arg arg2)
              "tool-allowed?" (mcp/tool-allowed? arg arg2)
              "handshake-lines" (mcp/handshake-lines)
              "call-line" (mcp/call-line arg arg2 arg3)
              "collect-call-results" (mcp/collect-call-results arg)
              "collect-exchange-result" (mcp/collect-exchange-result arg)
              "render-result" (mcp/render-result arg)
              "cache-status" (mcp/cache-status arg arg2 arg3 arg4 arg5 arg6 arg7)
              "discover" (mcp/project-discovery arg arg2 arg3)
              (throw (ex-info (str "mcp: unknown call " verb) {:verb verb})))}))

(defn- ops-connections [c scratch]
  (let [dir (scratch-case-dir scratch c)
        [verb arg arg2] (:call c)
        req (:request c {})
        env (or (:env req) (hio/all-env))]
    (hio/mkdirs! dir)
    (seed-files! dir (:seed c {}))
    (case verb
      "status" {:rows (connections/connection-status arg env dir arg2)}
      "store-name" {:value (oauth/store-name arg)}
      (throw (ex-info (str "connections: unknown call " verb) {:verb verb})))))

(defn- ops-rails [c]
  (let [[verb arg arg2] (:call c)]
    {:value (case verb
              "small-model?" (rails/small-model? arg)
              "normalize-ids" (rails/normalize-model-ids arg)
              "detect-entries" (rails/detect-entries arg)
              "all-models" (rails/all-models arg)
              "agent-models" (rails/agent-models arg)
              "candidates" (rails/select-candidates arg arg2)
              (throw (ex-info (str "rails: unknown call " verb) {:verb verb})))}))

(defn- ops-homeassistant [c]
  (let [[verb arg arg2 arg3 arg4] (:call c)]
    {:value (case verb
              "entity-id-error" (homeassistant/entity-id-error arg)
              "service-error" (homeassistant/service-error arg arg2)
              "blocked-error" (homeassistant/blocked-error arg)
              "coerce-data" (homeassistant/coerce-data arg)
              "build-payload" (homeassistant/build-payload arg arg2 arg3 arg4)
              "project-states" (homeassistant/project-states arg arg2 arg3)
              "project-state" (homeassistant/project-state arg)
              "project-services" (homeassistant/project-services arg arg2)
              "project-affected" (homeassistant/project-affected arg)
              (throw (ex-info (str "homeassistant: unknown call " verb) {:verb verb})))}))

(defn- ops-computer-use [c]
  (let [[verb arg arg2 arg3 arg4] (:call c)]
    {:value (case verb
              "canon-keys" (computer-use/canon-keys arg)
              "blocked-input?" (boolean (computer-use/blocked-input? arg arg2))
              "select-window" (computer-use/select-window arg arg2 arg3 arg4)
              "build-request" (computer-use/build-request arg arg2 arg3)
              "content-text" (computer-use/content-text arg)
              "result-error" (computer-use/result-error arg)
              "action-request" (computer-use/action-request {:computer-state (atom arg)
                                                             :computer-session arg2} arg3 arg4)
              (throw (ex-info (str "computer-use: unknown call " verb) {:verb verb})))}))

(defn- ops-code-rpc [c]
  (let [[verb arg arg2 arg3 arg4] (:call c)]
    {:value (case verb
              "tool-error" (code-rpc/tool-error arg)
              "result-error" (code-rpc/result-error arg)
              "tool-errors-since" (code-rpc/tool-errors-since arg arg2)
              "sandbox-tools-for" (code-rpc/sandbox-tools-for arg)
              "failure-hint" (code-rpc/failure-hint arg arg2)
              "hint-on-failure" (code-rpc/hint-on-failure arg arg2 arg3 arg4)
              "generate-hermes-tools" (code-rpc/generate-hermes-tools arg)
              "token-str" (code-rpc/token-str arg)
              "token-ok?" (code-rpc/token-ok? arg arg2)
              "duration-seconds" (code-rpc/duration-seconds arg arg2)
              "req-file?" (code-rpc/req-file? arg)
              "res-name" (code-rpc/res-name arg)
              "int-seq?" (code-rpc/int-seq? arg)
              "refusal" (code-rpc/refusal arg arg2 arg3 arg4)
              "terminal-args" (code-rpc/terminal-args arg arg2)
              "message-text" (code-rpc/message-text (ex-info arg {}))
              "make-state" (let [st (code-rpc/make-state arg)]
                             {:rpc-dir (:rpc-dir st) :rpc-token (:rpc-token st)
                              :allowed (:allowed st) :max-tool-calls (:max-tool-calls st)
                              :counter @(:counter st)})
              "finish-call" (let [st (code-rpc/make-state {:rpc-dir "/tmp/r"
                                                           :dispatch (fn [_ _] "unused")})
                                  now (hio/now-ms)
                                  results (if (sequential? arg3) arg3 [arg3])
                                  out (mapv #(code-rpc/finish-call! st arg arg2 % now) results)]
                              {:result (last out) :count @(:counter st)
                               :log (mapv #(dissoc % "duration") @(:log st))})
              (throw (ex-info (str "code-rpc: unknown call " verb) {:verb verb})))}))

(defn- ops-send [c]
  (let [req (:request c {})
        calls (atom [])
        env (or (:env req) {})
        fetch (stub-fetch calls (vec (or (:fetches req) [])))
        ctx {:profile-config (or (:profile-config req) {}) :env env :fetch fetch}]
    {:results (mapv #(run-send-step ctx %) (:steps req []))}))

(defn- pad-end [s n]
  (let [s (str s)] (str s (apply str (repeat (max 0 (- n (count s))) " ")))))

(defn- route-ctx [ctx]
  (let [{:keys [req node fetch sign verify now-ms random-hex nonces runs active-runs complete]} ctx]
    {:node node :fetch fetch :sign sign :verify verify :now-ms now-ms :random-hex random-hex
     :nonces nonces :runs runs :active-runs active-runs :complete complete
     :trust {:trusted (or (:trusted req) #{})}
     :loopback? (boolean (:loopback? req))
     :infos (:infos req) :own-models (:own-models req)
     :public-url (:public-url req) :murakumo-did (:murakumo-did req)
     :max-runs (or (:max-runs req) 2)
     :rails (:rails req) :models (:models req) :agent-models (:agent-models req)
     :health (:health req) :profiles (:profiles req) :peer-urls (:peer-urls req)
     :bundles (:bundles req)}))

(defn- peer-list-lines [dir node fetch verify-fn now-ms nonces]
  (let [o {:fetch fetch :verify verify-fn :now-ms now-ms :nonces nonces}
        infos (peer/discover dir o)
        {:keys [trusted]} (peer/read-peers dir)
        me (:did node)]
    (vec (keep (fn [i]
                 (when-not (= me (:did i))
                   (str (pad-end (:url i) 32)
                        (if (:error i)
                          (str "unreachable: " (:error i))
                          (str (:did i)
                               (if (contains? trusted (:did i)) "  trusted" "  untrusted")
                               "  load " (:load i) "/" (:max-runs i)
                               "  models " (str/join "," (:agent-models i))
                               (when (:murakumo-did i) (str "  murakumo " (:murakumo-did i))))))))
               infos))))

(defn- run-peer-step [ctx [verb & args]]
  (let [{:keys [dir req fetch node now-ms random-hex sign verify nonces sleep sleeps complete run-local]} ctx
        verify-fn (cond (= verify "throw") (fn [& _] (throw (ex-info "peer verify failed" {})))
                        (false? verify) (fn [& _] false)
                        :else (fn [& _] true))]
    (case (str verb)
      "read" (peer/read-peers dir)
      "write" (let [[m] args] (peer/write-peers! dir m))
      "add" (let [[entry] args] (peer/add-peer! dir entry))
      "did" (let [[raw] args] (peer/pub->did (vec raw)))
      "parse" (let [[did] args] (peer/parse-did (str did)))
      "valid?" (let [[did] args] (peer/valid-did? (str did)))
      "sign" (let [[payload] args]
               (peer/sign-envelope node payload {:now-ms now-ms :random-hex random-hex :sign sign}))
      "open" (let [[envelope] args]
               (peer/open-envelope envelope {:trusted (or (:trusted req) #{})
                                             :verify verify-fn :now-ms now-ms :nonces nonces}))
      "auth" (let [[payload] args]
               (peer/auth-header node payload {:now-ms now-ms :random-hex random-hex :sign sign}))
      "materialize" (let [[cid files] args] (peer/materialize-bundle! dir (str cid) files))
      "file" (let [[rel] args]
               (let [p (str dir "/peer-runs/" (:cid req) "/home/" rel)
                     q (str (:home (:prof req)) "/" rel)]
                 (cond (hio/file? p) (hio/slurp-utf8 p)
                       (hio/file? q) (hio/slurp-utf8 q))))
      "fetch-bundle" (let [[origin-url cid] args]
                       (peer/fetch-bundle node (str origin-url) (str cid)
                                           {:fetch fetch :sign sign}))
      "ensure" (let [[config rail] args] (peer/ensure-rail config (when (some? rail) (str rail))))
      "rebase" (let [[text opts] args] (peer/rebase-paths (str text) opts))
      "records" (let [[services] args] (peer/service-records->peer-infos services))
      "overlay" (let [[infos services] args] (peer/overlay-service-records infos services))
      "http" (let [[url opts] args] (peer/http-json fetch (str url) opts))
      "header" (let [[v] args] (peer/header-envelope v))
      "trust" (let [[did] args]
                (peer/write-peers! dir (update (peer/read-peers dir) :trusted conj (str did))))
      "peer-info" (let [[url] args]
                    (peer/peer-info (str url) {:fetch fetch :verify verify-fn
                                               :now-ms now-ms :nonces nonces}))
      "discover" (peer/discover dir {:fetch fetch :verify verify-fn
                                     :now-ms now-ms :nonces nonces})
      "pick" (let [[infos cid] args
                    t (:trusted (peer/read-peers dir))]
                (peer/pick-peer infos t (:did node) (str cid)))
      "infer-peers" (let [[infos model] args
                          t (:trusted (peer/read-peers dir))]
                      (peer/infer-peers infos t (:did node) model))
      "infer-via" (let [[body infos] args
                        t (:trusted (peer/read-peers dir))]
                    (peer/infer-via-peers node body infos t
                                          {:fetch fetch :sign sign :verify verify-fn
                                           :now-ms now-ms :nonces nonces}))
      "remote-run" (let [[prompt run-opts peer] args]
                     (peer/remote-run (:prof req) (str prompt) (or run-opts {})
                                      peer (:origin-url req)
                                      {:node node :fetch fetch :sign sign :verify verify-fn
                                       :now-ms now-ms :nonces nonces :sleep sleep
                                       :files (:files req) :cid (:cid req)}))
      "route" (let [[method url body headers lb] args]
                (peer/serve-route (str method) (str url) body (or headers {})
                                  (cond-> (assoc (route-ctx ctx) :verify verify-fn)
                                    (some? lb) (assoc :loopback? (boolean lb)))))
      "local-complete" (let [[body] args]
                         (peer/local-gateway-complete
                          node body
                          {:complete complete :fetch fetch :sign sign :verify verify-fn
                           :now-ms now-ms :nonces nonces
                           :infos (:infos req) :trusted (or (:trusted req) #{})}))
      "place" (let [[prof prompt run-opts cfg] args]
                  (peer/placement prof (str prompt) (or run-opts {}) (or cfg {})
                                  (assoc (route-ctx ctx)
                                         :verify verify-fn
                                         :trust {:trusted (:trusted (peer/read-peers dir))}
                                         :dir dir :run-local run-local :sleep sleep
                                         :files (:files req) :cid (:cid req))))
      "list" (peer-list-lines dir node fetch verify-fn now-ms nonces)
      "sleeps" @sleeps
      (throw (ex-info (str "peer: unknown step " verb) {:verb verb})))))

(defn- ops-peer [c scratch]
  (let [req (:request c {})
        dir (scratch-case-dir scratch c)
        _ (hio/wipe-dir! dir)
        _ (hio/mkdirs! dir)
        calls (atom [])
        fetch (stub-fetch calls (vec (or (:fetches req) [])))
        node (or (:node req) {:did "did:key:zStub"})
        nows (atom (vec (or (:nows req) [])))
        sleeps (atom [])
        completes (atom (vec (or (:completes req) [])))
        locals (atom (vec (or (:locals req) [])))
        ctx {:dir dir :req req :fetch fetch :node node
             :now-ms (fn [] (let [s @nows]
                              (if (empty? s)
                                (long (or (:now req) 0))
                                (do (reset! nows (vec (rest s))) (long (first s))))))
             :random-hex (fn [_] (str (or (:nonce req) "000000000000000000000000")))
             :sign (fn [_payload] (str (or (:sig req) "SIG")))
             :verify (:verify req)
             :nonces (atom {})
             :sleep (fn [s] (swap! sleeps conj s) nil)
             :sleeps sleeps
             :complete (fn [_body] (let [s @completes]
                                     (if (empty? s)
                                       {:status 500 :text "no scripted completion" :rail "none"}
                                       (do (reset! completes (vec (rest s))) (first s)))))
             :run-local (fn [_prof _prompt _opts] (let [s @locals]
                                                    (if (empty? s)
                                                      {:final nil :exit-reason "no_placement"
                                                       :error {:error "no scripted local run"} :turns 0 :attempts []}
                                                      (do (reset! locals (vec (rest s))) (first s)))))
             :runs (atom {}) :active-runs (atom 0)}]
    {:results (mapv #(run-peer-step ctx %) (:steps req []))}))

(defn run-case [c fixtures scratch]
  (let [dir (when (:profile c) (str fixtures "/" (:profile c)))
        base (if dir (hio/read-text-fn dir) (constantly nil))
        edited (apply-edits base (:edit c []))
        got (try (observe c dir edited scratch)
                 (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                   {:crash (str (ex-message e))}))
        ok? (satisfied? c got)
        ;; negative control: the edit, not the fixture, must cause the rejection
        control-ok? (if (and (:negative c) (seq (:edit c)))
                      (not (satisfied? c (try (observe c dir base scratch)
                                              (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                                                {:crash (str (ex-message e))}))))
                      true)]
    {:id (:id c) :negative (boolean (:negative c)) :pass (and ok? control-ok?)
     :got (when-not (and ok? control-ok?) got)
     :control-failed (when-not control-ok? true)}))

(defn run-cases [path]
  (let [doc (hio/parse-edn (hio/slurp-utf8 path))
        fixtures (str (hio/dirname path) "/" (:fixtures doc "fixtures"))
        scratch (str (hio/dirname path) "/scratch")]
    (hio/mkdirs! scratch)
    (let [results (mapv #(run-case % fixtures scratch) (:cases doc))]
    {:runner (hio/runner-version)
     :cases (count results)
     :pass (count (filter :pass results))
     :fail (vec (for [r results :when (not (:pass r))] (dissoc r :pass)))
     :negative-controls (count (filter :negative results))
     :ids (mapv #(str (:id %) (if (:pass %) " ok" " FAIL")) results)})))

;; ---------------------------------------------------------------- main

(defn- capabilities-arg [args]
  (loop [as (seq args) caps []]
    (cond (nil? as) caps
          (and (= "--capability" (first as)) (second as))
          (recur (nnext as) (conj caps (keyword (second as))))
          :else (recur (next as) caps))))

(defn- store-flags [args]
  (loop [as (seq args) m {:pos []}]
    (cond (nil? as) m
          (= "--profile" (first as))
          (if (second as) (recur (nnext as) (assoc m :profile (second as))) (recur (next as) m))
          (= "--limit" (first as))
          (if (second as) (recur (nnext as) (assoc m :limit (second as))) (recur (next as) m))
          :else (recur (next as) (update m :pos conj (first as))))))

(defn- usage []
  (println "usage: itonami-otehon check <dir> | dry-run <dir> <job> [--capability c]... | tick <dir> | turn-gate <dir> <prompt> [--capability c]... | oneshot <dir> <prompt> [--capability c]... | run-plan <dir> <job> [--capability c]... [--script-file <path> | --script-error <text>] [--script-no-wake] | store-plan --direction import|export --from <dir> --to <dir> [--force] | pause [reason]... | resume | status | model <dir> [NAME] [--provider P] [--model M] | fallback <dir> [-m M] [--provider P] | run-exec <dir> <job> [--capability c]... | doctor [--profile P] | sessions [list|show <id>|resume] [--profile P] [--limit N] | notepad <profile-dir> <job> <verb> [key] [value] | profile [list | show <name> | check [<name>|--all] [--summary] | readiness [<name>|--all] | refresh [<name>|--all] [--dry-run] | itonamify [<name>|--all] [--force] [--dry-run] | rail <name>|--all --to <rail> [--dry-run] | bundle <name> | refresh-bundle <name> | release [<name>|--all] [--dry-run] | import [<p>|--all] [--from DIR] [--force] [--dry-run] | export [<p>|--all] [--to DIR] [--force] [--dry-run] | adopt [<p>|--all] [--dry-run] | soul [<p>|--all] --registry R --worlds W [--unit U] [--dry-run] | organize [<p>|--all] --registry R [--dry-run] | hy-stage [<p>|--all] <artifact> [--dry-run] | hy-migrate [<p>|--all] [--dry-run] | did [<p>|--all] [--registry R] [--out F]] | runs <store> <profile> [--limit N] | incidents <store> <profile> [ack <id>] | cas-put <store> <file>... | cas-get <store> <sha> <out> | cas-verify <store> | cas-gc <store> [--apply] [--retain-days N] | cas-reconcile <store> <peerdir>... [--as <node> --registry <reg.edn>] | fleet-status <peerdir>... [--as <node> --registry <reg.edn>] [--copies N] | peer-push <store> <peerdir> [--as <node> --registry <reg.edn>] | peer-pull <store> <peerdir> [--as <node> --registry <reg.edn>] | peer-repair <store> <peerdir>... [--as <node> --registry <reg.edn>] | market-match <asks.edn> <bids.edn> [--today YYYY-MM-DD] [--secrets <secrets.edn>] | market-sign <att.edn> --issuer-secret <secret> | market-verify <att.edn> --suite-secret <secret> [--today YYYY-MM-DD] | test <cases.edn>")
  64)

(defn- exit-for
  "0 ok (and planned / silent plans), 2 held, 1 refused."
  [r]
  (case (:status r) :ok 0 :planned 0 :silent 0 :held 2 1))

(defn- script-arg [args]
  (loop [as (seq args) file nil err nil wake? true]
    (cond (nil? as) (cond file {:ok? true :output (hio/slurp-utf8 file) :wake? wake?}
                           err {:ok? false :output err :wake? wake?}
                           :else nil)
          (= "--script-file" (first as))
          (if (second as) (recur (nnext as) (second as) err wake?) (recur (next as) file err wake?))
          (= "--script-error" (first as))
          (if (second as) (recur (nnext as) file (second as) wake?) (recur (next as) file err wake?))
          (= "--script-no-wake" (first as)) (recur (next as) file err false)
          :else (recur (next as) file err wake?))))

(defn- store-listing
  "The store-relative {path text} listing of a profile directory: the
  present definition files plus everything under scripts/ and skills/."
  [dir]
  (let [rt (hio/read-text-fn dir)
        base (into {} (keep (fn [f] (let [t (rt f)] (when (some? t) [f t])))
                         store/definition-files))
        under (fn [d]
                (let [rtf (hio/read-text-fn (str dir "/" d))]
                  (into {} (keep (fn [rel] (let [t (rtf rel)] (when (some? t) [(str d "/" rel) t])))
                                 (store/collect-files hio/read-dir-names hio/dir? (str dir "/" d))))))]
    (merge base (under "scripts") (under "skills"))))

(defn- store-args [args]
  (loop [as (seq args) m {}]
    (cond (nil? as) m
          (= "--direction" (first as)) (recur (nnext as) (assoc m :direction (keyword (second as))))
          (= "--from" (first as)) (recur (nnext as) (assoc m :from (second as)))
          (= "--to" (first as)) (recur (nnext as) (assoc m :to (second as)))
          (= "--force" (first as)) (recur (next as) (assoc m :force? true))
          :else (recur (next as) m))))

;; ---------------------------------------------------------------- cas store on disk

(defn- cas-manifest-path [store] (str store "/manifest.edn"))

(defn- read-edn-file [path]
  (when (hio/file? path) (hio/parse-edn (hio/slurp-utf8 path))))

(defn- kw-keys
  "Keywordize a map's string keys (hand-written EDN); keywords pass
  through. Applied at the CLI boundary so pure namespaces always see
  keyword keys while files stay hand-writable."
  [m]
  (into {} (map (fn [[k v]] [(if (string? k) (keyword k) k) v]) m)))

(defn- cas-read-manifest [store]
  (let [m (or (read-edn-file (cas-manifest-path store)) {})]
    (into {} (map (fn [[rel e]] [rel (if (map? e) (kw-keys e) e)]) m))))

(defn- cas-write-manifest! [store m]
  (hio/mkdirs! store)
  (hio/write-latin1! (cas-manifest-path store) (canon m)))

(defn- cas-object-path [store sha]
  (str store "/objects/" (cas/object-rel sha)))

(defn- cas-rel-name [path]
  (last (str/split path #"/")))

(defn- cas-put [store files]
  (let [inputs (mapv (fn [f] [f (hio/read-latin1 f)]) files)
        missing (vec (sort (map first (filter #(nil? (second %)) inputs))))
        names (mapv (comp cas-rel-name first) inputs)
        dupes (vec (sort (for [[n c] (frequencies names) :when (< 1 c)] n)))]
    (cond (seq missing)
          {:status :refused :reason "cas/file-missing" :missing missing}
          (seq dupes)
          {:status :refused :reason "cas/duplicate-name" :names dupes}
          :else
          (let [items (mapv (fn [[f s]] (assoc (cas/ingest (cas-rel-name f) (hio/bytes-of s)) :text s)) inputs)]
            (doseq [{:keys [sha text]} items]
              (hio/mkdirs! (str store "/objects/" (subs sha 0 2)))
              (hio/write-latin1! (cas-object-path store sha) text))
            (let [m (reduce (fn [m {:keys [rel sha size]}] (assoc m rel {:sha sha :size size}))
                            (cas-read-manifest store) items)]
              (cas-write-manifest! store m)
              {:status :ok :store store :stored (count items) :manifest (count m)})))))

(defn- cas-get [store sha out]
  (let [s (hio/read-latin1 (cas-object-path store sha))]
    (cond (nil? s)
          {:status :refused :reason "cas/object-missing" :sha sha}
          (not= sha (cas/sha256-hex (hio/bytes-of s)))
          {:status :refused :reason "cas/object-corrupt" :sha sha}
          :else
          (do (hio/write-latin1! out s)
              {:status :ok :sha sha :size (count (hio/bytes-of s))}))))

(defn- cas-verify [store]
  (let [m (cas-read-manifest store)
        r (cas/verify-manifest m (fn [rel] (when-let [e (get m rel)]
                                             (when-let [s (hio/read-latin1 (cas-object-path store (:sha e)))]
                                               (hio/bytes-of s)))))
        ok? (and (empty? (:mismatch r)) (empty? (:missing r)))]
    (assoc r :status (if ok? :ok :refused)
           :reason (when-not ok? "cas/verify-failed"))))

(defn- cas-inventory
  "Physical objects/ content as {sha size}. Missing dirs read empty;
  files that vanish mid-listing are skipped (the next gc sees them)."
  [store]
  (let [top (str store "/objects")]
    (into {} (mapcat (fn [shard]
                       (let [d (str top "/" shard)]
                         (keep (fn [f] (when-let [sz (hio/file-size (str d "/" f))]
                                         [(str shard f) sz]))
                               (hio/read-dir-names d))))
                     (hio/read-dir-names top)))))

(defn- cas-tombs-path [store] (str store "/tombstones.edn"))

(defn- cas-read-tombs
  "tombstones.edn {sha {:deleted-at :size}}, {} when absent. Hand-written
  files get the same kw-keys normalization as manifests."
  [store]
  (let [m (or (read-edn-file (cas-tombs-path store)) {})]
    (into {} (map (fn [[sha e]] [sha (if (map? e) (kw-keys e) e)]) m))))

(defn- cas-gc
  "Drop objects no manifest references. Dry-run by default (prints the
  plan, deletes nothing); --apply deletes and reports :deleted. The
  manifest is never rewritten; a failed delete refuses the whole gc.
  With --retain-days N, unreferenced objects rest in tombstones.edn
  for N days first: grace-expired ones are deleted, re-referenced ones
  revived, stale tomb entries cleared. The tombstone file is the audit
  trail of every deferred and completed drop."
  [store {:keys [apply? retain-days]} today]
  (let [m (cas-read-manifest store)
        inv (cas-inventory store)]
    (if (nil? retain-days)
      (let [plan (cas/gc-plan m inv)]
        (if-not apply?
          (assoc plan :status :ok :applied false)
          (let [paths (mapv #(str store "/objects/" (cas/object-rel %)) (:drop plan))
                ok? (mapv hio/delete-file! paths)
                failed (mapv first (filter (complement second) (map vector (:drop plan) ok?)))]
            (if (seq failed)
              {:status :refused :reason "cas/gc-failed" :failed failed}
              (assoc plan :status :ok :applied true :deleted (count (:drop plan)))))))
      (let [tombs (cas-read-tombs store)
            plan (cas/retention-plan m inv tombs today retain-days)]
        (if-not apply?
          (assoc plan :status :ok :applied false :tombs (count tombs))
          (let [paths (mapv #(str store "/objects/" (cas/object-rel %)) (:drop plan))
                ok? (mapv hio/delete-file! paths)
                failed (mapv first (filter (complement second) (map vector (:drop plan) ok?)))]
            (if (seq failed)
              {:status :refused :reason "cas/gc-failed" :failed failed}
              (let [stale (vec (sort (remove (set (keys inv)) (keys tombs))))
                    kept (apply dissoc tombs (concat (:drop plan) (:revived plan) stale))
                    marked (zipmap (:mark plan)
                                   (map (fn [s] {:deleted-at today :size (get inv s)})
                                        (:mark plan)))
                    next-tombs (merge kept marked)]
                (hio/mkdirs! store)
                (hio/write-latin1! (cas-tombs-path store) (canon next-tombs))
                (assoc plan :status :ok :applied true :deleted (count (:drop plan))
                       :stale stale :tombs (count next-tombs))))))))))

(defn- peer-apply-one [src dst sha size]
  (let [s (hio/read-latin1 (cas-object-path src sha))]
    (if (or (nil? s) (not= sha (cas/sha256-hex (hio/bytes-of s))))
      {:sha sha :size size :ok false}
      (do (hio/mkdirs! (str dst "/objects/" (subs sha 0 2)))
          (hio/write-latin1! (cas-object-path dst sha) s)
          (let [back (hio/read-latin1 (cas-object-path dst sha))]
            {:sha sha :size size
             :ok (and (some? back) (= sha (cas/sha256-hex (hio/bytes-of back))))})))))

(defn- peer-merge-manifest [dst-manifest src-manifest shas]
  (let [by-sha (into {} (map (fn [[rel e]] [(:sha e) [rel e]]) src-manifest))]
    (reduce (fn [m sha] (if-let [[rel e] (get by-sha sha)] (assoc m rel e) m))
            dst-manifest shas)))

(defn- peer-args [args]
  "Parses --as/--registry/--copies (a flag consumes its value); every
  other arg is a peer dir, collected in :peers in order. push/pull
  ignore :peers; repair heals across them, fleet-status censuses them."
  [args]
  (loop [as (seq args) m {:peers []}]
    (cond (nil? as) m
          (= "--as" (first as)) (recur (nnext as) (assoc m :as (second as)))
          (= "--registry" (first as)) (recur (nnext as) (assoc m :registry (second as)))
          (= "--copies" (first as)) (recur (nnext as) m)
          :else (recur (next as) (update m :peers conj (first as))))))

(defn- peer-gate [registry as peerdir today]
  (cond (nil? registry) {:ok true}
        (nil? as) {:ok false :reason "peer/node-required"}
        (not (peer/member? registry as today)) {:ok false :reason "peer/not-member" :node as}
        (not= (peer/node-prefix registry as) (cas-rel-name peerdir))
        {:ok false :reason "peer/prefix-mismatch" :node as}
        :else {:ok true}))

(defn- peer-sync [store peerdir direction opts today]
  (let [raw (when (:registry opts) (read-edn-file (:registry opts)))
        registry (when raw (into {} (map (fn [[n e]] [n (if (map? e) (kw-keys e) e)]) raw)))
        gate (peer-gate registry (:as opts) peerdir today)]
    (if-not (:ok gate)
      {:status :refused :gate (dissoc gate :ok)}
      (let [lm (cas-read-manifest store)
            rm (cas-read-manifest peerdir)
            plan (peer/sync-plan lm rm)
            jobs (if (= direction :send) (:send plan) (:fetch plan))
            src (if (= direction :send) store peerdir)
            dst (if (= direction :send) peerdir store)
            srcm (if (= direction :send) lm rm)
            dstm (if (= direction :send) rm lm)
            applied (mapv (fn [{:keys [sha size]}] (peer-apply-one src dst sha size)) jobs)]
        (if (some (complement :ok) applied)
          {:status :refused :reason "peer/copy-failed" :plan plan :applied applied}
          (do (cas-write-manifest! dst (peer-merge-manifest dstm srcm (map :sha jobs)))
              {:status :ok :direction direction :plan plan :applied (count applied)}))))))

(defn- admitted-peers
  "Gate every listed peer dir, in order. Returns {:admitted [{:peer
  :manifest}] :skipped [{:peer :reason}]}. Skipped peers are reported
  and never read."
  [opts today]
  (let [raw (when (:registry opts) (read-edn-file (:registry opts)))
        registry (when raw (into {} (map (fn [[n e]] [n (if (map? e) (kw-keys e) e)]) raw)))
        gated (mapv (fn [pd] {:dir pd :gate (peer-gate registry (:as opts) pd today)})
                    (:peers opts))
        ok? #(get-in % [:gate :ok])]
    {:admitted (mapv (fn [{:keys [dir]}] {:peer dir :manifest (cas-read-manifest dir)})
                     (filter ok? gated))
     :skipped (mapv (fn [{:keys [dir gate]}] {:peer dir :reason (:reason gate)})
                    (remove ok? gated))}))

(defn- read-edn-safe
  "read-edn-file that survives corruption: nil when missing, ::corrupt
  when the file is there but unparsable, data otherwise."
  [path]
  (if-not (hio/file? path)
    nil
    (try (hio/parse-edn (hio/slurp-utf8 path))
         (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ ::corrupt))))

(defn- cas-rehash-inventory
  "Re-hash every stored object from its bytes: [{:sha :size}] sorted by
  sha. The path-derived digest is never trusted here; a tampered file
  reports under its true digest (or drops out when unreadable)."
  [store]
  (->> (cas-inventory store)
       keys
       (keep (fn [psha]
               (when-let [s (hio/read-latin1 (str store "/objects/" (cas/object-rel psha)))]
                 (let [bs (hio/bytes-of s)]
                   {:sha (cas/sha256-hex bs) :size (count bs)}))))
       distinct
       vec
       (sort-by :sha)))

(defn- cas-reconcile
  "Rebuild damaged manifest entries from content + peers. Adopts rels
  the local manifest lacks (first peer wins, content re-hashed); never
  overwrites a local entry. Conflicts refuse the whole reconcile and
  nothing is written. Reports :local-damaged when the manifest file
  was present but unparsable."
  [store opts today]
  (let [{:keys [admitted skipped]} (admitted-peers opts today)]
    (if (empty? admitted)
      {:status :refused :reason "cas/reconcile-no-peer" :skipped skipped}
      (let [raw-local (read-edn-safe (cas-manifest-path store))
            local (if (map? raw-local)
                    (into {} (map (fn [[rel e]] [rel (if (map? e) (kw-keys e) e)]) raw-local))
                    {})
            damaged (and (some? raw-local) (not (map? raw-local)))
            plan (cas/manifest-rebuild local (cas-rehash-inventory store) admitted)]
        (cond (seq (:conflicts plan))
              {:status :refused :reason "cas/reconcile-conflict"
               :conflicts (:conflicts plan) :skipped skipped :local-damaged damaged}
              (empty? (:adopted plan))
              {:status :ok :adopted 0 :entries [] :unmatched (:unmatched plan)
               :skipped skipped :local-damaged damaged}
              :else
              (do (cas-write-manifest!
                   store (merge local (into {} (map (fn [{:keys [rel sha size]}]
                                                      [rel {:sha sha :size size}])
                                                    (:adopted plan)))))
                  {:status :ok :adopted (count (:adopted plan)) :entries (:adopted plan)
                   :unmatched (:unmatched plan) :skipped skipped :local-damaged damaged}))))))

(defn- fleet-status
  "Fleet-wide copy census over admitted peers: who holds what, and what
  falls below `desired` copies. Read-only; skipped peers are reported,
  never read. No admitted peer refuses the whole status."
  [opts today desired]
  (let [{:keys [admitted skipped]} (admitted-peers opts today)]
    (if (empty? admitted)
      {:status :refused :reason "fleet/no-peer" :skipped skipped}
      (let [fc (peer/fleet-copies admitted)
            plan (peer/replication-plan (:copies fc) desired)]
        {:status :ok :peers (:peers fc) :objects (:objects fc)
         :desired desired :under (:under plan) :healthy (:healthy plan)
         :skipped skipped}))))

(defn- repair-one
  "Copy one bad object from the first candidate peer whose manifest
  lists its rel (try-order), re-hashed on receipt. Returns the
  peer-apply-one record with :rel and the winning :from, or :ok false
  when every candidate copy failed."
  [candidates store {:keys [rel sha size]}]
  (loop [cs (filter #(contains? (:manifest %) rel) candidates)]
    (if (empty? cs)
      {:rel rel :sha sha :size size :ok false :from nil}
      (let [r (peer-apply-one (:peer (first cs)) store sha size)]
        (if (:ok r)
          (assoc r :rel rel :from (:peer (first cs)))
          (recur (rest cs)))))))

(defn- peer-repair
  "Heal tampered or missing local objects from admitted peers, in
  listed order with fallback: each bad object is copied from the first
  peer whose manifest lists it, and on copy failure the next such peer
  is tried. Peers failing the registry gate are listed in :skipped and
  never touched. :ok only when the final verify is clean; otherwise
  refused with the remaining bad rels. The manifest is untouched: bad
  rels already point at the right digests."
  [store opts today]
  (let [{:keys [admitted skipped]} (admitted-peers opts today)]
    (if (empty? admitted)
      {:status :refused :reason "peer/repair-no-peer" :skipped skipped}
      (let [lm (cas-read-manifest store)
            read-local (fn [rel] (when-let [e (get lm rel)]
                                   (when-let [s (hio/read-latin1 (cas-object-path store (:sha e)))]
                                     (hio/bytes-of s))))
            rms admitted
            plan (peer/repair-plan (cas/verify-manifest lm read-local) rms)
            healed (mapv #(repair-one rms store %) (:repair plan))
            failed (filterv (complement :ok) healed)]
        (if (seq failed)
          {:status :refused :reason "peer/repair-copy-failed"
           :failed (mapv :sha failed) :skipped skipped}
          (let [vr (cas/verify-manifest lm read-local)
                left (vec (sort (distinct (concat (:mismatch vr []) (:missing vr [])))))]
            (if (seq left)
              {:status :refused :reason "peer/repair-incomplete"
               :unrepairable (:unrepairable plan) :remaining left :skipped skipped}
              {:status :ok :repaired (count healed)
               :from (frequencies (map :from healed))
               :skipped skipped :unrepairable (:unrepairable plan)})))))))

(defn- market-today [more]
  (loop [as (seq more) today nil]
    (cond (nil? as) today
          (= "--today" (first as)) (recur (nnext as) (second as))
          :else (recur (next as) today))))

(defn- market-flag [more flag]
  (loop [as (seq more)]
    (cond (nil? as) nil
          (= flag (first as)) (second as)
          :else (recur (next as)))))

(defn- str-keys
  "Issuer secrets keyed by name: keyword keys become their name so
  hand-written {\"k\" ...} and {:k ...} EDN agree. Values pass through."
  [m]
  (into {} (map (fn [[k v]] [(if (keyword? k) (name k) (str k)) v]) m)))

(defn main* [args]
  (let [[cmd a b & more] args]
    (case cmd
      "check" (if-not a
                (usage)
                (let [r (check-result (load-dir a (hio/read-text-fn a)))]
                  (println (canon r))
                  (if (zero? (:errors r)) 0 1)))
      "dry-run" (if-not (and a b)
                  (usage)
                  (let [r (profile/dry-run (load-dir a (hio/read-text-fn a)) b
                                           {:capabilities (capabilities-arg more)})]
                    (println (canon r))
                    (case (:status r) :ok 0 :held 2 1)))
      "tick" (if-not a
               (usage)
               (let [prof (load-dir a (hio/read-text-fn a))
                     errs (profile/errors (profile/check prof))]
                 (if (seq errs)
                   (do (println (canon {:profile (:name prof) :status :refused
                                        :reason "profile/invalid" :problems errs}))
                       1)
                   (let [now (hio/now-parts)
                         r (assoc (tick/tick-plan (:jobs prof) now) :profile (:name prof))]
                     (println (canon r))
                     0))))
      "turn-gate" (if-not (and a b)
                    (usage)
                    (let [r (turn/turn-gate (load-dir a (hio/read-text-fn a)) b
                                            {:capabilities (capabilities-arg more)})]
                      (println (canon r))
                      (exit-for r)))
      "muse-oneshot" (let [[output binding-file] more]
                       (if-not (and a b output binding-file)
                         (usage)
                         (let [r (muse-host/invoke! (load-dir a (hio/read-text-fn a))
                                                   (hio/slurp-utf8 b) output
                                                   (hio/parse-edn (hio/slurp-utf8 binding-file)))]
                           (println (canon (dissoc r :text :usage)))
                           (if (= "completed" (:state r)) 0 3))))
      "oneshot" (if-not (and a b)
                  (usage)
                  (let [prof (load-dir a (hio/read-text-fn a))
                        r (execute-oneshot prof b (capabilities-arg more) nil)]
                    (doseq [l (:lines r)] (println l))
                    (:exit r)))
      "run-plan" (if-not (and a b)
                   (usage)
                   (let [now (hio/now-parts)
                         r (run/run-plan (load-dir a (hio/read-text-fn a)) b
                                         {:capabilities (capabilities-arg more)
                                          :script (script-arg more)
                                          :now now
                                          :stamp "plan"
                                          :run-at "plan"})]
                     (println (canon r))
                     (exit-for r)))
      "store-plan" (let [{:keys [direction from to force?]} (store-args args)]
                     (if-not (and (contains? #{:import :export} direction) from to)
                       (usage)
                       (let [r (store/plan-copy {:from (store-listing from) :to (store-listing to)
                                                 :force? force? :direction direction
                                                 :from-name from :to-name to})]
                         (println (canon r))
                         (if (= :ok (:status r)) 0 1))))
      "pause" (let [root (pause/store-root hio/env)
                    reason (let [r (str/trim (str/join " " (filter some? (cons a (cons b more)))))]
                             (when-not (str/blank? r) r))]
                (hio/mkdirs! root)
                (hio/write-text! (pause/marker-path root)
                                 (pause/format-record (:iso (hio/now-parts)) reason))
                (println (pause/pause-message reason))
                0)
      "resume" (let [root (pause/store-root hio/env)
                     m (pause/marker-path root)
                     was (hio/file? m)]
                 (when was (hio/delete-file! m))
                 (println (pause/resume-message was))
                 0)
      "status" (let [r (gather-status (pause/store-root hio/env))]
                 (doseq [l (status/render-status r)] (println l))
                 0)
      "model" (if-not a
                (usage)
                (let [{:keys [pos run-model provider]} (model-flags (cons b more))
                      req (model/model-request pos run-model provider)]
                  (if (:error req)
                    (do (println (:error req)) 2)
                    (let [flags {:run-model run-model :provider provider}]
                      (if-let [s (:set req)]
                        (let [p (str a "/config.yaml")
                              cur (when (hio/file? p) (hio/slurp-utf8 p))]
                          (try
                            (let [written (model/set-model-text (or cur "") (:model s) (:provider s))]
                              (hio/mkdirs! a)
                              (hio/replace-file! p written)
                              (let [r (resolve-in a flags)]
                                (doseq [l (model/model-lines r true)] (println l))
                                0))
                            (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                              (println (ex-message e)) 1)))
                        (let [r (resolve-in a flags)]
                          (doseq [l (model/model-lines r false)] (println l))
                          0))))))
      "fallback" (if-not a
                   (usage)
                   (let [{:keys [pos run-model provider]} (model-flags (cons b more))]
                     (if (seq pos)
                       (do (println "usage: itonami-agent fallback [--profile P] [-m model]") 2)
                       (let [r (resolve-in a {:run-model run-model :provider provider})]
                         (doseq [l (model/fallback-lines r)] (println l))
                         0))))
      "run-exec" (if (or (not a) (not b))
                   (usage)
                   (let [prof (load-dir a (hio/read-text-fn a))
                         r (execute-run prof b (capabilities-arg more) (host-now) nil)]
                     (doseq [l (:lines r)] (println l))
                     (:exit r)))
      "doctor" (let [{:keys [profile]} (store-flags (cons b more))
                     r (doctor-for (pause/store-root hio/env) (or profile "default")
                                   (hio/all-env) nil)]
                 (doseq [l (:lines r)] (println l))
                 (:exit r))
      "sessions" (let [{:keys [profile limit pos]} (store-flags (cons b more))
                       r (sessions-for (pause/store-root hio/env) (or profile "default")
                                       (first pos) (second pos) limit)]
                   (doseq [l (:lines r)] (println l))
                   (:exit r))
      "notepad" (if (or (not a) (not b))
                  (usage)
                  (let [[verb k v] more
                        r (notepad-for (str a) b verb k v (:iso (host-now)))]
                    (doseq [l (:lines r)] (println l))
                    (:exit r)))
      "profile" (let [sub (or a "list")
                    root (pause/store-root hio/env)
                    tail (filterv some? (cons b more))
                    flag? (fn [f] (boolean (some #{f} tail)))
                    opt-val (fn [f] (second (drop-while #(not= % f) tail)))
                    targets (if (flag? "--all") (listing-names root) [(or b "default")])
                    run (fn [r] (doseq [l (:lines r)] (println l)) (:exit r))]
                (cond (= sub "list")
                      (run {:exit 0 :lines (profile-list-lines root)})
                      (= sub "show")
                      (run (profile-show-lines root (or b "default")))
                      (= sub "check")
                      (run (check-lines root targets (flag? "--summary")))
                      (= sub "readiness")
                      (run (readiness-lines root targets (hio/all-env)))
                      (= sub "refresh")
                      (run (refresh-lines root targets (flag? "--dry-run")))
                      (= sub "itonamify")
                      (run (itonamify-lines root targets (flag? "--force") (flag? "--dry-run")))
                      (= sub "rail")
                      (run (rail-lines root targets
                                       (when-let [t (opt-val "--to")] (keyword (str t)))
                                       (flag? "--dry-run")))
                      (= sub "refresh-bundle")
                      (if-not b (usage) (run (refresh-bundle-lines root b)))
                      (= sub "adopt")
                      (run (adopt-lines root (if (flag? "--all") (listing-names root) [b])
                                       (flag? "--all") (hio/all-env) (flag? "--dry-run") (:iso (host-now))))
                      (= sub "soul")
                      (run (soul-lines root (if (flag? "--all") (listing-names root) [b])
                                           (some-> (opt-val "--registry") (exec/expand-home (hio/env "HOME")))
                                           (some-> (opt-val "--worlds") (exec/expand-home (hio/env "HOME")))
                                           (opt-val "--unit")
                                           (flag? "--dry-run") (:iso (host-now))))
                      (= sub "organize")
                      (run (organize-lines root (if (flag? "--all") (listing-names root) [b])
                                             (some-> (opt-val "--registry") (exec/expand-home (hio/env "HOME")))
                                             (flag? "--dry-run")))
                      (= sub "hy-stage")
                      (let [pa (filterv #(not (str/starts-with? (str %) "--")) tail)
                            art (some-> (or (opt-val "--artifact") (if (flag? "--all") (first pa) (second pa)))
                                        (exec/expand-home (hio/env "HOME")))]
                        (run (hy-stage-lines root (if (flag? "--all") (listing-names root) [b])
                                              art (flag? "--dry-run"))))
                      (= sub "hy-migrate")
                      (let [now (host-now)]
                        (run (hy-migrate-lines root (if (flag? "--all") (listing-names root) [b])
                                                  (hio/all-env) (flag? "--dry-run")
                                                  (exec/micros-of (:iso now) (:ms now)))))
                      (= sub "did")
                      (run (did-lines root b (flag? "--all") (hio/all-env)
                                      (some-> (opt-val "--registry") (exec/expand-home (hio/env "HOME")))
                                      (some-> (opt-val "--out") (exec/expand-home (hio/env "HOME")))))
                      (= sub "bundle")
                      (if-not b (usage) (run (bundle-lines root b)))
                      (= sub "release")
                      (run (release-lines root (if (flag? "--all") (listing-names root) [b])
                                           (flag? "--dry-run") (:iso (host-now))))
                      (or (= sub "import") (= sub "export"))
                      (let [hermes-home (or (hio/env "ITONAMI_HERMES_ROOT")
                                            (str (hio/env "HOME") "/.hermes"))
                            from (exec/expand-home (or (opt-val "--from")
                                                       (when (= sub "import") hermes-home)
                                                       root)
                                                   (hio/env "HOME"))
                            to (exec/expand-home (or (opt-val "--to")
                                                     (when (= sub "export") hermes-home)
                                                     root)
                                                 (hio/env "HOME"))
                            t (if (flag? "--all")
                                (let [ts (listing-names from)] (when (seq ts) ts))
                                (when b [b]))]
                        (if (nil? t)
                          (do (println (transfer-usage sub)) 2)
                          (run (transfer-lines sub from to t
                                                (flag? "--dry-run") (flag? "--force")
                                                (:iso (host-now))))))
                      :else (do (println (str "unknown profile command: " sub)) 2)))
      "runs" (if-not a
               (usage)
               (let [tail (filterv some? (cons b more))
                     lim (second (drop-while #(not= % "--limit") tail))
                     r (runs-for a (or b "default") lim)]
                 (doseq [l (:lines r)] (println l))
                 (:exit r)))
      "incidents" (if-not a
                    (usage)
                    (let [[sub id] more
                          r (incidents-for a (or b "default") sub id)]
                      (doseq [l (:lines r)] (println l))
                      (:exit r)))
      "cas-put" (let [files (if b (cons b more) [])]
                  (if (or (nil? a) (empty? files))
                    (usage)
                    (let [r (cas-put a files)]
                      (println (canon r))
                      (if (= :ok (:status r)) 0 1))))
      "cas-get" (if-not (and a b (first more))
                  (usage)
                  (let [r (cas-get a b (first more))]
                    (println (canon r))
                    (if (= :ok (:status r)) 0 1)))
      "cas-verify" (if-not a
                     (usage)
                     (let [r (cas-verify a)]
                       (println (canon r))
                       (if (= :ok (:status r)) 0 1)))
      "cas-gc" (if-not a
                 (usage)
                 (let [tail (cons b more)
                       days-str (market-flag tail "--retain-days")
                       days (when days-str (cas/parse-int days-str))]
                   (if (and days-str (or (nil? days) (neg? days)))
                     (do (println (canon {:status :refused :reason "cas/bad-retain-days"})) 1)
                     (let [r (cas-gc a {:apply? (boolean (some #{"--apply"} tail))
                                        :retain-days days}
                                     (subs (:iso (hio/now-parts)) 0 10))]
                       (println (canon r))
                       (if (= :ok (:status r)) 0 1)))))
      "cas-reconcile" (if-not (and a b)
                        (usage)
                        (let [r (cas-reconcile a (peer-args (cons b more)) (subs (:iso (hio/now-parts)) 0 10))]
                          (println (canon r))
                          (if (= :ok (:status r)) 0 1)))
      "fleet-status" (if-not a
                       (usage)
                       (let [tail (filterv some? (cons a (cons b more)))
                             copies-str (market-flag tail "--copies")
                             copies (if (nil? copies-str) 2 (cas/parse-int copies-str))]
                         (if (or (nil? copies) (< copies 1))
                           (do (println (canon {:status :refused :reason "fleet/bad-copies"})) 1)
                           (let [r (fleet-status (peer-args tail) (subs (:iso (hio/now-parts)) 0 10) copies)]
                             (println (canon r))
                             (if (= :ok (:status r)) 0 1)))))
      "peer-push" (if-not (and a b)
                    (usage)
                    (let [r (peer-sync a b :send (peer-args more) (subs (:iso (hio/now-parts)) 0 10))]
                      (println (canon r))
                      (if (= :ok (:status r)) 0 1)))
      "peer-pull" (if-not (and a b)
                    (usage)
                    (let [r (peer-sync a b :fetch (peer-args more) (subs (:iso (hio/now-parts)) 0 10))]
                      (println (canon r))
                      (if (= :ok (:status r)) 0 1)))
      "peer-repair" (if-not (and a b)
                      (usage)
                      (let [r (peer-repair a (peer-args (cons b more)) (subs (:iso (hio/now-parts)) 0 10))]
                        (println (canon r))
                        (if (= :ok (:status r)) 0 1)))
      "market-match" (if-not (and a b)
                       (usage)
                       (let [asks (mapv (fn [x] (if (map? x) (kw-keys x) x)) (or (read-edn-file a) []))
                             bids (mapv (fn [x] (if (map? x) (kw-keys x) x)) (or (read-edn-file b) []))
                             today (or (market-today more) (subs (:iso (hio/now-parts)) 0 10))
                             bad (vec (sort (map :node (filter #(not (market/valid-attestation? % today)) asks))))]
                         (if (seq bad)
                           (do (println (canon {:status :refused :reason "market/attestation-invalid" :nodes bad})) 1)
                           (let [secrets (when-let [p (market-flag more "--secrets")]
                                           (when-let [raw (read-edn-file p)] (str-keys raw)))
                                 r (market/match-signed asks bids secrets)]
                             (println (canon (if (= :refused (:status r)) r (assoc r :status :ok))))
                             (if (= :refused (:status r)) 1 0)))))
      "market-verify" (let [secret (market-flag (cons b more) "--suite-secret")]
                      (if-not (and a secret)
                        (usage)
                        (let [att (let [raw (read-edn-file a)] (if (map? raw) (kw-keys raw) raw))
                              today (or (market-today more) (subs (:iso (hio/now-parts)) 0 10))
                              r (market/verify-asymmetric att {(:issuer att) secret}
                                                          market/verify-hmac-sig today)]
                          (println (canon r))
                          (if (:valid r) 0 1))))
      "market-sign" (let [secret (market-flag (cons b more) "--issuer-secret")]
                      (if-not (and a secret)
                        (usage)
                        (let [att (let [raw (read-edn-file a)] (if (map? raw) (kw-keys raw) raw))
                              signed (market/sign-attestation att secret)]
                          (if (nil? signed)
                            (do (println (canon {:status :refused :reason "market/unsignable"})) 1)
                            (do (println (canon signed)) 0)))))
      "test" (if-not a
               (usage)
               (let [r (run-cases a)]
                 (doseq [l (:ids r)] (println l))
                 (println (canon (dissoc r :ids)))
                 (if (and (pos? (:cases r)) (= (:pass r) (:cases r))) 0 1)))
      (usage))))

(defn -main [& args]
  (hio/exit! (main* (vec args))))

#?(:lpy (when (= (str *main-ns*) "itonami.otehon.cli")
          (apply -main *command-line-args*)))
