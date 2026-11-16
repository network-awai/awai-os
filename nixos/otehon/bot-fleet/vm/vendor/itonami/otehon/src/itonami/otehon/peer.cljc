(ns itonami.otehon.peer
  "Permissioned node sync: registry, sync plans, apply records.

  Nodes are known identities with a storage prefix, never anonymous
  endpoints. A sync plan diffs two manifests (pure data) and lists the
  digests to fetch or send; the host copies object files and re-hashes
  on receipt. Nothing is read, written, or moved here.

  The messaging plane (ported from p2p.cljk) rides the same rule:
  crypto (keygen, sign, verify), the HTTP server, child processes and
  the wall clock stay host-side and enter through injected seams
  (`:sign`, `:verify`, `:fetch`, `:now-ms`, `:random-hex`, `:nonces`,
  `:exec-probe`). Envelope verdicts, trust checks, bundle and peer
  file writes, rail/path shaping and the service-record adapter are
  pure over those seams."
  (:require [clojure.string :as str]
            [itonami.otehon.bundle :as bundle]
            [itonami.otehon.cas :as cas]
            [itonami.otehon.ed25519 :as ed25519]
            [itonami.otehon.io :as hio]))

(defn register-node
  "Admit `node` with the storage `prefix` it may write."
  [registry node prefix]
  (assoc registry node {:prefix prefix}))

(defn grant-until
  "Bound a node's grant to `until` (YYYY-MM-DD, inclusive)."
  [registry node until]
  (assoc-in registry [node :until] until))

(defn node-prefix
  "The storage prefix `node` may write, nil when unknown."
  [registry node]
  (get-in registry [node :prefix]))

(defn member?
  "A registered node whose grant has not expired. `today` is YYYY-MM-DD;
  string compare is exact for this format. A nil :until never expires."
  [registry node today]
  (let [e (get registry node)]
    (boolean (and e
                  (:prefix e)
                  (or (nil? (:until e))
                      (not (pos? (compare today (:until e)))))))))

(defn sync-plan
  "Diff two manifests ({rel {:sha :size}}). Returns sorted :fetch (digests
  the remote side has and we lack, with sizes) and :send, plus the
  :same count. Deterministic: every list is sorted by digest."
  [local remote]
  (let [lm (into {} (map (fn [[_ {:keys [sha size]}]] [sha size]) local))
        rm (into {} (map (fn [[_ {:keys [sha size]}]] [sha size]) remote))
        lks (set (keys lm))
        rks (set (keys rm))
        fetch (sort (remove lks rks))
        send (sort (remove rks lks))]
    {:fetch (mapv (fn [s] {:sha s :size (get rm s)}) fetch)
     :send (mapv (fn [s] {:sha s :size (get lm s)}) send)
     :same (count (filter lks rks))}))

(defn fleet-copies
  "Union view of a fleet: `remotes` [{:peer :manifest}] in any order.
  Returns {:copies {sha {:peers [sorted] :count n}} :peers [sorted]
  :objects n}. Read-only planning input for replication and repair
  triage. Deterministic: everything sorted."
  [remotes]
  (let [by-sha (reduce (fn [acc {:keys [peer manifest]}]
                         (reduce (fn [a [_ {:keys [sha]}]]
                                   (update a sha (fnil conj #{}) peer))
                                 acc manifest))
                       {} remotes)
        copies (into {} (map (fn [[sha peers]]
                               [sha {:peers (vec (sort peers)) :count (count peers)}])
                             by-sha))]
    {:copies copies
     :peers (vec (sort (distinct (map :peer remotes))))
     :objects (count copies)}))

(defn replication-plan
  "Which digests fall below `desired` copies. `copies` is the :copies
  map from fleet-copies. Returns {:under [{:sha :have :want}] (sorted,
  have < desired) :healthy n}. Deterministic."
  [copies desired]
  (let [under (vec (sort-by :sha
                            (keep (fn [[sha {:keys [count]}]]
                                    (when (< count desired)
                                      {:sha sha :have count :want desired}))
                                  copies)))]
    {:under under :healthy (- (count copies) (count under))}))

(defn apply-record
  "Describe an applied copy for the journal: digest, direction, bytes."
  [sha direction size verified?]
  {:sha sha :direction direction :size size :verified (boolean verified?)})

(defn repair-plan
  "Which bad rels a list of peers can heal. `bad` is a verify-manifest
  result; `remotes` is [{:peer :manifest}] in try-order, one entry per
  admitted peer dir. Returns sorted :repair [{:rel :sha :size :from}]
  (copy each object from :from and re-hash on receipt) and sorted
  :unrepairable [rel] (no peer lists them, so the caller must refuse
  or escalate). The first peer listing a rel wins. Deterministic:
  rels are deduplicated and every list is sorted."
  [bad remotes]
  (let [rels (sort (distinct (concat (:mismatch bad []) (:missing bad []))))]
    (reduce (fn [acc rel]
              (if-let [hit (some (fn [{:keys [peer manifest]}]
                                   (when-let [{:keys [sha size]} (get manifest rel)]
                                     {:sha sha :size size :from peer}))
                                 remotes)]
                (update acc :repair conj (assoc hit :rel rel))
                (update acc :unrepairable conj rel)))
            {:repair [] :unrepairable []}
            rels)))

;; ---------------------------------------------------------------- messaging plane (p2p.cljk)

(def protocol "itonami-agent-p2p/1")

;; ---------------------------------------------------------------- did:key

(def ^:private b58
  "Bitcoin base58 alphabet, verbatim from p2p.cljk."
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

(defn- b58-index [c]
  (str/index-of b58 (str c)))

(defn unbase58btc
  "Base58btc text -> byte vector. The digit-array decode (no bigint
  interop), so every runner walks the same bytes."
  [s]
  (let [chars (vec (str s))
        zeros (count (take-while #(= "1" (str %)) chars))]
    (loop [rest-chars (drop zeros chars) out []]
      (if (empty? rest-chars)
        (vec (concat (repeat zeros 0) out))
        (let [carry (b58-index (first rest-chars))]
          (when (nil? carry)
            (throw (ex-info (str "bad base58 char: " (first rest-chars)) {})))
          (let [[new-out new-carry]
                (loop [i (dec (count out)) o out c carry]
                  (if (neg? i)
                    [o c]
                    (let [x (+ (* (nth o i) 58) c)]
                      (recur (dec i) (assoc o i (mod x 256)) (quot x 256)))))]
            (recur (rest rest-chars)
                   (if (pos? new-carry)
                     (vec (concat (loop [c new-carry acc []]
                                    (if (pos? c)
                                      (recur (quot c 256) (conj acc (mod c 256)))
                                      (reverse acc)))
                                  new-out))
                     new-out))))))))
(defn parse-did
  "The 32 raw key bytes for a did:key ed25519 id, or nil when the
  text is not one (bad prefix, bad alphabet, wrong length)."
  [did]
  (when-let [[_ z] (re-matches #"^did:key:z(.+)$" (str did))]
    (let [b (try (unbase58btc z) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))]
      (when (and (= 34 (count b)) (= 237 (nth b 0)) (= 1 (nth b 1)))
        (vec (subvec (vec b) 2))))))

(defn valid-did?
  "True when `did` parses as a did:key ed25519 id."
  [did]
  (boolean (parse-did did)))

(defn pub->did
  "The did:key id for 32 raw public-key bytes (a seq of numbers)."
  [raw]
  (str "did:key:z" (ed25519/base58btc (vec (concat [237 1] raw)))))

;; ---------------------------------------------------------------- envelopes

(defn sign-envelope
  "The signed envelope map for `payload-map`: the payload carries ts +
  nonce + protocol, `:sign` [payload-str] answers the base64 signature
  (host crypto). Time and randomness ride `opts` so cases pin them."
  ([node payload-map] (sign-envelope node payload-map {}))
  ([node payload-map {:keys [now-ms random-hex sign]}]
   (let [payload (hio/json-str (assoc payload-map
                                      "ts" ((or now-ms hio/now-ms))
                                      "nonce" ((or random-hex hio/random-hex) 12)
                                      "protocol" protocol))]
     {"payload" payload
      "did" (:did node)
      "sig" (sign payload)})))

(defn open-envelope
  "Verify an envelope. `:verify` [payload sig did] answers truthy for
  a good signature (host crypto); `:now-ms` and the `:nonces` atom
  (nonce -> seen-at ms) drive replay/staleness. Returns {:did
  :payload} or {:error reason}, verbatim reasons from the legacy."
  [{:strs [payload did sig]} {:keys [trusted verify now-ms nonces]}]
  (cond
    (not (valid-did? (str did))) {:error "bad did"}
    (not (try (boolean (verify (str payload) (str sig) (str did)))
              (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ false)))
    {:error "bad signature"}
    :else
    (let [pl (hio/parse-json (str payload))
          age (let [d (- ((or now-ms hio/now-ms)) (get pl "ts" 0))] (if (neg? d) (- d) d))]
      (cond
        (> age 120000) {:error "stale envelope"}
        (contains? @nonces (get pl "nonce")) {:error "replayed nonce"}
        (and trusted (not (contains? trusted did))) {:error (str "untrusted peer " did)}
        :else
        (do
          (swap! nonces
                 (fn [m]
                   (let [nw ((or now-ms hio/now-ms))]
                     (into {} (filter (fn [e] (> (+ (val e) 300000) nw))
                                      (assoc m (get pl "nonce") nw))))))
          {:did did :payload pl})))))

(defn- url-encode [s]
  #?(:lpy (let [u (python/__import__ "urllib.parse" ** :fromlist ["quote"])] (.quote u (str s) ** :safe ""))
     :clj (str/replace (java.net.URLEncoder/encode (str s) "UTF-8") "+" "%20")
     :cljs (js/encodeURIComponent (str s))))

(defn auth-header
  "The X-Itonami-Envelope header for a request envelope (signing rides
  `opts`, as in sign-envelope)."
  [node payload-map opts]
  {"X-Itonami-Envelope" (url-encode (hio/json-str (sign-envelope node payload-map opts)))})

;; ---------------------------------------------------------------- peers.edn

(defn peers-file
  "The peers file under `dir` (the node home in production)."
  [dir]
  (str dir "/peers.edn"))

(defn read-peers
  "The trust map under `dir`, defaulting to empty trust."
  [dir]
  (let [f (peers-file dir)]
    (merge {:trusted #{} :peers []}
           (when (hio/file? f) (hio/parse-edn (hio/slurp-utf8 f))))))

(defn write-peers!
  "Persist the trust map (sorted EDN with the legacy header comment).
  Answers the normalized map."
  [dir m]
  (let [norm (-> m (update :trusted set) (update :peers #(vec (distinct %))))
        text (str ";; itonami-agent peers. These may fetch bundles and run turns here.\n"
                  ";; :trusted is a set of DIDs. :peers is a vector of {:url ... :did ...} entries.\n"
                  (bundle/sorted-edn norm) "\n")]
    (hio/mkdirs! (hio/dirname (peers-file dir)))
    (hio/write-text! (peers-file dir) text)
    norm))

(defn add-peer!
  "Record a peer (and trust its did when asked). Answers the
  normalized trust map."
  [dir {:keys [url did trust?]}]
  (let [m (read-peers dir)]
    (write-peers! dir (cond-> m
                        url (update :peers conj (cond-> {:url url} did (assoc :did did)))
                        (and did trust?) (update :trusted conj did)))))

;; ---------------------------------------------------------------- rails and paths

(defn ensure-rail
  "A turn run for a peer appends the requester's :inference-rail to
  the profile config when the profile does not already name it:
  murakumo (the operator rail) or itonami-p2p (this node's own rails,
  then its trusted peers'). Verbatim from p2p.cljk."
  [config rail]
  (let [has? (fn [c r] (or (= r (get-in c ["model" "provider"]))
                           (some #(= r (get % "provider")) (get c "fallback_providers"))))
        add (fn [c r m] (if (has? c r) c (update c "fallback_providers" (fnil conj []) {"provider" r "model" m})))]
    (cond-> config
      rail (add rail (if (= rail "murakumo") "murakumo/free" "auto")))))

(defn rebase-paths
  "Rewrite requester-home paths into the run's own copy:
  <origin-home>/workspace -> the run workspace (whose files travel
  back), <origin-home> -> the materialized bundle home, plus the
  ~/.itonami and ~/.hermes profile-home spellings. Verbatim."
  [text {:keys [origin-home profile ws home]}]
  (if (or (nil? text) (nil? origin-home))
    text
    (let [tildes [(str "~/.itonami/profiles/" profile) (str "~/.hermes/profiles/" profile)]]
      (reduce (fn [t [from to]] (str/replace t from to))
              (str text)
              (concat [[(str origin-home "/workspace") ws] [origin-home home]]
                      (for [td tildes] [(str td "/workspace") ws])
                      (for [td tildes] [td home]))))))

;; ---------------------------------------------------------------- bundles

(defn materialize-bundle!
  "Write files under <dir>/peer-runs/<cid>/home and answer that home.
  A present .complete marker means a previous materialization won;
  `..` and absolute rels are refused, verbatim from the legacy."
  [dir cid files]
  (let [home (str dir "/peer-runs/" cid "/home")]
    (when-not (hio/file? (str home "/.complete"))
      (hio/remove-dir! home)
      (doseq [[rel content] files]
        (when (or (str/includes? (str rel) "..") (str/starts-with? (str rel) "/"))
          (throw (ex-info (str "unsafe path in bundle: " rel) {})))
        (let [p (str home "/" rel)]
          (hio/mkdirs! (hio/dirname p))
          (hio/write-text! p (str content))))
      (hio/write-text! (str home "/.complete") (str cid)))
    home))

(defn fetch-bundle
  "Pull a bundle by CID from origin-url and verify it. `:fetch`
  answers response maps; `:sign` builds the request envelope (both
  injected). Resolves to the files map; throws verbatim legacy
  errors."
  [node origin-url cid {:keys [fetch sign]}]
  (let [r (fetch (str origin-url "/itonami/v1/bundle/" cid)
                 {:method "GET" :headers (auth-header node {"get" cid} {:sign sign}) :body nil})]
    (cond
      (not= 200 (:status r))
      (throw (ex-info (str "bundle fetch " (:status r) ": " (subs (str (:text r)) 0 (min 200 (count (str (:text r)))))) {}))
      (not (= cid (bundle/bundle-cid (get-in r [:body "files"]))))
      (throw (ex-info (str "bundle " cid " failed hash verification") {}))
      :else (get-in r [:body "files"]))))

;; ---------------------------------------------------------------- service records (ADR-0145)

(def service-record-keys
  "The netmap :service projection this adapter consumes (dependency-free
  local copy of kekkai.service-record's shape contract: required keys,
  non-empty digest and model id, positive epoch)."
  [:service/did :service/multiaddr :service/engine :service/model-id
   :service/digest :service/epoch])

(defn- service-record? [rec]
  (and (map? rec)
       (every? #(contains? rec %) service-record-keys)
       (string? (:service/did rec)) (seq (:service/did rec))
       (string? (:service/model-id rec)) (seq (:service/model-id rec))
       (string? (:service/digest rec)) (seq (:service/digest rec))
       (integer? (:service/epoch rec)) (pos? (:service/epoch rec))))

(defn service-records->peer-infos
  "kekkai :netmap/services entries -> peer-info fragments (`:did` for
  the trust check, `:models` for the lend check, `:load` for the
  least-loaded sort). Invalid records are dropped, not repaired;
  same-did records merge their model lists. Deterministic."
  [services]
  (->> services
       (filter service-record?)
       (group-by :service/did)
       (sort-by key)
       (mapv (fn [[did recs]]
               {:did did
                :models (->> recs (map :service/model-id) distinct sort vec)
                :load 0}))))

(defn overlay-service-records
  "Merge kekkai service records into discovered peer infos: a record is
  the offer of record for its did (live discovery says who is up and
  how loaded, records say what they offer). Dids with no records keep
  their infos; unreachable dids are never added. Deterministic."
  [infos services]
  (let [by-did (group-by :service/did (filter service-record? services))]
    (mapv (fn [i]
            (if-let [recs (get by-did (:did i))]
              (assoc i :models (->> recs (map :service/model-id) distinct sort vec))
              i))
          (vec infos))))

;; ---------------------------------------------------------------- http mapping

(defn http-json
  "The fetch response mapping: {:status :body (parsed or nil) :text}.
  `:fetch` [url opts] answers {:status n :body-text s} (or throws,
  which callers map). `:timeout-s` rides the call shape for parity
  with the legacy but no timers run in .cljc."
  [fetch url {:keys [method body headers timeout-s]}]
  (let [res (fetch (str url) {:method (or method "GET")
                              :headers (merge {"Content-Type" "application/json"} headers)
                              :body body :timeout-s timeout-s})]
    {:status (:status res)
     :text (str (:body-text res))
     :body (try (hio/parse-json (str (:body-text res)))
                (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))}))

;; ---------------------------------------------------------------- discover / pick / infer (S5d unit 2)

(defn- url-decode [s]
  #?(:lpy (let [u (python/__import__ "urllib.parse" ** :fromlist ["unquote"])] (.unquote u (str s)))
     :clj (java.net.URLDecoder/decode (str s) "UTF-8")
     :cljs (js/decodeURIComponent (str s))))

(defn header-envelope
  "The envelope carried by an X-Itonami-Envelope header value (URL-decoded
  JSON), or nil when absent/unparsable. The host extracts the header;
  this maps it. Verbatim from p2p.cljk."
  [v]
  (when v
    (try (hio/parse-json (url-decode v))
         (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))))

(defn- with-nonces [opts]
  (assoc opts :nonces (or (:nonces opts) (atom {}))))

(defn normalize-peer-info
  "A verified /peer payload plus :url/:did in the keyword shape the
  pick/infer selectors read (`:load` `:max-runs` `:models`
  `:agent-models` `:profiles` `:peers`; `:error` when unreachable).
  The wire JSON is untouched; only this internal shape is normalized
  (the legacy reads mixed string keys here)."
  [payload url did]
  (let [kw (into {} (map (fn [[k v]] [(keyword k) v]) payload))]
    (-> kw
        (assoc :url url :did did)
        (update :profiles (fn [ps] (mapv (fn [p] (into {} (map (fn [[k v]] [(keyword k) v]) p))) (or ps []))))
        (update :peers (fn [ps] (vec (or ps []))))
        (as-> m (if (contains? m :max_runs) (-> m (assoc :max-runs (:max_runs m)) (dissoc :max_runs)) m))
        (as-> m (if (contains? m :agent_models) (-> m (assoc :agent-models (:agent_models m)) (dissoc :agent_models)) m))
        (as-> m (if (contains? m :murakumo_did) (-> m (assoc :murakumo-did (:murakumo_did m)) (dissoc :murakumo_did)) m)))))

(defn peer-info
  "GET /peer from url; verifies the envelope (signature only, trust is
  the caller's job). Answers the normalized info or {:url :error}.
  `:fetch` `:verify` `:now-ms` ride `opts`. Verbatim reasons."
  [url opts]
  (try
    (let [{:keys [status body]} (http-json (:fetch opts) (str url "/itonami/v1/peer") {:timeout-s 10})]
      (if (= 200 status)
        (let [env (open-envelope body (assoc (with-nonces opts) :trusted nil))]
          (if (:error env)
            {:url url :error (:error env)}
            (normalize-peer-info (:payload env) url (:did env))))
        {:url url :error (str "http " status)}))
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
      {:url url :error (ex-message e)})))

(defn discover
  "Known peers plus one gossip hop. Answers peer-info maps (reachable
  or not), first hop in peers.edn order then the gossip hop.
  Verbatim from p2p.cljk."
  [dir opts]
  (let [o (with-nonces opts)
        peers (:peers (read-peers dir))
        first-hop (mapv #(peer-info (:url %) o) peers)
        known (set (map :url peers))
        more (vec (distinct (remove known (mapcat :peers first-hop))))
        second-hop (mapv #(peer-info % o) more)]
    (vec (concat first-hop second-hop))))

(defn pick-peer
  "Trusted, reachable, not full, not me; prefer a peer that already
  holds cid, then lowest load. Pure over the trust set and own did."
  [infos trusted me-did cid]
  (->> infos
       (filter #(and (not (:error %)) (contains? trusted (:did %)) (not= me-did (:did %))
                     (< (or (:load %) 0) (or (:max-runs %) 1))))
       (sort-by (fn [i] [(if (some (fn [p] (= cid (:cid p))) (:profiles i)) 0 1) (or (:load i) 0)]))
       first))

(defn infer-peers
  "Trusted, reachable peers that lend a model for this request, least
  loaded first. Pure over the trust set and own did."
  [infos trusted me-did model]
  (let [auto? (or (str/blank? (str model)) (= model "auto"))]
    (->> infos
         (filter #(and (not (:error %)) (contains? trusted (:did %)) (not= me-did (:did %))
                       (if auto? (seq (:agent-models %)) (some #{model} (:models %)))))
         (sort-by #(or (:load %) 0)))))

(defn infer-via-peers
  "Ask trusted peers to answer body from THEIR own rails. Answers
  {:status :text :peer} of the first that answered, or the last
  failure. `:fetch` `:sign` `:verify` `:now-ms` ride `opts`."
  [node body infos trusted opts]
  (let [o (with-nonces opts)]
    (loop [[peer & more] (infer-peers infos trusted (:did node) (get body "model"))
           last-err {:status 503 :text (hio/json-str {"error" "no trusted peer lends this model"})}]
      (if (nil? peer)
        last-err
        (let [r (try (http-json (:fetch o) (str (:url peer) "/itonami/v1/infer")
                               {:method "POST" :timeout-s 900
                                :body (hio/json-str (sign-envelope node {"body" body} o))})
                     (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                       {:status 0 :text (ex-message e)}))
              env (when (= 200 (:status r))
                    (open-envelope (:body r) (assoc o :trusted #{(:did peer)})))
              resp (get-in env [:payload "response"])]
          (if (and resp (not (:error env)))
            {:status 200 :text resp :peer (:did peer) :rail (get-in env [:payload "rail"])}
            (recur more (assoc r :peer (:did peer)))))))))

;; ---------------------------------------------------------------- remote run (S5d unit 2)

(defn remote-run
  "Ask peer (an info map) to run prompt for local profile prof.
  Answers a loop-result-shaped map with :peer and :receipt; workspace
  writes are applied under (:home prof). The bundle files+cid ride
  `ctx` (computed by bundle.cljc, covered there); `:fetch` `:sign`
  `:verify` `:now-ms` `:sleep` (seconds) ride `ctx`. Guards verbatim."
  [prof prompt opts peer origin-url ctx]
  (let [c (with-nonces ctx)
        node (:node c)
        home (:home prof)
        files (:files c)
        cid (:cid c)]
    (let [sub (http-json (:fetch c) (str (:url peer) "/itonami/v1/run")
                         {:method "POST" :timeout-s 60
                          :body (hio/json-str (sign-envelope node {"profile" (:name prof) "cid" cid "origin" origin-url
                                                                 "origin_home" home
                                                                 "prompt" prompt
                                                                 "opts" {"toolsets" (:toolsets opts) "model" (:model opts)
                                                                         "provider" (:provider opts) "pinned" (:pinned? opts)
                                                                         "platform" (:platform opts)
                                                                         "inference_rail" (get-in prof [:itonami :placement :inference-rail])
                                                                         "files" (when-not origin-url files)}} c))})
          run-id (get-in (open-envelope (:body sub) (assoc c :trusted #{(:did peer)})) [:payload "run_id"])
          deadline (+ ((:now-ms c)) (* 1000 (+ 300 (or (get-in prof [:config "agent" "run_budget_seconds"]) 900))))
          r (if-not (and (= 202 (:status sub)) run-id)
              sub
              (loop []
                ((:sleep c) 3)
                (let [pr (try (http-json (:fetch c) (str (:url peer) "/itonami/v1/run/" run-id)
                                        {:headers (auth-header node {"poll" run-id} c) :timeout-s 30})
                              (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                                {:status 0 :text (ex-message e)}))]
                  (cond
                    (= 200 (:status pr)) pr
                    (> ((:now-ms c)) deadline) {:status 504 :text "peer run exceeded deadline"}
                    (contains? #{202 0} (:status pr)) (recur)
                    :else pr))))]
      (if (not= 200 (:status r))
        {:final nil :exit-reason "peer_error"
         :error {:error (str (:url peer) " -> " (:status r) " " (get-in r [:body "error"] (:text r)))}
         :peer (:did peer) :turns 0 :attempts []}
        (let [env (open-envelope (:body r) (assoc c :trusted #{(:did peer)}))
              pl (:payload env)]
          (cond
            (:error env) {:final nil :exit-reason "peer_error"
                          :error {:error (str "result envelope: " (:error env))} :peer (:did peer) :turns 0 :attempts []}
            (not= cid (get pl "cid")) {:final nil :exit-reason "peer_error"
                                       :error {:error "peer ran a different bundle"} :peer (:did peer) :turns 0 :attempts []}
            :else
            (do (hio/mkdirs! (str home "/workspace"))
                (doseq [[rel content] (get pl "writes")]
                  (when (and (str/starts-with? (str rel) "workspace/") (not (str/includes? (str rel) "..")))
                    (hio/write-text! (str home "/" rel) (str content))))
                {:final (get pl "final") :exit-reason (get pl "exit_reason") :turns (get pl "turns")
                 :usage (get pl "usage") :provider (get pl "provider") :model (get pl "model")
                 :attempts (mapv #(into {} (map (fn [[k v]] [(keyword k) v]) %)) (get pl "attempts"))
                 :error (when (get pl "error") {:error (get pl "error")})
                 ;; sorted: parsed-JSON key order differs per runner, so the
                 ;; legacy document order cannot be reproduced portably.
                 :writes (mapv #(str home "/" %) (sort (keys (get pl "writes"))))
                 :peer (:did env)
                 :receipt {"run_id" (get pl "run_id") "peer" (:did env) "cid" cid
                           "result_sha256" (get pl "result_sha256") "sig" (get-in r [:body "sig"])}})))))))

;; ---------------------------------------------------------------- serve routes (S5d unit 2)

(defn peer-route
  "The signed /itonami/v1/peer info body. Every value rides `ctx`
  (the host reads rails/profiles/health); this shapes + signs."
  [ctx]
  (let [node (:node ctx)]
    (sign-envelope node {"did" (:did node) "url" (:public-url ctx)
                         "murakumo_did" (:murakumo-did ctx)
                         "load" @(:active-runs ctx) "max_runs" (:max-runs ctx)
                         "rails" (:rails ctx)
                         "models" (:models ctx)
                         "agent_models" (:agent-models ctx)
                         "health" (:health ctx)
                         "profiles" (:profiles ctx)
                         "peers" (:peer-urls ctx)}
                     ctx)))

(defn models-route
  "The loopback /v1/models list: own models plus models trusted peers
  lend, \"auto\" first. Non-loopback callers get 403."
  [loopback? infos trusted own-models]
  (if-not loopback?
    {:status 403 :body {"error" "loopback only"}}
    (let [lent (mapcat :models (filter #(contains? trusted (:did %)) infos))]
      {:status 200 :body {"object" "list"
                          "data" (vec (for [m (distinct (concat ["auto"] own-models lent))]
                                        {"id" m "object" "model" "owned_by" "itonami-p2p"}))}})))

(defn local-gateway-complete
  "The endpoint a node offers ITSELF on loopback: own rails first,
  then trusted peers' rails. `:complete` [body] answers the own-rails
  result (host rails); the peer fallback rides `infos`/`trusted`."
  [node body ctx]
  (let [own ((:complete ctx) body)]
    (if (<= 200 (:status own) 299)
      (assoc own :route (str "self:" (:rail own)))
      (let [via (infer-via-peers node body (:infos ctx) (:trusted ctx) ctx)]
        (if (= 200 (:status via))
          (assoc via :route (str "peer:" (:peer via) ":" (:rail via)))
          via)))))

(defn chat-route
  "Loopback POST /v1/chat/completions. Answers {:status :headers :text}
  (the completion text travels as-is); non-loopback callers get 403."
  [loopback? node body ctx]
  (if-not loopback?
    {:status 403 :body {"error" "loopback only; peers use /itonami/v1/infer"}}
    (let [r (local-gateway-complete node body ctx)]
      {:status (if (pos? (or (:status r) 0)) (:status r) 502)
       :headers {"X-Itonami-Route" (str (:route r))}
       :text (:text r)})))

(defn infer-route
  "POST /itonami/v1/infer: a trusted peer lends inference from this
  node's own rails (never onward). `:complete` [body] is the host
  rails call."
  [body trust node ctx]
  (let [env (open-envelope body (assoc (with-nonces ctx) :trusted (:trusted trust)))]
    (if (:error env)
      {:status 403 :body {"error" (:error env)}}
      (let [r ((:complete ctx) (get-in env [:payload "body"]))]
        (if (<= 200 (:status r) 299)
          {:status 200 :body (sign-envelope node {"response" (:text r) "rail" (:rail r)} ctx)}
          {:status 502 :body {"error" (str "own rails failed: " (:status r))}})))))

(defn bundle-route
  "GET /itonami/v1/bundle/:cid. `:bundles` maps cid -> {\"files\" ...}
  (the host's local-bundle lookup)."
  [cid header-value trust ctx]
  (let [env (open-envelope (header-envelope header-value) (assoc (with-nonces ctx) :trusted (:trusted trust)))]
    (cond
      (:error env) {:status 403 :body {"error" (:error env)}}
      (not= cid (get-in env [:payload "get"])) {:status 403 :body {"error" "envelope names another cid"}}
      :else (if-let [b (get (:bundles ctx) cid)]
              {:status 200 :body {"cid" cid "files" (get b "files")}}
              {:status 404 :body {"error" "no such bundle here"}}))))

(defn run-accept-route
  "POST /itonami/v1/run: verify, check capacity, accept with 202.
  Runs live in the `:runs` atom; execution itself stays host-side."
  [body trust node ctx]
  (let [c (with-nonces ctx)
        env (open-envelope body (assoc c :trusted (:trusted trust)))
        max-runs (or (:max-runs c) 2)
        active (:active-runs c)
        runs (:runs c)]
    (cond
      (:error env) {:status 403 :body {"error" (:error env)}}
      (>= @active max-runs) {:status 429 :body {"error" "busy" "load" @active "max_runs" max-runs}}
      :else
      (let [rh ((:random-hex c) 8)
            run-id (subs (str rh) 0 (min 8 (count (str rh))))]
        (swap! active inc)
        (swap! runs assoc run-id {:status "running" :requester (:did env) :started ((:now-ms c))})
        {:status 202 :body (sign-envelope node {"run_id" run-id "status" "running"} c)}))))

(defn run-poll-route
  "GET /itonami/v1/run/:id: the requester polls its run. Terminal
  reads dissoc the run."
  [run-id header-value trust ctx]
  (let [c (with-nonces ctx)
        env (open-envelope (header-envelope header-value) (assoc c :trusted (:trusted trust)))
        r (get @(:runs c) run-id)]
    (cond
      (:error env) {:status 403 :body {"error" (:error env)}}
      (not= run-id (get-in env [:payload "poll"])) {:status 403 :body {"error" "envelope names another run"}}
      (nil? r) {:status 404 :body {"error" "no such run"}}
      (not= (:requester r) (:did env)) {:status 403 :body {"error" "not your run"}}
      (= "running" (:status r)) {:status 202 :body {"run_id" run-id "status" "running"}}
      (= "failed" (:status r)) (do (swap! (:runs c) dissoc run-id) {:status 500 :body {"error" (:error r)}})
      :else (do (swap! (:runs c) dissoc run-id) {:status 200 :body (:envelope r)}))))

(defn serve-route
  "One peer-server route decision: [method path] + parsed body +
  headers -> {:status ...} response value. The socket, body reading
  and JSON printing stay host-side. Verbatim reasons + shapes."
  [method url body headers ctx]
  (let [trust (:trust ctx)]
    (cond
      (and (= method "GET") (= url "/itonami/v1/peer"))
      {:status 200 :body (peer-route ctx)}

      (and (= method "GET") (= url "/v1/models"))
      (models-route (:loopback? ctx) (:infos ctx) (:trusted trust) (:own-models ctx))

      (and (= method "POST") (= url "/v1/chat/completions"))
      (chat-route (:loopback? ctx) (:node ctx) body ctx)

      (and (= method "POST") (= url "/itonami/v1/infer"))
      (infer-route body trust (:node ctx) ctx)

      (and (= method "GET") (str/starts-with? (str url) "/itonami/v1/bundle/"))
      (bundle-route (subs (str url) (count "/itonami/v1/bundle/")) (get headers "x-itonami-envelope") trust ctx)

      (and (= method "POST") (= url "/itonami/v1/run"))
      (run-accept-route body trust (:node ctx) ctx)

      (and (= method "GET") (str/starts-with? (str url) "/itonami/v1/run/"))
      (run-poll-route (subs (str url) (count "/itonami/v1/run/")) (get headers "x-itonami-envelope") trust ctx)

      :else {:status 404 :body {"error" "not found" "protocol" protocol}})))

;; ---------------------------------------------------------------- placement (S5d unit 2)

(defn placement
  "Follow the profile :placement order (e.g. [:peer :local]): try a
  trusted peer, fall back to local. `:run-local` [prof prompt opts]
  is the host agent loop; the :peer step rides discover/pick/
  remote-run over `ctx`. The result carries :placement, the trail of
  every step tried. Verbatim from p2p.cljk."
  [prof prompt opts cfg ctx]
  (let [c (with-nonces ctx)
        order (if (:force-peer? cfg) [:peer] (get-in prof [:itonami :placement :order] [:local]))
        cid (get-in prof [:itonami :bundle :cid])
        step-rec (fn [step r] (cond-> {"step" (name step) "exit_reason" (:exit-reason r)}
                               (:peer r) (assoc "peer" (:peer r))
                               (get-in r [:error :error])
                               (assoc "error" (subs (str (get-in r [:error :error])) 0 (min 200 (count (str (get-in r [:error :error]))))))))]
    (loop [[step & more] order last-r nil trail []]
      (cond
        (nil? step) (assoc (or last-r {:final nil :exit-reason "no_placement"
                                       :error {:error "no placement step could run the turn"} :turns 0 :attempts []})
                           :placement trail)

        (= step :local)
        (let [r ((:run-local c) prof prompt opts)
              trail (conj trail (step-rec :local r))]
          (if (and (= "provider_error" (:exit-reason r)) (seq more))
            (recur more r trail)
            (assoc r :placement trail)))

        (= step :peer)
        (let [infos (discover (:dir c) c)
              peer (pick-peer infos (:trusted (:trust c)) (:did (:node c)) cid)]
          (if-not peer
            (recur more (or last-r {:final nil :exit-reason "no_peer"
                                    :error {:error "no trusted peer available"} :turns 0 :attempts []})
                   (conj trail {"step" "peer" "exit_reason" "no_peer"}))
            (let [r (remote-run prof prompt opts peer (:origin-url cfg) c)
                  trail (conj trail (step-rec :peer r))]
              (if (and (#{"peer_error" "provider_error"} (:exit-reason r)) (seq more))
                (recur more r trail)
                (assoc r :placement trail)))))

        :else (recur more last-r trail)))))
