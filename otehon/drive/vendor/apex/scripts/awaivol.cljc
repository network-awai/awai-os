(ns awaivol
  "Bounded Linux Otehon volume. Run the Nix-built awai-otehon-volume launcher
  to hold a process-scoped OS flock. Immutable indexless CARv2 Packs precede
  checksum-bound WAL/checkpoints and atomic A/B roots. JSON management hashes
  are internal references, not a new canonical CID format. Legacy volumes,
  mount supervision and launchd installation require separate migration work.
  See oracle/awai-fs-format/v1/VOLUME.md for the qualified scope."
  (:require [clojure.string :as str]
            [awai.fs.large-file :as lf]
            [awai.fs.tier :as tr]
            [awai.fs.hot-cache :as hc]
            [awai.fs.fetch :as ft]
            [awai.fs.b2 :as bw]
            [awai.fs.remote :as rm]
            [awai.fs.car :as car]
            [awai.fs.block-profile :as bp]
            [awai.fs.chunk-profile :as cp]
            [awai.fs.node-store :as nsio]
            [awai.fs.relations :as rel]))

(def fs (js/require "fs"))
(def node-http (js/require "http"))
(def crypto (js/require "crypto"))

(def default-leaf-size (* 1024 1024))
(def default-pack-target (* 128 1024 1024))
(def default-cache-size (* 64 1024 1024))
(def max-put-bytes (* 8 1024 1024))
(def server-header "awai-vol/0.1")

(defn- pjoin [& parts]
  (apply str (interpose "/" parts)))

;; Forward references for verified Pack loading and checkpoint publication.
(declare delete-file-state validate-volume! pack-path load-pack-leaves ensure-local-pack)

(defn- ensure-dir [d]
  (.mkdirSync fs d #js {:recursive true}))

(defn- sha-hex [buf]
  (let [h (.createHash crypto "sha256")]
    (.update h buf)
    (.digest h "hex")))

(defn- buf->vec [buf]
  (vec (js/Array.from buf)))

(defn- sha256-bytes
  "sha2-256 digest of `v` (Node Buffer or byte-vec) as an unsigned
  32-byte vec. Accepts vecs because car/assemble-pack hashes body vecs."
  [v]
  (let [buf (if (js/Buffer.isBuffer v) v (js/Buffer.from (clj->js (vec v))))]
    (mapv #(bit-and % 0xff) (vec (.digest (.update (.createHash crypto "sha256") buf))))))

(defn- vec->buf [v]
  (js/Buffer.from (clj->js v)))

(defn- kw-keys [m]
  (into {} (map (fn [[k v]] [(keyword k) v]) m)))

(defn- load-file-record [fm-raw]
  (let [fm (kw-keys fm-raw)]
    (-> fm
        (update :chunk-profile #(when % (-> % kw-keys (update :kind keyword))))
        (update :entries (fn [es] (mapv kw-keys es)))
        (update :packs (fn [ps] (mapv kw-keys ps)))
        (update :meta rel/normalize-meta)
        (update :acl rel/normalize-acl))))

(defn- load-volume
  ([root] (load-volume root nil))
  ([root remote]
  (nsio/real-root! (pjoin root "packs"))
  (let [{raw :manifest generation :generation degraded? :degraded?} (nsio/read-state root)]
    (when degraded? (throw (ex-info "damaged root slot; explicit recovery review required" {:type :awai.fs/degraded-store})))
    (when-not (and (= "awai.otehon.catalog.v1" (get raw "format"))
                   (= #{"format" "default-chunk-profile" "files" "packs" "nextPack" "chunk-index"} (set (keys raw))))
      (throw (ex-info "unsupported catalog version" {:type :awai.fs/unsupported-catalog})))
    (let [logical (-> (get raw "default-chunk-profile") kw-keys (update :kind keyword))
          _ (cp/admit! logical)
          manifest {:format "awai.otehon.catalog.v1" :default-chunk-profile logical
                    :files (into {} (map (fn [[name fm]] [(str name) (load-file-record fm)])) (get raw "files"))
                    :packs (mapv kw-keys (get raw "packs"))
                    :nextPack (get raw "nextPack")
                    :chunk-index (into {} (map (fn [[sha v]] [sha (kw-keys v)])) (get raw "chunk-index"))}
          vol {:root root :manifest manifest :basis generation :degraded? degraded? :remote remote
               :files (into {} (map (fn [[name fm]] [name {:manifest fm :index (lf/offset-index fm)
                                                         :cache (hc/make-cache default-cache-size)}])) (:files manifest))
               :journal #{} :stats (atom {:range-reads 0 :bytes-read 0 :cache-hits 0})}
          ;; Orphans are retained, and their physical indexes are never reused.
          disk-indexes (when (.existsSync fs (pjoin root "packs"))
                         (keep #(some-> (re-matches #"pack-([0-9]+)\.car" %) second (js/parseInt 10))
                               (.readdirSync fs (pjoin root "packs"))))
          next-id (max (:nextPack manifest) (inc (reduce max -1 disk-indexes)))]
      (when-not (and (every? js/Number.isSafeInteger disk-indexes) (js/Number.isSafeInteger next-id))
        (throw (ex-info "physical Pack identifier exceeds bound" {:type :awai.fs/invalid-catalog})))
      (validate-volume! vol)
      (assoc-in vol [:manifest :nextPack] next-id)))))

(defn- save-volume [{:keys [root manifest basis degraded?] :as vol}]
  (when degraded? (throw (ex-info "damaged root slot; writes require review" {:type :awai.fs/degraded-store})))
  (validate-volume! vol)
  (assoc vol :basis (nsio/commit! root manifest {:op "checkpoint"} basis)))

(defn- journal-truncate! [_root]
  ;; Legacy journals are evidence. V1 commits immutable WAL/checkpoints instead.
  nil)

(defn- mark-dirty! [state root entry]
  (try
    (let [vol (:vol @state)]
      (validate-volume! vol)
      (let [generation (nsio/commit! root (:manifest vol) entry (:basis vol))]
        (swap! state assoc-in [:vol :basis] generation)
        (swap! state assoc :dirty 0)))
    (catch :default e
      ;; The caller may already have staged its in-memory change. Poison that
      ;; state until restart so no uncommitted value can be read or acknowledged.
      (swap! state assoc :failed? true)
      (throw e))))

(defn- flush-state! [state _root]
  (when (:failed? @state) (throw (ex-info "volume requires restart" {:type :awai.fs/failed-store}))))

(defn- pack-path [root pack-index]
  (pjoin root "packs" (str "pack-" pack-index ".car")))

(defn- pack-idx-path [root pack-index]
  (pjoin root "packs" (str "pack-" pack-index ".idx")))

(defn- load-pack-info [root idx]
  (let [f (pack-path root idx)]
    (nsio/regular! f)
    (when-not (.existsSync fs f) (throw (ex-info "committed Pack missing" {:type :awai.fs/missing-pack})))
    (when (> (.-size (.statSync fs f)) bp/max-pack-bytes)
      (throw (ex-info "Pack exceeds supported bound" {:type :awai.fs/pack-too-large})))
    ;; Sidecars are derived cache data, never authority. Same-size replacement
    ;; must not reuse a cached layout; verify the current immutable bytes.
    (let [buf (.readFileSync fs f)]
      (assoc (bp/verify-pack bp/profile (buf->vec buf) sha256-bytes) :buffer buf))))

(defn- load-pack-leaves [root idx] (:leaves (load-pack-info root idx)))

(defn- valid-name! [fname]
  (when-not (and (string? fname) (<= 1 (count fname) 1024)
                 (not (re-find #"[\\\u0000-\u001f\u007f]" fname))
                 (not-any? #{"" "." ".."} (str/split fname #"/" -1))
                 (not (str/starts-with? fname "__")))
    (throw (ex-info "invalid logical file name" {:type :awai.fs/invalid-name})))
  fname)

(defn- validate-volume! [vol]
  (let [manifest (:manifest vol) root (:root vol) files (:files manifest) packs (:packs manifest)
        by-id (into {} (map (juxt :pack-index identity)) packs)
        logical-bytes (reduce + 0 (map :file-size (vals files)))]
    (when-not (and (map? files) (<= (count files) 1024) (vector? packs) (<= (count packs) 1024)
                   (= (count packs) (count by-id)) (js/Number.isSafeInteger (:nextPack manifest))
                   (<= (inc (reduce max -1 (keys by-id))) (:nextPack manifest)) (<= logical-bytes (* 64 1024 1024))
                   (<= (reduce + 0 (map :bytes packs)) (* 64 1024 1024)))
      (throw (ex-info "catalog exceeds supported shape/resource bounds" {:type :awai.fs/invalid-catalog})))
    ;; Validate all names/profiles/references before any restore I/O.
    (doseq [[name fm] files]
      (valid-name! name) (cp/from-manifest fm)
      (when-not (and (:chunk-profile fm) (js/Number.isSafeInteger (:file-size fm)) (<= 0 (:file-size fm) max-put-bytes)
                     (= (:chunk-count fm) (count (:entries fm)))
                     (= (:pack-count fm) (count (:packs fm)))
                     (= (set (map :pack (:entries fm))) (set (map :pack-index (:packs fm))))
                     (<= (count (:entries fm)) bp/max-leaves)
                     (= (:file-size fm) (reduce + 0 (map :length (:entries fm)))))
        (throw (ex-info "file extent differs from chunk profile" {:type :awai.fs/invalid-file})))
      (loop [entries (:entries fm) offset 0 index 0]
        (when-let [e (first entries)]
          (when-not (and (= index (:index e)) (= offset (:offset e))
                         (js/Number.isSafeInteger (:length e)) (<= 1 (:length e) (:leaf-size fm))
                         (nsio/digest? (:sha e)) (contains? by-id (:pack e))
                         (js/Number.isSafeInteger (:pack-offset e)) (<= 0 (:pack-offset e)))
            (throw (ex-info "invalid logical chunk or physical reference" {:type :awai.fs/invalid-file})))
          (recur (rest entries) (+ offset (:length e)) (inc index)))))
    (doseq [p packs]
      (when-not (and (js/Number.isSafeInteger (:pack-index p)) (<= 0 (:pack-index p))
                     (= "carv2-indexless-v1" (:format p)) (nsio/digest? (:sha p))
                     (js/Number.isSafeInteger (:bytes p)) (<= 51 (:bytes p) bp/max-pack-bytes)
                     (string? (:root-cid p)) (= car/codec-dag-cbor (:codec (car/parse-cid-str (:root-cid p)))))
        (throw (ex-info "unsupported Pack catalog entry" {:type :awai.fs/invalid-pack}))))
    (let [layouts (into {}
                   (map (fn [p]
                          (let [idx (:pack-index p) f (pack-path root idx)]
                            (when-not (.existsSync fs f)
                              (if-let [remote (:remote vol)]
                                (ensure-local-pack root remote idx (tr/pack-object-key idx) p)
                                (throw (ex-info "committed Pack missing" {:type :awai.fs/missing-pack}))))
                            (nsio/regular! f)
                            (when-not (and (= (:bytes p) (.-size (.statSync fs f)))
                                           (= (:sha p) (sha-hex (.readFileSync fs f))))
                              (throw (ex-info "committed Pack byte checksum differs" {:type :awai.fs/corrupt-pack})))
                            (let [checked (load-pack-info root idx)
                                  _ (when-not (= (:root-cid p) (car/cid-str (:root-cid checked)))
                                      (throw (ex-info "Pack root CID differs" {:type :awai.fs/cid-mismatch})))
                                  ls (:leaves checked) buf (:buffer checked)
                                  offsets (reductions + 0 (map :length ls))]
                              [idx (into {} (map (fn [e off]
                                                  [off (assoc e :data (.subarray buf (:offset e) (+ (:offset e) (:length e))))])
                                                ls offsets))]))) packs))]
      (doseq [[sha location] (:chunk-index manifest)]
        (let [leaf (get-in layouts [(:pack location) (:pack-offset location)])]
          (when-not (and (nsio/digest? sha) leaf (= sha (:sha leaf)) (= (:length location) (:length leaf)))
            (throw (ex-info "dedup index differs from verified Pack leaf" {:type :awai.fs/invalid-link})))))
      (doseq [[_ fm] files]
        (doseq [e (:entries fm)]
          (let [leaf (get-in layouts [(:pack e) (:pack-offset e)])]
            (when-not (and leaf (= (:sha e) (:sha leaf)) (= (:length e) (:length leaf)))
              (throw (ex-info "catalog chunk differs from verified Pack leaf" {:type :awai.fs/cid-mismatch})))))
        (let [bytes (js/Buffer.concat (clj->js (mapv #(get-in layouts [(:pack %) (:pack-offset %) :data]) (:entries fm))))
              root-block (car/pack-root-block
                           (mapv #(car/cid-bytes car/codec-raw (car/hex-decode (:sha %))) (:entries fm)) sha256-bytes)]
          (when-not (and (= (:sha fm) (sha-hex bytes))
                         (= (:cid fm) (car/cid-str (car/cid-bytes car/codec-raw (sha256-bytes bytes))))
                         (= (:content-root fm) (car/cid-str (:cid root-block)))
                         (= (:content-root-hex fm) (car/hex-encode (:bytes root-block))))
            (throw (ex-info "logical file identity differs from verified bytes" {:type :awai.fs/cid-mismatch}))))))
    vol))

(defn- unlink-pack! [root idx]
  (when-not (contains? (nsio/protected-packs root) idx)
    (doseq [f [(pack-path root idx) (pack-idx-path root idx)]]
      (nsio/regular! f)
      (when (.existsSync fs f) (.unlinkSync fs f)))
    (nsio/sync-dir! (pjoin root "packs"))
    true))

(defn- write-car-pack! [root idx occurrences]
  (ensure-dir (pjoin root "packs"))
  (nsio/real-root! (pjoin root "packs"))
  (let [leaves (mapv (fn [{:keys [sha bytes]}]
                       (let [v (if (js/Buffer.isBuffer bytes) (buf->vec bytes) (vec bytes))]
                         (when-not (= sha (car/hex-encode (sha256-bytes v)))
                           (throw (ex-info "source block checksum differs" {:type :awai.fs/cid-mismatch})))
                         {:digest (car/hex-decode sha) :bytes v})) occurrences)
        encoded (bp/encode-pack leaves sha256-bytes)
        buf (vec->buf (:car encoded))
        checked (bp/verify-pack bp/profile (:car encoded) sha256-bytes)]
    (nsio/write-atomic! (pack-path root idx) buf :pack false)
    {:bytes (.-length buf) :sha (:sha checked) :format "carv2-indexless-v1"
     :root-cid (car/cid-str (:root-cid checked))}))

(defn- read-car-segments!
  "Positioned read of `segments` [{:offset :length}] from an open fd,
  concatenated into one Buffer. Counts bytes in the volume stats."
  [vol fd segments]
  (let [bufs (mapv (fn [{:keys [offset length]}]
                     (let [b (js/Buffer.alloc (long length))
                           n (.readSync fs fd b 0 (long length) (long offset))]
                       (when-not (= n length)
                         (throw (ex-info "short Pack section read" {:type :awai.fs/short-read})))
                       b))
                   segments)
        out (js/Buffer.concat (clj->js bufs))]
    (swap! (:stats vol) update :bytes-read + (.-length out))
    (swap! (:stats vol) update :range-reads + (count segments))
    out))

(defn- pack-range-read [vol idx object-key raw-offset length _get-range ensure-fn]
  (let [p (first (filter #(= idx (:pack-index %)) (get-in vol [:manifest :packs])))
        f (pack-path (:root vol) idx)]
    (when-not p (throw (ex-info "Pack not in committed catalog" {:type :awai.fs/missing-pack})))
    (when-not (.existsSync fs f) (ensure-fn))
    (nsio/regular! f)
    (when-not (and (.existsSync fs f) (= (:bytes p) (.-size (.statSync fs f)))
                   (= (:sha p) (sha-hex (.readFileSync fs f))))
      (throw (ex-info "committed Pack missing or corrupt" {:type :awai.fs/corrupt-pack})))
    (let [leaves (load-pack-leaves (:root vol) idx)
          segments (car/car-range-segments leaves raw-offset length)]
      (when-not (= length (reduce + 0 (map :length segments)))
        (throw (ex-info "Pack range outside verified leaves" {:type :awai.fs/invalid-range})))
      (let [fd (.openSync fs f "r")]
        (try (read-car-segments! vol fd segments) (finally (.closeSync fs fd)))))))

(defn- fs-backend
  "Durable tier backed by the volume's packs directory. Range reads use
  positioned reads, so serving a byte range never loads whole packs."
  [vol]
  (let [{:keys [root stats]} vol
        count-range (fn [n] (swap! stats update :range-reads inc)
                      (swap! stats update :bytes-read + n))]
    {:kind :volume-fs
     :max-part (* 4 1024 1024)
     :put-object (fn [object-key value]
                    (let [buf (cond (js/Buffer.isBuffer value) value
                                    (string? value) (js/Buffer.from value)
                                    :else (vec->buf value))]
                      (.writeFileSync fs (pjoin root object-key) buf)
                      {:etag (sha-hex buf) :bytes (.-length buf)}))
     :get-object (fn [object-key]
                   (let [f (pjoin root object-key)]
                     (when (.existsSync fs f)
                       (.readFileSync fs f))))
     :get-range (fn [object-key offset length]
                  (let [f (pjoin root object-key)]
                    (when (.existsSync fs f)
                      (let [fd (.openSync fs f "r")
                            buf (js/Buffer.alloc length)]
                        (try
                          (let [n (.readSync fs fd buf 0 length offset)]
                            (count-range n)
                            (.slice buf 0 n))
                          (finally (.closeSync fs fd)))))))
     :delete-object (fn [object-key]
                      (let [f (pjoin root object-key)]
                        (when (.existsSync fs f)
                          (.unlinkSync fs f))
                        true))
     :list-objects (fn [prefix]
                     (let [dir (pjoin root "packs")]
                       (if (.existsSync fs dir)
                         (into [] (comp (filter #(str/starts-with? % prefix))
                                        (map #(str "packs/" %)))
                               (.readdirSync fs dir))
                         [])))
     :head-object (fn [object-key]
                    (let [f (pjoin root object-key)]
                      (when (.existsSync fs f)
                        {:bytes (.-size (.statSync fs f))})))}))

(def child-proc (js/require "child_process"))
(def os-mod (js/require "os"))
(def path-mod (js/require "path"))

(defn- getenv [k]
  (let [v (aget (.-env js/process) k)]
    (when (and (string? v) (not (empty? v))) v)))

(defn- curl-request
  "Explicit B2 request through pinned curl. Secrets travel on stdin, never argv.
  Private disposable files, bounded response, HTTPS provider origins, no redirects."
  [req]
  (let [u (js/URL. (:url req))
        _ (when-not (and (= "https:" (.-protocol u)) (= "" (.-username u)) (= "" (.-password u))
                          (= "" (.-port u)) (or (= "api.backblazeb2.com" (.-hostname u))
                                                    (str/ends-with? (.-hostname u) ".backblazeb2.com")))
            (throw (ex-info "B2 endpoint outside HTTPS provider boundary" {})))
        dir (.mkdtempSync fs (path-mod.join (.tmpdir os-mod) "awai-volume-"))
        _ (.chmodSync fs dir 448)
        output (path-mod.join dir "response") input (path-mod.join dir "request")
        binary? (= :bytes (:response req))
        quote-config (fn [v]
                       (when (re-find #"[\u0000-\u001f\u007f]" (str v))
                         (throw (ex-info "invalid HTTP config value" {})))
                       (str "\"" (str/escape (str v) {\\ "\\\\" \" "\\\""}) "\""))
        payload (when (= :post (:method req))
                  (if-let [v (:bytes-value req)] (if (js/Buffer.isBuffer v) v (vec->buf v))
                    (js/Buffer.from (js/JSON.stringify (clj->js (:body req))) "utf8")))
        config (str "url = " (quote-config (:url req)) "\n"
                    (apply str (map (fn [[k v]] (str "header = " (quote-config (str k ": " v)) "\n")) (:headers req))))]
    (try
      (when payload
        (when (> (.-length payload) bp/max-pack-bytes) (throw (ex-info "upload exceeds supported bound" {})))
        (.writeFileSync fs input payload #js {:flag "wx" :mode 384}))
      (let [args (cond-> ["--config" "-" "--silent" "--show-error" "--proto" "=https" "--max-time" "120"
                          "--max-filesize" (str bp/max-pack-bytes) "--output" output "--write-out" "%{http_code}"
                          "--request" (if (= :post (:method req)) "POST" "GET")]
                   payload (into ["--data-binary" (str "@" input)]))
            status (js/Number (.toString (.execFileSync child-proc "curl" (clj->js args)
                                  #js {:input config :timeout 125000 :maxBuffer 1048576})))
            _ (when (> (.-size (.statSync fs output)) (if binary? bp/max-pack-bytes nsio/max-record-bytes))
                (throw (ex-info "HTTP response exceeds supported bound" {})))
            bytes (.readFileSync fs output)]
        {:status status :headers {} :body (if binary? (buf->vec bytes)
                                                    (js->clj (js/JSON.parse (.toString bytes "utf8")) :keywordize-keys true))})
      (finally
        (doseq [f [input output]] (when (.existsSync fs f) (.unlinkSync fs f)))
        (.rmdirSync fs dir)))))

(defn- node-b2-http
  "curl-backed http fns for bw/b2-backend."
  []
  {:get curl-request
   :post curl-request})

(defn resolve-remote
  "Build a durable-tier backend from `dest`: the string \"b2\" reads
  AWAI_B2_KEY_ID/APP_KEY/BUCKET_ID/BUCKET_NAME from the environment;
  anything else is a local directory served through dir-backend (the
  offline B2 stand-in with the same contract). AWAI_B2_PREFIX (optional)
  namespaces every B2 key under \"prefix/\" so volumes sharing one
  bucket cannot overwrite each other; empty/missing keeps the flat
  layout, and a bad value fails closed."
  [dest]
  (cond
    (= dest "b2")
    (let [auth {:key-id (getenv "AWAI_B2_KEY_ID")
                :app-key (getenv "AWAI_B2_APP_KEY")
                :bucket-id (getenv "AWAI_B2_BUCKET_ID")
                :bucket-name (getenv "AWAI_B2_BUCKET_NAME")}]
      (doseq [[k v] auth]
        (when (nil? v)
          (throw (ex-info "awai vol: missing B2 env var"
                          {:var (str "AWAI_B2_" (str/upper-case
                                                (str/replace (name k) "-" "_")))}))))
      (bw/b2-backend (node-b2-http) auth {:prefix (getenv "AWAI_B2_PREFIX")}))

    :else
    (do (ensure-dir dest)
        (rm/dir-backend dest))))

(defn- ensure-local-pack [root remote pack-index object-key expected]
  (let [f (pack-path root pack-index)]
    (when-not (.existsSync fs f)
      (when-not expected (throw (ex-info "no committed Pack reference" {:type :awai.fs/missing-pack})))
      (let [got ((:get-object remote) object-key)
            buf (when got (if (js/Buffer.isBuffer got) got (vec->buf got)))]
        (when-not (and buf (= (:bytes expected) (.-length buf))
                       (<= (.-length buf) bp/max-pack-bytes) (= (:sha expected) (sha-hex buf)))
          (throw (ex-info "restored Pack does not match committed reference" {:type :awai.fs/corrupt-pack})))
        (bp/verify-pack bp/profile (buf->vec buf) sha256-bytes)
        (ensure-dir (pjoin root "packs")) (nsio/real-root! (pjoin root "packs"))
        (nsio/write-atomic! f buf :pack false)))
    f))

(defn- sync-vol!
  "Upload an already-loaded volume's missing packs plus a manifest
  snapshot through `remote`. Returns the snapshot name and receipt
  count. Re-running uploads only what the remote listing still lacks;
  failures throw so callers decide (serve keeps the local PUT)."
  [vol root remote snapshot]
  (let [manifest (:manifest vol)
        remote-objects (into #{}
                             (concat ((:list-objects remote) "packs/")
                                     ((:list-objects remote) "manifests/")))
        snap (or snapshot (str "snap-" (.now js/Date)))
        plan (tr/upload-plan manifest #{} snap)
        with-bytes (fn [action]
                     ;; Zero-copy: thread the Node Buffer straight into the
                     ;; upload action as opaque :bytes-buffer. The old path
                     ;; ran every synced byte through buf->vec here plus a
                     ;; Buffer.from inside the backend (~7MB/s each way).
                     (assoc action :bytes-buffer
                            (if (= :manifest (:kind action))
                              (nsio/json-bytes manifest)
                              (let [f (pack-path root (:pack action))]
                                (when-not (.existsSync fs f)
                                  (throw (ex-info "awai vol: local pack missing for sync"
                                                  {:pack (:pack action)})))
                                (.readFileSync fs f)))))
        full-plan (-> plan
                      (update :packs #(mapv with-bytes %))
                      (assoc :manifest (with-bytes (:manifest plan))))
        {:keys [receipts]} (rm/execute-uploads remote #{} full-plan nil)]
    {:snapshot snap :objects (count receipts)}))

(defn cmd-init
  ([root] (cmd-init root default-leaf-size))
  ([root leaf-size]
   (let [profile (cp/fixed-profile leaf-size)]
     (when (and (.existsSync fs root) (seq (.readdirSync fs root)))
       (throw (ex-info "init requires a new empty volume; existing state preserved" {:type :awai.fs/existing-volume})))
     (.mkdirSync fs root #js {:recursive true :mode 448})
     (ensure-dir (pjoin root "packs"))
     (let [initial (save-volume {:root root :basis 0
                                 :manifest {:format "awai.otehon.catalog.v1" :default-chunk-profile profile
                                            :files {} :packs [] :nextPack 0 :chunk-index {}}})]
       ;; Both slots exist before init acknowledges. A later missing slot is
       ;; damage, never evidence that an older generation is the current one.
       (nsio/commit! root (:manifest initial) {:op "initialize"} (:basis initial) true))
     (println "init" root))))

(defn- prune-chunk-index [manifest dead]
  (if (empty? dead)
    manifest
    (update manifest :chunk-index
            (fn [ci] (into {} (remove (fn [[_ v]] (contains? dead (:pack v)))
                              (or ci {})))))))

(defn- rebuild-chunk-index [manifest]
  (assoc manifest :chunk-index
         (into {} (mapcat (fn [[_ fm]]
                            (map (fn [e] [(:sha e)
                                          (select-keys e [:pack :pack-offset :length])])
                                 (:entries fm))))
                  (:files manifest))))

(defn- entry-keys [e]
  (select-keys e [:index :offset :length :sha :pack :pack-offset]))

(def open-pack-max
  "Cap for one open (append) pack. Small files share it until it seals."
  (* 32 1024 1024))

(defn- plan-fresh
  "Chunk + hash + split, no pack I/O. Shared by the sealed and append
  ingest paths so both see identical chunk boundaries."
  [vol buf]
  (let [size (.-length buf)
        manifest0 (:manifest vol)
        known (or (:chunk-index manifest0) {})
        live-packs (into #{} (map :pack-index (:packs manifest0)))
        profile (or (:ingest-profile vol) (get-in vol [:manifest :default-chunk-profile]))
        _ (cp/admit! profile)
        _ (when (> (js/Math.ceil (/ size (:leaf-size profile))) bp/max-leaves)
            (throw (ex-info "file exceeds logical chunk count bound" {:type :awai.fs/resource-limit})))
        plan (lf/chunk-plan size {:leaf-size (:leaf-size profile)})
        chunks (mapv (fn [{:keys [index offset length]}]
                       {:index index :offset offset :length length
                        :sha (sha-hex (.slice buf offset (+ offset length)))})
                     (:chunks plan))]
    {:size size
     :split (tr/ingest-plan known live-packs chunks)}))

(defn- finish-ingest
  "Shared manifest assembly for sealed and append ingest.
  fresh-entries carry final :pack/:pack-offset. added-packs are brand-new
  sealed packs; bumped-bytes maps grown open-pack index -> new total;
  next-bump advances :nextPack (0 for appends)."
  [vol manifest0 fname buf size reuse fresh-entries added-packs bumped-bytes next-bump]
  (let [entries (vec (sort-by :index (concat reuse
                                            (map entry-keys fresh-entries))))
        pack-bytes (merge (into {} (map (fn [p] [(:pack-index p) (:bytes p)]))
                                 (:packs manifest0))
                          bumped-bytes
                          (into {} (map (fn [p] [(:pack-index p) (:bytes p)]))
                                added-packs))
        file-packs (mapv (fn [pi] {:pack-index pi :bytes (get pack-bytes pi)})
                         (distinct (map :pack entries)))
        new-index (into {}
                        (map (fn [e] [(:sha e)
                                      (select-keys e [:pack :pack-offset :length])]))
                        fresh-entries)
        old-fm (get-in manifest0 [:files fname])
        logical-root (car/pack-root-block
                       (mapv #(car/cid-bytes car/codec-raw (car/hex-decode (:sha %))) entries) sha256-bytes)
        fm {:file-size size
            :leaf-size (:leaf-size (or (:ingest-profile vol) (:default-chunk-profile manifest0)))
            :chunk-profile (or (:ingest-profile vol) (:default-chunk-profile manifest0))
            :sha (sha-hex buf)
            :cid (car/cid-str (car/cid-bytes car/codec-raw (sha256-bytes buf)))
            :content-root (car/cid-str (:cid logical-root))
            :content-root-hex (car/hex-encode (:bytes logical-root))
            :pack-target default-pack-target
            :chunk-count (count entries)
            :pack-count (count file-packs)
            :packs file-packs
            :entries entries
            :mtime (.now js/Date)
            ;; Content replacement preserves relations/auth state.
            :meta (or (:meta old-fm) {})
            :acl (or (:acl old-fm) [])}
        manifest (-> manifest0
                     (assoc-in [:files fname] fm)
                     (update :packs (fn [ps]
                                      (let [bumped (into #{} (keys bumped-bytes))
                                            have (into #{} (map :pack-index ps))
                                            mapped (mapv #(if (contains? bumped (:pack-index %))
                                                          {:pack-index (:pack-index %)
                                                           :bytes (get bumped-bytes (:pack-index %))}
                                                          %)
                                                       ps)
                                            missing (filterv #(not (contains? have (:pack-index %)))
                                                             (map (fn [[idx b]]
                                                                    {:pack-index idx :bytes b})
                                                                  bumped-bytes))]
                                        (into mapped
                                              (concat missing
                                                      (map #(select-keys % [:pack-index :bytes :sha :format :root-cid])
                                                           added-packs))))))
                     (update :nextPack + next-bump)
                     (update :chunk-index (fn [ci] (into (or ci {}) new-index))))]
    {:vol (-> vol
              (assoc :manifest manifest)
              (assoc-in [:files fname]
                        {:manifest fm
                         :index (lf/offset-index fm)
                         :cache (hc/make-cache default-cache-size)}))
     :fm fm
     :manifest manifest
     :chunks (count entries)
     :packs (mapv :pack-index file-packs)}))

(defn- ingest-buffer [vol fname buf]
  (valid-name! fname)
  (when (or (> (count (assoc (get-in vol [:manifest :files]) fname {})) 1024)
             (> (+ (.-length buf) (reduce + 0 (map :file-size (vals (dissoc (get-in vol [:manifest :files]) fname)))))
                (* 64 1024 1024)))
    (throw (ex-info "volume resource bound exceeded" {:type :awai.fs/resource-limit})))
  (let [vol (assoc vol :ingest-profile
                         (if-let [old (get-in vol [:manifest :files fname])]
                           (cp/from-manifest old) (get-in vol [:manifest :default-chunk-profile])))
        {:keys [size split]} (plan-fresh vol buf)
        manifest0 (:manifest vol)
        packed (lf/pack-plan (:fresh split) {:pack-target default-pack-target})
        base (:nextPack manifest0)
        new-packs (mapv (fn [pi p]
                          {:pack-index (+ base pi)
                           :bytes (:bytes p)
                           :entries (mapv #(assoc % :pack (+ base pi))
                                          (:entries p))})
                        (range) (:packs packed))
        root (:root vol)
        ;; Sealed packs are born CARv2: leaves in raw-pack order become
        ;; the pack plus its .idx sidecar. :bytes is the physical size.
        new-packs (mapv (fn [p]
                          (let [occurrences (mapv
                                             (fn [e]
                                               {:sha (:sha e)
                                                :bytes (.slice buf (:offset e)
                                                               (+ (:offset e)
                                                                  (:length e)))})
                                             (sort-by :pack-offset (:entries p)))
                                physical (write-car-pack! root (:pack-index p) occurrences)]
                            (merge p physical)))
                        new-packs)]
    (let [fresh-entries (mapcat :entries new-packs)
          res (finish-ingest vol manifest0 fname buf size (:reuse split)
                             fresh-entries new-packs {} (count new-packs))]
      (assoc res :reused (count (:reuse split))))))

(defn- seal-open-pack! [_state _root] nil)
(defn- clear-dead-open-pack! [_state _root] nil)

(defn cmd-put [root fname fpath dest]
  (when-not (.existsSync fs fpath)
    (throw (ex-info "input file missing" {:file fpath})))
  (let [size (.-size (.statSync fs fpath))]
    (when (> size max-put-bytes)
      (throw (ex-info "file too large for trial ingest" {:size size :cap max-put-bytes})))
    (let [vol (load-volume root)
          {:keys [vol chunks packs reused]} (ingest-buffer vol fname (.readFileSync fs fpath))]
      (save-volume vol)
      (journal-truncate! root)
      (println "ingested" fname "chunks:" chunks "packs:" packs "reused:" reused)
      (when (some? dest)
        (let [{:keys [snapshot objects]} (sync-vol! vol root
                                                    (resolve-remote dest)
                                                    (str "snap-put-" (.now js/Date)))]
          (println "autosynced" fname "snapshot:" snapshot "objects:" objects))))))

(defn- file-entry [vol fname]
  (get (:files vol) fname))

(defn- gc-vol-state
  ([vol root] (gc-vol-state vol root nil))
  ([vol _root _remote-objects]
   (let [live (into #{} (map :pack) (mapcat :entries (vals (get-in vol [:manifest :files]))))
         dead (into #{} (remove live) (map :pack-index (get-in vol [:manifest :packs])))]
     {:vol (update vol :manifest #(-> %
                                      (update :packs (fn [ps] (filterv (fn [p] (live (:pack-index p))) ps)))
                                      (prune-chunk-index dead)))
      :deleted []})))

(defn- collect-local! [root]
  (let [protected (nsio/protected-packs root)
        indexes (keep #(some-> (re-matches #"pack-([0-9]+)\.car" %) second (js/parseInt 10))
                      (.readdirSync fs (pjoin root "packs")))]
    (filterv #(and (not (contains? protected %)) (unlink-pack! root %)) indexes)))

(defn- demand-read
  "Read a bounded logical range through verified Pack references. Current
  validation may read/decode entire Packs; no end-to-end zero-copy claim."
  [vol fname offset length]
  (let [{:keys [manifest index cache]} (file-entry vol fname)]
    (when (nil? manifest)
      (throw (ex-info "no such file" {:file fname})))
    (let [backend (fs-backend vol)
          get-range (:get-range backend)
          remote-objects (set (map tr/pack-object-key
                                   (map :pack-index (:packs manifest))))
          plan (tr/demand-plan index cache offset length remote-objects)
          out (reduce
               (fn [{:keys [cache bufs reads]} action]
                 (case (:action action)
                   :read-cache
                   (let [[cache' hit?] (hc/cache-lookup cache [:chunk (:chunk action)])
                         stored (get-in cache' [:store [:chunk (:chunk action)] :value])
                         skip (- (:read-offset action) (:offset action))
                         want (:read-length action)]
                     (when-not hit?
                       (throw (ex-info "awai vol: planned cache hit missed"
                                       {:chunk (:chunk action)})))
                     (when-not (= (:sha action) (sha-hex (if (js/Buffer.isBuffer stored) stored (vec->buf stored))))
                       (throw (ex-info "cached chunk checksum differs" {:type :awai.fs/cid-mismatch})))
                     {:cache cache'
                      :bufs (conj bufs (if (js/Buffer.isBuffer stored)
                                         (.slice stored skip (+ skip want))
                                         (vec->buf (subvec stored skip (+ skip want)))))
                      :reads reads})
                   :fetch-remote
                   (let [got (pack-range-read
                              vol (:pack action) (:object action)
                              (:pack-offset action) (:length action)
                              get-range
                              (fn []
                                (when-let [remote (:remote vol)]
                                  (ensure-local-pack (:root vol) remote
                                                     (:pack action) (:object action)
                                                     (first (filter #(= (:pack action) (:pack-index %))
                                                                    (get-in vol [:manifest :packs])))))))]
                     (when (nil? got)
                       (throw (ex-info "awai vol: pack range vanished mid-read"
                                       {:object (:object action)
                                        :chunk (:chunk action)})))
                     (when-not (and (= (:length action) (.-length got)) (= (:sha action) (sha-hex got)))
                       (throw (ex-info "read chunk checksum/extent differs" {:type :awai.fs/cid-mismatch})))
                     (let [skip (- (:read-offset action) (:offset action))
                           piece (.slice got skip (+ skip (:read-length action)))
                           [cache' _] (hc/cache-insert cache
                                                       [:chunk (:chunk action)]
                                                       (:length action) got)]
                       {:cache cache'
                        :bufs (conj bufs piece)
                        :reads (inc reads)}))))
               {:cache cache :bufs [] :reads 0}
               (:actions plan))]
      {:buf (js/Buffer.concat (clj->js (:bufs out)))
       :reads (:reads out)
       :cache (:cache out)})))

(defn cmd-get [root fname outpath offset length]
  (let [vol (load-volume root)
        {:keys [buf reads]} (demand-read vol fname (or offset 0)
                                         (or length
                                             (:file-size (:manifest (file-entry vol fname)))))]
    (.writeFileSync fs outpath buf #js {:flag "wx" :mode 384})
    (println "read" fname "bytes:" (.-length buf) "pack-ranges:" reads)))


;; nbb evaluates top-level forms in order, so anything used before its
;; definition site lives here. Dependency order, late-defined first:
;; auth gate (deny-*) -> dead-props render -> small send helper ->
;; pure manifest copy.
(declare deny-write! deny-read! deny-write-state! deny-read-state!
         deny-read-quiet! copy-file-state max-prop-value dav-dead-props
         send-text)

(defn cmd-link [root src-name dst-name]
  (let [vol (load-volume root)
        manifest (:manifest vol)]
    (when-not (contains? (:files manifest) src-name)
      (throw (ex-info "no such file" {:file src-name})))
    (when (contains? (:files manifest) dst-name)
      (throw (ex-info "destination exists" {:file dst-name})))
    (let [vol2 (copy-file-state vol src-name dst-name)]
      (save-volume vol2)
      (journal-truncate! root)
      (println "linked" src-name "->" dst-name
               "chunks:" (count (get-in (:manifest vol2) [:files dst-name :entries]))))))

(defn- update-file-meta!
  "Apply `f` to a file's meta map, persist, truncate the journal.
  Returns the updated file record."
  [root fname f]
  (let [vol (load-volume root)]
    (when-not (contains? (:files (:manifest vol)) fname)
      (throw (ex-info "no such file" {:file fname})))
    (let [fm (get-in vol [:manifest :files fname])
          fm2 (assoc fm :meta (f (or (:meta fm) {}))
                         :mtime (.now js/Date))]
      (save-volume (assoc-in vol [:manifest :files fname] fm2))
      (journal-truncate! root)
      fm2)))

(defn cmd-propset [root fname qname ns value]
  (when-not (rel/valid-prop-key? qname)
    (throw (ex-info "bad prop key" {:qname qname})))
  (when (or (nil? ns) (> (count (or value "")) max-prop-value))
    (throw (ex-info "bad prop ns/value" {:qname qname})))
  (update-file-meta! root fname #(assoc % qname {:ns ns :value (or value "")}))
  (println "propset" fname qname))

(defn cmd-propdel [root fname qname]
  (update-file-meta! root fname #(dissoc % qname))
  (println "propdel" fname qname))

(defn cmd-propget [root fname]
  (let [vol (load-volume root)]
    (when-not (contains? (:files (:manifest vol)) fname)
      (throw (ex-info "no such file" {:file fname})))
    (let [meta (or (get-in vol [:manifest :files fname :meta]) {})]
      (println (js/JSON.stringify (clj->js meta) nil 2)))))

(defn cmd-aclset [root fname json]
  "Replace a file's ACL from a JSON vector of {principal, ops}.
  Principal \"*\" covers anonymous; ops are \"read\"/\"write\" strings.
  Empty vector [] reopens the file. Owner-local admin path: the
  server enforces ACLs but never mutates them."
  (let [parsed (try (js->clj (.parse js/JSON json) :keywordize-keys true)
                    (catch :default _
                      (throw (ex-info "bad acl json" {:file fname}))))
        acl (rel/normalize-acl parsed)
        vol (load-volume root)]
    (when-not (contains? (:files (:manifest vol)) fname)
      (throw (ex-info "no such file" {:file fname})))
    (let [fm (assoc (get-in vol [:manifest :files fname])
                    :acl acl :mtime (.now js/Date))]
      (save-volume (assoc-in vol [:manifest :files fname] fm))
      (journal-truncate! root)
      (println "aclset" fname "aces:" (count acl)))))

(defn cmd-aclget [root fname]
  (let [vol (load-volume root)]
    (when-not (contains? (:files (:manifest vol)) fname)
      (throw (ex-info "no such file" {:file fname})))
    (let [acl (or (get-in vol [:manifest :files fname :acl]) [])]
      (println (js/JSON.stringify (clj->js acl) nil 2)))))

(defn cmd-delete [root fname]
  (let [vol (load-volume root)
        manifest (:manifest vol)]
    (when-not (contains? (:files manifest) fname)
      (throw (ex-info "no such file" {:file fname})))
    (let [manifest (update manifest :files dissoc fname)
          live (into #{} (mapcat (fn [[_ fm]] (mapv :index (:entries fm))))
                     (:files manifest))
          local-packs (into #{} (map :pack-index (:packs manifest)))
          remote-objects (set (map tr/pack-object-key local-packs))
          plan (tr/gc-plan {:entries (mapcat :entries (vals (:files manifest)))}
                           live local-packs remote-objects)]
      (doseq [p (:delete-local plan)]
        (unlink-pack! root p))
      (let [dead (set (:delete-local plan))]
        (save-volume (assoc vol :manifest (prune-chunk-index
                                 (update manifest :packs
                                         (fn [ps] (into [] (remove #(contains? dead (:pack-index %))) ps)))
                                 dead)))
        (journal-truncate! root)
        (println "deleted" fname "packs freed:" (:delete-local plan))))))

(defn- xml-escape [s]
  (-> (str s)
      (str/replace "&" "&amp;")
      (str/replace "<" "&lt;")
      (str/replace ">" "&gt;")
      (str/replace "\"" "&quot;")))

(defn- dav-url-path [prefix name]
  (str prefix (js/encodeURIComponent name)))

(defn- dav-acl-props
  "Render a file's ACL for PROPFIND under the awai acl namespace.
  Empty ACL (open file) renders nothing, so open files stay
  indistinguishable from pre-ACL responses."
  [acl]
  (when (seq acl)
    {:decls " xmlns:A=\"https://awai.local/acl\""
     :xml (str "<A:acl>"
               (apply str
                      (map (fn [{:keys [principal ops]}]
                             (str "<A:ace><A:principal>"
                                  (xml-escape principal)
                                  "</A:principal><A:access>"
                                  (xml-escape (str/join "," ops))
                                  "</A:access></A:ace>"))
                           acl))
               "</A:acl>")}))

(defn- dav-response-file [base name fm]
  (let [{d-decls :decls d-xml :xml} (dav-dead-props (:meta fm))
        {a-decls :decls a-xml :xml} (or (dav-acl-props (:acl fm)) {})]
    (str "<D:response" d-decls a-decls ">"
         "<D:href>" (xml-escape (dav-url-path base name)) "</D:href>"
         "<D:propstat><D:prop>"
         "<D:displayname>" (xml-escape name) "</D:displayname>"
         "<D:getcontentlength>" (:file-size fm) "</D:getcontentlength>"
         "<D:getlastmodified>" (.toUTCString (js/Date. (or (:mtime fm) 0))) "</D:getlastmodified>"
         "<D:getcontenttype>application/octet-stream</D:getcontenttype>"
         "<D:resourcetype/>"
         d-xml a-xml
         "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
         "</D:response>")))

(defn- dav-response-dir [base name]
  (str "<D:response>"
       "<D:href>" (xml-escape (dav-url-path base name)) "/</D:href>"
       "<D:propstat><D:prop>"
       "<D:displayname>" (xml-escape name) "</D:displayname>"
       "<D:resourcetype><D:collection/></D:resourcetype>"
       "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>"
       "</D:response>"))

(defn- dir-children [files prefix]
  (let [rest-names (into []
                         (comp (filter #(str/starts-with? % prefix))
                               (map #(subs % (count prefix))))
                         (keys files))]
    (reduce (fn [acc r]
              (let [slash (.indexOf r "/")]
                (if (neg? slash)
                  (update acc :files conj r)
                  (update acc :dirs conj (subs r 0 slash)))))
            {:files #{} :dirs #{}} rest-names)))

(defn- dav-multistatus [responses]
  (str "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
       "<D:multistatus xmlns:D=\"DAV:\">"
       (apply str responses)
       "</D:multistatus>"))

(def max-prop-value
  "Dead-prop value cap (chars). Larger set values fail per-prop."
  65536)

(defn- proppatch-namespaces
  "xmlns:prefix declarations in a PROPPATCH body -> {prefix uri}."
  [body]
  (let [re (js/RegExp. "xmlns:([A-Za-z][\\w.\\-]*)=\"([^\"]+)\"" "g")]
    (loop [out {} m (.exec re body)]
      (if (nil? m)
        out
        (recur (assoc out (aget m 1) (aget m 2)) (.exec re body))))))

(defn- proppatch-block-ops
  "Parse one set/remove block: [{:prefix :name :value-or-nil}]."
  [inner]
  (let [stripped (str/replace inner #"<\w[\w.\-]*:prop\s*>|</\w[\w.\-]*:prop\s*>" "")
        collect (fn [re value-fn]
                  (loop [out [] m (.exec re stripped)]
                    (if (nil? m)
                      out
                      (recur (conj out (value-fn m)) (.exec re stripped)))))]
    (into (collect (js/RegExp. "<(\\w[\\w.\\-]*):([\\w.\\-]+)>([\\s\\S]*?)</\\1:\\2>" "g")
                   (fn [m] {:prefix (aget m 1) :name (aget m 2) :value (aget m 3)}))
          (map (fn [{:keys [prefix name]}] {:prefix prefix :name name :value nil})
               (collect (js/RegExp. "<(\\w[\\w.\\-]*):([\\w.\\-]+)\\s*/>" "g")
                        (fn [m] {:prefix (aget m 1) :name (aget m 2)}))))))

(defn- parse-proppatch
  "Minimal PROPPATCH subset: set/remove blocks with text (or opaque
  nested-XML) values. Returns {:ops [{:op :set/:remove :qname :ns
  :value}]}. Undeclared prefixes keep nil ns (caller 422s them)."
  [body]
  (let [nss (proppatch-namespaces body)
        bre (js/RegExp. "<(\\w[\\w.\\-]*):(set|remove)>([\\s\\S]*?)</\\1:\\2>" "g")
        blocks (loop [out [] m (.exec bre body)]
                 (if (nil? m)
                   out
                   (recur (conj out {:verb (aget m 2) :inner (aget m 3)})
                          (.exec bre body))))]
    {:ops (vec (mapcat (fn [{:keys [verb inner]}]
                         (map (fn [{:keys [prefix name value]}]
                                {:op (if (= verb "set") :set :remove)
                                 :qname (str prefix ":" name)
                                 :ns (or (get nss prefix)
                                         (get rel/well-known-namespaces prefix))
                                 :value (or value "")})
                              (proppatch-block-ops inner)))
                       blocks))}))

(defn- dav-dead-props
  "Render bounded local metadata as escaped text, never executable XML."
  [meta]
  (let [items (mapv (fn [[qname {:keys [ns value]}]]
                      (let [i (.indexOf ^String qname ":")
                            prefix (subs qname 0 i)
                            name (subs qname (inc i))]
                        {:prefix prefix :name name :ns ns :value value}))
                    (or meta {}))
        decls (apply str (map (fn [p] (str " xmlns:" p "=\"" (xml-escape (get (into {} (map (fn [{:keys [prefix ns]}] [prefix ns]) items)) p)) "\""))
                              (distinct (map :prefix items))))
        xml (apply str (map (fn [{:keys [prefix name value]}]
                              (str "<" prefix ":" name ">" (xml-escape (or value "")) "</" prefix ":" name ">"))
                            items))]
    {:decls decls :xml xml}))

(defn- serve-proppatch [_state _root _name _req res]
  (.writeHead res 501) (.end res "HTTP property mutation is not qualified; use local propset/propdel"))

(defn- parse-range [header size]
  (when-let [[_ a b] (and (pos? size) (string? header) (re-matches #"bytes=([0-9]*)-([0-9]*)" header))]
    (let [lo (when (seq a) (js/Number a)) hi (when (seq b) (js/Number b))]
      (when (and (or (nil? lo) (js/Number.isSafeInteger lo))
                 (or (nil? hi) (js/Number.isSafeInteger hi)))
        (cond (and (nil? lo) hi (pos? hi)) [(max 0 (- size hi)) (dec size)]
              (and lo (< lo size) (or (nil? hi) (<= lo hi))) [lo (min (or hi (dec size)) (dec size))]
              :else nil)))))

(defn- send-body [res status headers buf]
  (.writeHead res status (clj->js (assoc headers "Content-Length" (str (.-length buf)))))
  (.end res buf))

(defn- send-text [res status headers s]
  (send-body res status headers (js/Buffer.from s "utf8")))

(defn- serve-stats [state res]
  (let [vol (:vol @state)]
    (send-text res 200 {"Content-Type" "application/json"}
               (.stringify js/JSON
                 (clj->js (assoc @(:stats vol)
                                 :files (count (:files (:manifest vol)))
                                 :packs (count (:packs (:manifest vol)))
                                 :journal (or (:dirty @state) 0)
                                 :pending-sync (boolean (:sync-dirty @state))
                                 :last-snapshot (or (:last-snapshot @state) "-")))))))

(defn- serve-get [state fname req res head-only?]
  (let [vol (:vol @state)
        files (:files (:manifest vol))]
    (if-not (contains? files fname)
      (do (.writeHead res 404) (.end res))
      (if (deny-read! (get files fname) req res)
        nil
      (let [fm (get files fname)
            size (:file-size fm)
            range (parse-range (aget (.-headers req) "range") size)]
        (if (and (aget (.-headers req) "range") (nil? range))
          (do (.writeHead res 416 (clj->js {"Content-Range" (str "bytes */" size)}))
              (.end res))
          (let [bounds (or range [0 (dec (max size 1))])
                from (first bounds)
                to (second bounds)
                length (if (zero? size) 0 (inc (- to from)))
                got (demand-read vol fname from length)
                buf (:buf got)]
            (swap! state assoc-in [:vol :files fname :cache] (:cache got))
            (if head-only?
              (do (.writeHead res 200 (clj->js {"Content-Length" (str size)
                                               "Accept-Ranges" "bytes"}))
                  (.end res))
              (if range
                (send-body res 206 {"Content-Type" "application/octet-stream"
                                    "Accept-Ranges" "bytes"
                                    "Content-Range" (str "bytes " from "-" to "/" size)}
                           buf)
                (send-body res 200 {"Content-Type" "application/octet-stream"
                                    "Accept-Ranges" "bytes"}
                           buf))))))))))

(defn- serve-propfind [state dname depth req res]
  (let [files (:files (:manifest (:vol @state)))]
    (if (contains? files dname)
      (if (deny-read! (get files dname) req res)
        nil
        (send-text res 207 {"Content-Type" "application/xml; charset=utf-8"}
                   (dav-multistatus [(dav-response-file "/" dname (get files dname))])))
      (let [prefix (if (or (= dname "") (str/ends-with? dname "/"))
                     dname (str dname "/"))
            visible (into {} (remove (fn [[_ fm]] (deny-read-quiet! fm req))) files)
            kids (dir-children visible prefix)
            ;; ACL-denied names stay invisible in listings.
            child-files (filterv #(not (deny-read-quiet!
                                        (get files (str prefix %)) req))
                                 (:files kids))
            child-dirs (:dirs kids)
            self (if (= prefix "")
                   (dav-response-dir "" "")
                   (dav-response-dir "/" (subs prefix 0 (dec (count prefix)))))]
        (cond
          ;; Collections are implicit in this profile. A nonexistent non-root
          ;; path must not masquerade as a collection at Depth 1 either.
          (and (not= dname "") (empty? child-files) (empty? child-dirs))
          (do (.writeHead res 404) (.end res))
          (= depth "0")
          (send-text res 207 {"Content-Type" "application/xml; charset=utf-8"}
                     (dav-multistatus [self]))
          :else
          (let [dir-part (map #(dav-response-dir (str "/" prefix) %) (sort child-dirs))
                file-part (map #(dav-response-file (str "/" prefix) %
                                                   (get files (str prefix %)))
                               (sort child-files))]
            (send-text res 207 {"Content-Type" "application/xml; charset=utf-8"}
                       (dav-multistatus (into [self] (concat dir-part file-part))))))))))

(defn- delete-file-state [vol-state root fname]
  (let [manifest (update (:manifest vol-state) :files dissoc fname)
        live (into #{} (mapcat (fn [[_ fm]] (mapv :index (:entries fm))))
                   (:files manifest))
        local-packs (into #{} (map :pack-index (:packs manifest)))
        remote-objects (set (map tr/pack-object-key local-packs))
        plan (tr/gc-plan {:entries (mapcat :entries (vals (:files manifest)))}
                         live local-packs remote-objects)
        dead (set (:delete-local plan))]
    (doseq [p (:delete-local plan)]
      (unlink-pack! root p))
    (-> vol-state
        (assoc :manifest (prune-chunk-index
                          (update manifest :packs
                                  (fn [ps] (into [] (remove #(contains? dead (:pack-index %))) ps)))
                          dead))
        (update :files dissoc fname))))

 (defn- move-file-state
  "Rename one file entry (manifest + hot index/cache). Bytes stay in
  their packs; only keys move. Pure on the vol state."
  [vol-state old-name new-name]
  (-> vol-state
      (assoc-in [:manifest :files new-name]
                (get-in vol-state [:manifest :files old-name]))
      (update-in [:manifest :files] dissoc old-name)
      (assoc-in [:files new-name] (get-in vol-state [:files old-name]))
      (update :files dissoc old-name)))

(defn- volume-tokens []
  (let [owner (getenv "AWAI_VOL_TOKEN")
        pairs (if (seq (getenv "AWAI_VOL_TOKENS"))
                (str/split (getenv "AWAI_VOL_TOKENS") #"," -1) [])
        entries (mapv (fn [pair]
                        (let [i (.indexOf pair ":")]
                          (when (neg? i) (throw (ex-info "invalid named token configuration" {})))
                          (let [n (subs pair 0 i) secret (subs pair (inc i))]
                            (when-not (and (re-matches #"[A-Za-z0-9_-]{1,64}" n)
                                           (not= "owner" n) (re-matches #"\S{16,}" secret))
                              (throw (ex-info "invalid named token configuration" {})))
                            [n secret]))) pairs)]
    (when-not (and (string? owner) (re-matches #"\S{16,}" owner))
      (throw (ex-info "AWAI_VOL_TOKEN must contain at least 16 non-whitespace characters" {})))
    (when-not (and (= (count entries) (count (distinct (map first entries))))
                   (= (inc (count entries)) (count (distinct (cons owner (map second entries))))))
      (throw (ex-info "token names and secrets must be unique" {})))
    {:owner owner :named (into {} entries)}))

(defn- request-principal [req tokens]
  (let [tok (second (re-matches #"Bearer (\S+)" (or (aget (.-headers req) "authorization") "")))]
    (cond (nil? tok) nil
          (= tok (:owner tokens)) :owner
          :else (some (fn [[n s]] (when (= s tok) n)) (:named tokens)))))

(defn- allowed? [fm req operation]
  (let [p (request-principal req (volume-tokens))]
    (or (= p :owner) (and p (rel/acl-allowed? (or (:acl fm) []) p operation)))))
(defn- deny! [fm req res operation]
  (when-not (allowed? fm req operation)
    (.writeHead res (if (request-principal req (volume-tokens)) 403 401))
    (.end res "access denied") true))
(defn- deny-write! [fm req res] (deny! fm req res "write"))
(defn- deny-read! [fm req res] (deny! fm req res "read"))
(defn- deny-write-state! [state name req res]
  (deny-write! (get-in @state [:vol :manifest :files name]) req res))
(defn- deny-read-state! [state name req res]
  (deny-read! (get-in @state [:vol :manifest :files name]) req res))
(defn- deny-read-quiet! [fm req] (not (allowed? fm req "read")))
(defn- deny-owner! [req res]
  (when-not (= :owner (request-principal req (volume-tokens)))
    (.writeHead res 403) (.end res "owner required") true))

(defn- copy-file-state
  "Copy one file entry under a new name (manifest + hot index). Chunk
  entries are shared, so no pack bytes move; refcounts derive live
  from the manifest (see awai.fs.relations/refcounts). The copy keeps
  the source's meta and acl with a fresh mtime. Pure on the vol state."
  [vol-state src-name dst-name]
  (let [fm (assoc (get-in vol-state [:manifest :files src-name])
                  :mtime (.now js/Date))]
    (-> vol-state
        (assoc-in [:manifest :files dst-name] fm)
        (assoc-in [:files dst-name]
                  {:manifest fm
                   :index (lf/offset-index fm)
                   :cache (hc/make-cache default-cache-size)}))))

(defn- retain-destination-relations [vol name previous]
  (if-not previous vol
    (let [fm (merge (get-in vol [:manifest :files name]) (select-keys previous [:acl :meta]))]
      (-> vol (assoc-in [:manifest :files name] fm) (assoc-in [:files name :manifest] fm)))))

(defn- dest-path [raw req]
  (when-not (string? raw) (throw (ex-info "destination required" {})))
  (let [base (str "http://127.0.0.1:" (.-localPort (.-socket req)))
        u (js/URL. raw base)]
    (when-not (and (= base (.-origin u)) (= "" (.-search u)) (= "" (.-hash u))
                   (= "" (.-username u)) (= "" (.-password u))
                   (not (re-find #"(?i)%2e|%2f|%5c" raw)))
      (throw (ex-info "destination must name this server's logical path" {})))
    (valid-name! (subs (js/decodeURIComponent (.-pathname u)) 1))))

(defn- serve-move [state root dname req res]
  (let [files (:files (:manifest (:vol @state)))
        dest (dest-path (aget (.-headers req) "destination") req)
        overwrite? (not= "F" (str/upper-case
                               (or (aget (.-headers req) "overwrite") "T")))
        existed? (contains? files dest)]
    (cond
      (or (empty? dest) (str/ends-with? dest "/"))
      (do (.writeHead res 400) (.end res "bad destination"))

      (= dest dname)
      (do (.writeHead res 204) (.end res))

      (not (contains? files dname))
      (let [prefix (str dname "/")
            victims (filter #(str/starts-with? % prefix) (keys files))]
        (if (empty? victims)
          (do (.writeHead res 404) (.end res))
          (do (.writeHead res 501) (.end res "collection move not supported"))))

      (and existed? (not overwrite?))
      (do (.writeHead res 412) (.end res))

      :else
      (do (when existed?
            (swap! state update :vol (fn [v] (delete-file-state v root dest))))
          (swap! state update :vol (fn [v] (move-file-state v dname dest)))
          (swap! state update :vol retain-destination-relations dest (get files dest))
          (clear-dead-open-pack! state root)
          (mark-dirty! state root {:op "move" :from dname :to dest})
          (when (some? (:remote (:vol @state)))
            (swap! state assoc :sync-dirty true))
          (.writeHead res (if existed? 204 201)) (.end res)))))

(defn- serve-copy [state root dname req res]
  (let [files (:files (:manifest (:vol @state)))
        dest (dest-path (aget (.-headers req) "destination") req)
        overwrite? (not= "F" (str/upper-case
                               (or (aget (.-headers req) "overwrite") "T")))
        existed? (contains? files dest)]
    (cond
      (or (empty? dest) (str/ends-with? dest "/"))
      (do (.writeHead res 400) (.end res "bad destination"))

      (= dest dname)
      (do (.writeHead res 204) (.end res))

      (not (contains? files dname))
      (let [prefix (str dname "/")
            victims (filter #(str/starts-with? % prefix) (keys files))]
        (if (empty? victims)
          (do (.writeHead res 404) (.end res))
          (do (.writeHead res 501) (.end res "collection copy not supported"))))

      (and existed? (not overwrite?))
      (do (.writeHead res 412) (.end res))

      :else
      (let [vol2 (if existed?
                   (delete-file-state (:vol @state) root dest)
                   (:vol @state))
            vol3 (retain-destination-relations (copy-file-state vol2 dname dest) dest (get files dest))
            fm3 (get-in vol3 [:manifest :files dest])]
        (swap! state assoc :vol vol3)
        (clear-dead-open-pack! state root)
        (mark-dirty! state root {:op "put" :name dest :file fm3
                                 :packs []
                                 :nextPack (get-in vol3 [:manifest :nextPack])})
        (when (some? (:remote (:vol @state)))
          (swap! state assoc :sync-dirty true))
        (.writeHead res (if existed? 204 201)) (.end res)))))

(defn- serve-delete [state root dname res]
  (let [files (:files (:manifest (:vol @state)))]
    (if (contains? files dname)
      (do (swap! state update :vol (fn [v] (delete-file-state v root dname)))
          (clear-dead-open-pack! state root)
          (mark-dirty! state root {:op "del" :files [dname]})
          (when (some? (:remote (:vol @state)))
            (swap! state assoc :sync-dirty true))
          (.writeHead res 204) (.end res))
      (let [prefix (str dname "/")
            victims (filter #(str/starts-with? % prefix) (keys files))]
        (if (empty? victims)
          (do (.writeHead res 404) (.end res))
          (do (doseq [v victims]
                (swap! state update :vol (fn [v2] (delete-file-state v2 root v))))
              (clear-dead-open-pack! state root)
              (mark-dirty! state root {:op "del" :files (vec victims)})
              (when (some? (:remote (:vol @state)))
                (swap! state assoc :sync-dirty true))
              (.writeHead res 204) (.end res)))))))

(defn- serve-gc [state root _req res]
  (try
    (let [trimmed (:vol (gc-vol-state (:vol @state) root))
          saved (save-volume trimmed)
          deleted (collect-local! root)]
      (swap! state assoc :vol saved :dirty 0 :sync-dirty (some? (:remote saved)))
      (send-text res 200 {"Content-Type" "application/json"}
                 (js/JSON.stringify (clj->js {:deleted-local deleted :retention "both-root-generations"}))))
    (catch :default e (swap! state assoc :failed? true) (throw e))))

(defn- put-sealed!
  "Large-file PUT: seal any open pack, then classic sealed ingest."
  [state root pname buf]
  (seal-open-pack! state root)
  (let [old-next (get-in (:manifest (:vol @state)) [:nextPack] 0)
        new-vol (:vol (ingest-buffer (:vol @state) pname buf))
        new-manifest (:manifest new-vol)
        fm (get (:files new-manifest) pname)
        fresh (filterv #(>= (:pack-index %) old-next)
                       (:packs new-manifest))]
    (swap! state assoc :vol new-vol)
    (mark-dirty! state root
                 {:op "put" :name pname :file fm
                  :packs fresh
                  :nextPack (:nextPack new-manifest)})))

(defn- serve-put [state root pname req res]
  (valid-name! pname)
  (let [chunks (atom []) total (atom 0) failed (atom false)]
    (.on req "data" (fn [c]
                       (swap! total + (.-length c))
                       (if (> @total max-put-bytes)
                         (do (reset! failed true) (.writeHead res 413) (.end res) (.destroy req))
                         (swap! chunks conj c))))
    (.on req "end" (fn []
      (when-not @failed
        (try
          (put-sealed! state root pname (js/Buffer.concat (clj->js @chunks)))
          (when (:remote (:vol @state)) (swap! state assoc :sync-dirty true))
          (.writeHead res 201 (clj->js {"X-Awai-Durability" "local-checkpoint"
                                      "X-Awai-Commit" (str (get-in @state [:vol :basis]))}))
          (.end res)
          (catch :default e
            (swap! state assoc :failed? true)
            (.writeHead res 500) (.end res "write failed; restart and inspect committed root"))))))))

(defn- make-handler
  "Shared HTTP/WebDAV handler for serve and daemon."
  [state root]
  (fn [req res]
                   (try
                     (let [method (.-method req)
                           raw-path (first (str/split (.-url req) "?"))
                           decoded (js/decodeURIComponent raw-path)
                           dname (if (str/starts-with? decoded "/")
                                   (subs decoded 1) decoded)]
                       (cond
                         (:failed? @state)
                         (do (.writeHead res 503) (.end res "restart required; inspect committed root"))

                         (nil? (request-principal req (volume-tokens)))
                         (do (.writeHead res 401) (.end res "auth required"))

                         (and (not (contains? #{"" "__stats" "__gc"} dname))
                              (try (valid-name! (str/replace dname #"/$" "")) false
                                   (catch :default _ true)))
                         (do (.writeHead res 400) (.end res "invalid logical path"))

                         (= raw-path "/__stats")
                         (when-not (deny-owner! req res) (serve-stats state res))

                         (= method "OPTIONS")
                         (do (.writeHead res 200
                               (clj->js {"DAV" "1"
                                         "Allow" "OPTIONS,HEAD,GET,PUT,POST,DELETE,MKCOL,PROPFIND,PROPPATCH,MOVE,COPY"}))
                             (.end res))

                         (contains? #{"LOCK" "UNLOCK"} method)
                         (do (.writeHead res 501) (.end res "WebDAV locks are not implemented"))

                         (= method "PROPPATCH")
                         (if (deny-write-state! state dname req res)
                           nil
                           (serve-proppatch state root dname req res))

                         (= method "MKCOL")
                         (if (deny-write-state! state dname req res)
                           nil
                           (do (.writeHead res 501) (.end res "explicit collections are not implemented")))

                         (= method "PROPFIND")
                         (serve-propfind state dname
                                         (or (aget (.-headers req) "depth") "1") req res)

                         (= method "GET")
                         (serve-get state dname req res false)

                         (= method "HEAD")
                         (serve-get state dname req res true)

                         (= method "PUT")
                         (if (deny-write-state! state dname req res)
                           nil
                           (serve-put state root dname req res))

                         (= method "DELETE")
                         (let [files (get-in @state [:vol :manifest :files])
                               victims (if (contains? files dname) [dname]
                                         (filter #(str/starts-with? % (str (str/replace dname #"/$" "") "/")) (keys files)))]
                           (if (some #(not (allowed? (get files %) req "write")) victims)
                             (do (.writeHead res 403) (.end res "collection contains denied file"))
                             (if (deny-write-state! state dname req res) nil
                               (serve-delete state root (str/replace dname #"/$" "") res))))

                         (= method "MOVE")
                         (if (or (deny-read-state! state dname req res)
                                 (deny-write-state! state dname req res)
                                 (deny-write-state! state (dest-path (aget (.-headers req) "destination") req) req res))
                           nil
                           (serve-move state root dname req res))

                         (= method "COPY")
                         (if (or (deny-read-state! state dname req res)
                                 (deny-write-state! state (dest-path (aget (.-headers req) "destination") req) req res))
                           nil
                           (serve-copy state root dname req res))

                         (and (= method "POST") (= raw-path "/__gc"))
                         (when-not (deny-owner! req res) (serve-gc state root req res))

                         :else
                         (do (.writeHead res 405) (.end res))))
                     (catch :default e
                       (try (.writeHead res 500) (.end res "request rejected")
                            (catch :default _ nil))))))

(defn- start-flush-timer!
  "Compatibility timer; acknowledged writes already checkpoint synchronously."
  [state root]
  (.setInterval js/global
                (fn []
                  (when (pos? (or (:dirty @state) 0))
                    (flush-state! state root)))
                1000))

(defn- sync-tick!
  "Upload missing packs plus one manifest snapshot when the volume
  changed since the last successful sync. Failures stay dirty and are
  retried on the next tick; the local disk is always ahead, so a crash
  only delays the remote copy (boot marks dirty for catch-up)."
  [state root]
  (try
    (when (and (:sync-dirty @state)
               (some? (:remote (:vol @state))))
      ;; Seal first: the tier must never see a growing pack.
      (seal-open-pack! state root)
      (let [remote (:remote (:vol @state))
            snap (str "snap-tick-" (.now js/Date))
            {:keys [objects]} (sync-vol! (:vol @state) root remote snap)]
        (swap! state assoc :sync-dirty false :last-snapshot snap)
        (println "background sync" snap "objects:" objects)))
    (catch :default e
      (println "background sync failed:" (.-message e)))))

(defn- start-sync-timer!
  "Run the durable-tier catch-up at most every 5s, and only while the
  volume changed since the last successful sync."
  [state root]
  (.setInterval js/global
                (fn [] (sync-tick! state root))
                5000))

(defn cmd-serve [root port dest]
  (let [has-remote? (some? dest)
        ;; Fail closed on malformed token env before listening.
        tokens (volume-tokens)
        state (atom {:vol (load-volume root (when has-remote? (resolve-remote dest)))
                     :dirty 0
                     ;; Boot catch-up: reconcile the tier on first tick.
                     :sync-dirty has-remote?})
        server (.createServer node-http (make-handler state root))]
    (start-flush-timer! state root)
    (start-sync-timer! state root)
    (.listen server port "127.0.0.1"
      (fn [] (println "AWAI_READY" (js/JSON.stringify #js {:port (.-port (.address server))}))))))

(defn- usage []
  (println "usage: awaivol <init|put|get|delete|gc|repack|sync|fetch|evict|serve> ...")
  (println "  init <root>")
  (println "  put <root> <name> <file> [dest]   (dest enables PUT autosync)")
  (println "  get <root> <name> <out> [offset] [length]")
  (println "  delete <root> <name>")
  (println "  link <root> <src> <dst>   (share chunks, keep meta+acl)")
  (println "  propset <root> <file> <prefix:name> <ns> <value>")
  (println "  propdel <root> <file> <prefix:name>")
  (println "  propget <root> <file>")
  (println "  gc <root> [dest]")
  (println "  repack <root> <name> [threshold]")
  (println "  sync <root> <dest> [snapshot]   (dest: local dir, or b2)")
  (println "  fetch <root> <dest> <name>")
  (println "  evict <root> <dest> [name]")
  (println "  serve <root> [port] [dest]")
  (println "  inspect <root>"))


(defn cmd-sync [root dest snapshot]
  "Upload missing packs plus a manifest snapshot to the durable tier at
  `dest` (local dir, or b2 with AWAI_B2_* env). Per-pack actions are
  independent — execute-uploads runs them through the backend, which
  pages B2 large uploads by :max-part. Re-running only uploads what
  the remote listing still lacks."
  (let [remote (resolve-remote dest)
        vol (load-volume root remote)
        {:keys [snapshot objects]} (sync-vol! vol root remote snapshot)]
    (println "synced" root "->" dest "snapshot:" snapshot
             "objects:" objects)))

(defn cmd-fetch [root dest fname]
  "Drive-style on-demand restore: download the packs of `fname` that are
  missing locally but present on the durable tier. The manifest already
  lists them, so the file becomes readable without touching other data."
  (let [remote (resolve-remote dest)
        vol (load-volume root remote)
        fm (:manifest (file-entry vol fname))]
    (when (nil? fm)
      (throw (ex-info "no such file" {:file fname})))
    (let [remote (resolve-remote dest)
          remote-objects (set ((:list-objects remote) "packs/"))
          packs (distinct (map :pack (:entries fm)))]
      (doseq [[pi obj] (map (fn [pi] [pi (tr/pack-object-key pi)]) packs)]
        (when (and (not (.existsSync fs (pack-path root pi)))
                   (contains? remote-objects obj))
          (ensure-local-pack root remote pi obj
                             (first (filter #(= pi (:pack-index %)) (get-in vol [:manifest :packs]))))))
      (println "fetched" fname "packs:"
               (mapv first (filter (fn [[pi _]]
                                     (.existsSync fs (pack-path root pi)))
                                   (map (fn [pi] [pi]) packs)))))))

(defn- journal-pack-indices [_root] #{})

(defn cmd-evict [root dest fname]
  (let [vol (load-volume root) remote (resolve-remote dest)
        wanted (if fname
                 (let [fm (:manifest (file-entry vol fname))]
                   (when-not fm (throw (ex-info "no such file" {:type :awai.fs/not-found})))
                   (set (map :pack (:entries fm))))
                 (set (map :pack-index (get-in vol [:manifest :packs]))))
        packs (filterv #(contains? wanted (:pack-index %)) (get-in vol [:manifest :packs]))]
    ;; Verify the entire selected operation before evicting any local bytes.
    (doseq [p packs]
      (let [got ((:get-object remote) (tr/pack-object-key (:pack-index p)))]
        (when-not (and got (= (:bytes p) (if (js/Buffer.isBuffer got) (.-length got) (count got))) (= (:sha p) (rm/bytes-sha256 got)))
          (throw (ex-info "cache eviction has no verified backend copy" {:type :awai.fs/not-durable})))))
    (doseq [p packs] (nsio/regular! (pack-path root (:pack-index p))))
    (doseq [p packs] (.unlinkSync fs (pack-path root (:pack-index p))))
    (nsio/sync-dir! (pjoin root "packs"))
    (println "cache-evicted" (count packs) "backend-acknowledged only; no distributed policy receipt")))

(defn cmd-gc [root _dest]
  (let [vol (load-volume root)]
    (save-volume (:vol (gc-vol-state vol root)))
    (println "gc collected" (collect-local! root) "retained both committed root generations")))

(defn cmd-repack [root fname threshold & [media]]
  (let [vol (load-volume root)
        {:keys [manifest]} (file-entry vol fname)
        _ (when (nil? manifest) (throw (ex-info "no such file" {:file fname})))
        live (into #{} (map :index (:entries manifest)))
        opts {:threshold (or threshold 0.6) :pack-base (:nextPack (:manifest vol)) :force? (boolean media)}
        plan (if media (tr/repack-plan-for-class manifest live media opts)
                       (tr/repack-plan manifest live opts))
        backend (fs-backend vol)
        get-range (:get-range backend)
        ;; New-pack entries point at fresh locations; source bytes live
        ;; at the OLD locations in the file manifest, keyed by :index.
        old-loc (into {} (map (fn [e] [(:index e)
                                       (select-keys e [:pack :pack-offset :length])]))
                      (:entries manifest))
        new-packs
        (mapv (fn [p]
                (let [occurrences
                      (mapv (fn [e]
                              (let [old (get old-loc (:index e))]
                                (when (nil? old)
                                  (throw (ex-info "missing pack bytes during repack"
                                                  {:pack (:pack-index p)
                                                   :index (:index e)})))
                                {:sha (:sha e)
                                 :bytes (pack-range-read
                                         vol (:pack old)
                                         (tr/pack-object-key (:pack old))
                                         (:pack-offset old) (:length old)
                                         get-range
                                         (fn []
                                           (when-let [remote (:remote vol)]
                                             (ensure-local-pack
                                              (:root vol) remote
                                              (:pack old)
                                              (tr/pack-object-key (:pack old))
                                              (first (filter #(= (:pack old) (:pack-index %))
                                                             (get-in vol [:manifest :packs])))))))}))
                            (sort-by :pack-offset (:entries p)))
                      physical (write-car-pack! root (:pack-index p) occurrences)]
                  (merge p physical)))
              (:new-packs plan))]
    (let [fm (cond-> (:manifest plan) media (assoc :physical-profile {:version 1 :media-class media}))
          _ (when-not (= (cp/logical-view manifest) (cp/logical-view fm))
              (throw (ex-info "repack changed logical identity" {:type :awai.fs/logical-identity-changed})))
          files (assoc (get-in vol [:manifest :files]) fname (assoc fm :mtime (.now js/Date)))
          live-packs (set (map :pack (mapcat :entries (vals files))))
          catalog (into (filterv #(live-packs (:pack-index %)) (get-in vol [:manifest :packs]))
                        (mapv #(select-keys % [:pack-index :bytes :sha :format :root-cid]) new-packs))
          next-manifest (-> (:manifest vol) (assoc :files files :packs catalog)
                            (update :nextPack + (count new-packs)) rebuild-chunk-index)]
      (save-volume (assoc vol :manifest next-manifest))
      (println "repacked" fname "new packs:" (mapv :pack-index new-packs)
               "logical-identity unchanged; old packs retained for root retention"))))

(defn cmd-inspect [root]
  (let [vol (load-volume root)]
    (println (js/JSON.stringify (clj->js {:basis (:basis vol) :degraded (:degraded? vol)
                                         :files (into {} (map (fn [[name fm]] [name (cp/logical-view fm)]))
                                                         (get-in vol [:manifest :files]))
                                         :catalog (get-in vol [:manifest :packs])})))) )

(defn- cli-uint [value]
  (let [n (js/Number value)]
    (when-not (and (string? value) (re-matches #"0|[1-9][0-9]*" value) (js/Number.isSafeInteger n))
      (throw (ex-info "expected bounded unsigned decimal integer" {}))) n))

(let [[cmd a b c d e f g] *command-line-args*]
  (case cmd
    "init" (cmd-init a (if b (cli-uint b) default-leaf-size))
    "put" (cmd-put a b c d)
    "get" (cmd-get a b c (when d (cli-uint d)) (when e (cli-uint e)))
    "delete" (cmd-delete a b)
    "link" (cmd-link a b c)
    "propset" (cmd-propset a b c d e)
    "propdel" (cmd-propdel a b c)
    "propget" (cmd-propget a b)
    "aclset" (cmd-aclset a b c)
    "aclget" (cmd-aclget a b)
    "gc" (cmd-gc a b)
    "repack" (cmd-repack a b (when c (js/Number c)) (when d (keyword d)))
    "inspect" (cmd-inspect a)
    "sync" (cmd-sync a b c)
    "fetch" (cmd-fetch a b c)
    "evict" (cmd-evict a b c)
    "serve" (cmd-serve a (if b (cli-uint b) 8585) c)
    "daemon" (throw (ex-info "legacy mount supervision is outside the pinned Linux volume contract" {}))
    "daemon-install" (throw (ex-info "legacy launchd installation is outside the pinned Linux volume contract" {}))
    (usage)))
