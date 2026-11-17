(ns awai.fs.remote
  "B2-backed durable execution: backend protocol, idempotent executor,
  multipart part planning.

  Backends (B2, S3-compatible, local dir, memory) are plain maps of fns:

    :put-object  [key value]      -> {:etag s :bytes n}
    :get-object  [key]            -> value or nil
    :get-range   [key offset len] -> value or nil
    :delete-object [key]          -> true
    :list-objects [prefix]       -> [keys]
    :head-object [key]            -> {:bytes n} or nil
    :max-part    bytes or nil    -> multipart part ceiling (nil = one PUT)

  Values are opaque to the executor; verification (CID, AEAD open,
  decompression) stays with the caller, which owns keys and plaintext.

  The executor runs tier plans through a backend with an idempotency
  journal (a set of op ids the caller persists): completed ops are
  skipped, new receipts recorded. Re-running a crashed run resumes it.

  B2 mapping (wire adapter's contract, not this namespace's I/O):
  packs/manifests are objects; small uploads are one b2_upload_file;
  larger ones use b2_start_large_file/b2_upload_part per :max-part;
  reads are download-by-name with an HTTP Range; deletes are
  b2_delete_file_version; lists are b2_list_file_names; existence is a
  download HEAD. Auth and endpoint selection stay in the adapter."
  (:require [clojure.string :as str]
            [awai.fs.hot-cache :as cache])
  #?(:clj (:import (clojure.lang ExceptionInfo))))

(def ^:const default-max-attempts
  "How many times one op is tried before the executor gives up."
  5)

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn- byte-count
  "Length of a backend value (byte-vec or, on :cljs, Node Buffer)."
  [v]
  #?(:clj (count v)
     :cljs (if (js/Buffer.isBuffer v) (.-length v) (count v))))

(defn- slice-value
  "Sub-range [offset, offset+length) of a backend value, same kind in/out:
  Buffer slices stay Buffers, vecs stay vecs."
  [v offset length]
  #?(:clj (into [] (comp (drop offset) (take length)) v)
     :cljs (if (js/Buffer.isBuffer v)
             (.slice v offset (+ offset length))
             (into [] (comp (drop offset) (take length)) v))))

(defn bytes-sha256
  "Hosted byte checksum for storage receipts, not a new CID encoding."
  [v]
  #?(:clj (apply str (map #(format "%02x" (bit-and 255 %))
                          (.digest (java.security.MessageDigest/getInstance "SHA-256")
                                   (byte-array (map unchecked-byte v)))))
     :cljs (.digest (.update (.createHash (js/require "crypto") "sha256")
                             (if (js/Buffer.isBuffer v) v (js/Buffer.from (clj->js v)))) "hex")))

(defn- verify-read! [action value expected-length]
  (when (or (nil? value) (not= expected-length (byte-count value)))
    (fail! :awai.fs/short-read "awai fs: incomplete backend/cache read" {}))
  (when (and (:sha action) (not= (:sha action) (bytes-sha256 value)))
    (fail! :awai.fs/cid-mismatch "awai fs: backend/cache chunk checksum differs" {}))
  value)

(defn- relative-key! [k prefix?]
  (when-not (and (string? k) (<= (count k) 4096)
                 (not (re-find #"[\\\u0000-\u001f\u007f]" k))
                 (not (str/starts-with? k "/"))
                 (not (re-find #"^[A-Za-z]:" k))
                 (or prefix? (seq k))
                 (let [s (if (and prefix? (str/ends-with? k "/")) (subs k 0 (dec (count k))) k)]
                   (or (and prefix? (empty? s))
                       (not-any? #{"" "." ".."} (str/split s #"/" -1)))))
    (fail! :awai.fs/invalid-prefix "awai fs: object key must remain inside its namespace" {}))
  k)

(defn memory-backend
  "In-process backend for tests and offline runs. `store` is an atom
  holding key -> value. Every call is appended to (:log backend)."
  ([]
   (memory-backend (atom {})))
  ([store]
   (let [log (atom [])]
     {:kind :memory
      :identity (str "memory:" (random-uuid))
      :store store
      :log log
      :max-part nil
      :put-object (fn [key value]
                    (swap! log conj [:put key])
                    (swap! store assoc key value)
                    {:etag (str "etag-" (hash value)) :bytes (count value)})
      :get-object (fn [key]
                    (swap! log conj [:get key])
                    (get @store key))
      :get-range (fn [key offset length]
                  (swap! log conj [:range key offset length])
                  (let [v (get @store key)]
                    (when (some? v)
                      (into [] (comp (drop offset) (take length)) v))))
      :delete-object (fn [key]
                       (swap! log conj [:delete key])
                       (swap! store dissoc key)
                       true)
      :list-objects (fn [prefix]
                      (swap! log conj [:list prefix])
                      (into [] (filter #(str/starts-with? % prefix))
                            (keys @store)))
      :put-part (fn [object-key n bytes]
                  (swap! log conj [:put-part object-key n])
                  (swap! store assoc (str object-key "#part" n) bytes)
                  {:etag (str "etag-part-" n) :bytes (count bytes)})
      :complete-multipart (fn [object-key nparts]
                            (swap! log conj [:complete object-key nparts])
                            (let [whole (into []
                                              (mapcat #(get @store (str object-key "#part" %)))
                                              (range nparts))]
                              (swap! store assoc object-key whole)
                              (doseq [n (range nparts)]
                                (swap! store dissoc (str object-key "#part" n)))
                              {:etag (str "etag-mp-" nparts) :bytes (count whole)}))
      :head-object (fn [key]
                     (swap! log conj [:head key])
                     (let [v (get @store key)]
                       (when (some? v)
                         {:bytes (count v)})))})))

(defn dir-backend
  "Local-directory durable tier: an offline stand-in for B2 with the
  same backend contract. `root` holds object keys as relative file
  paths (e.g. packs/pack-0.car). Values are byte-vecs; :get-range uses
  positioned reads so fetches never load whole objects."
  [root]
  (let [base #?(:clj (let [f (java.io.File. root)] (.mkdirs f) (.getCanonicalFile f))
                :cljs (let [fs (js/require "fs")]
                        (.mkdirSync fs root #js {:recursive true}) (.realpathSync fs root)))
        fpath (fn [object-key]
                (relative-key! object-key false)
                #?(:clj (loop [p (.toPath base) parts (str/split object-key #"/")]
                          (if (empty? parts) (.toFile p)
                            (let [next (.resolve p ^String (first parts))]
                              (when (java.nio.file.Files/isSymbolicLink next)
                                (fail! :awai.fs/unsafe-path "awai fs: symlink in backend object path" {}))
                              (recur next (rest parts)))))
                   :cljs (let [path (js/require "path") fs (js/require "fs")]
                           (reduce (fn [p s]
                                     (let [next (.join path p s)
                                           st (try (.lstatSync fs next) (catch :default e
                                                                             (when-not (= "ENOENT" (.-code e)) (throw e))))]
                                       (when (and st (.isSymbolicLink st))
                                         (fail! :awai.fs/unsafe-path "awai fs: symlink in backend object path" {}))
                                       next)) base (str/split object-key #"/")))))]
    {:kind :dir
     :identity (str "dir:" base)
     :store root
     :max-part nil
     :put-object (fn [object-key value]
                   #?(:clj (let [f ^java.io.File (fpath object-key)
                                 bytes (byte-array (map unchecked-byte value))]
                             (.mkdirs (.getParentFile f))
                             (java.nio.file.Files/write
                              (.toPath f) bytes
                              (into-array java.nio.file.OpenOption []))
                             {:etag (str "dir-" (hash value))
                              :bytes (count value)})
                      :cljs (let [fs (js/require "fs")
                                  path (js/require "path")
                                  f (fpath object-key)
                                  ;; Zero-copy: Buffers pass straight to
                                  ;; writeFileSync; legacy vecs convert once.
                                  buf (if (js/Buffer.isBuffer value)
                                        value
                                        (js/Buffer.from (clj->js value)))]
                              (.mkdirSync fs (.dirname path f)
                                          #js {:recursive true})
                              (.writeFileSync fs f buf)
                              {:etag (str "dir-" object-key)
                               :bytes (.-length buf)})))
     :get-object (fn [object-key]
                   #?(:clj (let [f ^java.io.File (fpath object-key)]
                             (when (.exists f)
                               (mapv #(bit-and 255 %) (java.nio.file.Files/readAllBytes (.toPath f)))))
                      :cljs (let [fs (js/require "fs")
                                  f (fpath object-key)]
                              (when (.existsSync fs f)
                                (.readFileSync fs f)))))
     :get-range (fn [object-key offset length]
                  #?(:clj (let [f ^java.io.File (fpath object-key)]
                            (when (.exists f)
                              (with-open [ch (java.nio.channels.FileChannel/open
                                              (.toPath f)
                                              (into-array java.nio.file.OpenOption
                                                          [java.nio.file.StandardOpenOption/READ]))]
                                (let [buf (java.nio.ByteBuffer/allocate length)
                                      _ (.read ch buf (long offset))
                                      _ (.flip buf)
                                      n (.remaining buf)
                                      arr (byte-array n)]
                                  (.get buf arr)
                                  (mapv #(bit-and 255 %) arr)))))
                     :cljs (let [fs (js/require "fs")
                                 f (fpath object-key)]
                             (when (.existsSync fs f)
                               (let [fd (.openSync fs f "r")
                                     buf (js/Buffer.alloc length)]
                                 (try
                                   (let [n (.readSync fs fd buf 0 length offset)]
                                     (.slice buf 0 n))
                                   (finally (.closeSync fs fd))))))))
     :delete-object (fn [object-key]
                      #?(:clj (let [f ^java.io.File (fpath object-key)]
                                (when (.exists f) (.delete f))
                                true)
                         :cljs (let [fs (js/require "fs")
                                     f (fpath object-key)]
                                 (when (.existsSync fs f) (.unlinkSync fs f))
                                 true)))
     :list-objects (fn [prefix]
                     (relative-key! prefix true)
                     #?(:clj (let [base (java.nio.file.Paths/get
                                         ^String (str base)
                                         (into-array String []))]
                               (if (java.nio.file.Files/exists
                                    base
                                    (into-array java.nio.file.LinkOption []))
                                 (into []
                                       (comp (map #(.toString
                                                    (.relativize base ^java.nio.file.Path %)))
                                             (filter #(str/starts-with? % prefix)))
                                       (with-open [s (java.nio.file.Files/walk
                                                      base
                                                      (into-array java.nio.file.FileVisitOption []))]
                                         (filterv (fn [p]
                                                    (when (java.nio.file.Files/isSymbolicLink p)
                                                      (fail! :awai.fs/unsafe-path "awai fs: symlink in backend listing" {}))
                                                    (java.nio.file.Files/isRegularFile
                                                     p
                                                     (into-array java.nio.file.LinkOption [])))
                                                  (iterator-seq (.iterator s)))))
                                 []))
                        :cljs (let [fs (js/require "fs")
                                      path (js/require "path")
                                      walk (fn walk [dir acc]
                                             (reduce (fn [a n]
                                                       (let [p (.join path dir n)]
                                                         (when (.isSymbolicLink (.lstatSync fs p))
                                                           (fail! :awai.fs/unsafe-path "awai fs: symlink in backend listing" {}))
                                                         (if (.isDirectory (.lstatSync fs p))
                                                           (walk p a)
                                                           (conj a (.relative path base p)))))
                                                     acc (.readdirSync fs dir)))]
                                (if (.existsSync fs root)
                                  (filterv #(str/starts-with? % prefix)
                                           (walk base []))
                                  []))))
     :head-object (fn [object-key]
                    #?(:clj (let [f ^java.io.File (fpath object-key)]
                              (when (.exists f) {:bytes (.length f)}))
                       :cljs (let [fs (js/require "fs")
                                   f (fpath object-key)]
                               (when (.existsSync fs f)
                                 {:bytes (.-size (.statSync fs f))}))))}))

(defn plan-parts
  "Split `total-bytes` into multipart ranges of at most `max-part`
  bytes: [{:part n :offset :length}]. A nil ceiling means one part."
  [object-key total-bytes max-part]
  (when (or (not (integer? total-bytes)) (neg? total-bytes))
    (fail! :awai.fs/invalid-size "awai fs: total bytes must be non-negative"
           {:bytes total-bytes}))
  (when (some? max-part)
    (when (or (not (integer? max-part)) (<= max-part 0))
      (fail! :awai.fs/invalid-part "awai fs: max part must be positive"
             {:max-part max-part})))
  (if (or (nil? max-part) (<= total-bytes max-part) (zero? total-bytes))
    [{:part 0 :object object-key :offset 0 :length total-bytes}]
    (mapv (fn [n]
            {:part n
             :object object-key
             :offset (* n max-part)
             :length (min max-part (- total-bytes (* n max-part)))})
          (range (quot (+ total-bytes (dec max-part)) max-part)))))

(defn- put-value
  [backend object-key value max-part]
  (let [total (byte-count value)
        parts (plan-parts object-key total max-part)]
    (if (= 1 (count parts))
      ((:put-object backend) object-key value)
      (let [put-part (:put-part backend)
            complete (:complete-multipart backend)]
        (when (or (nil? put-part) (nil? complete))
          (fail! :awai.fs/no-multipart
                 "awai fs: backend cannot multipart-upload this size"
                 {:object object-key :bytes total}))
        (doseq [{:keys [part offset length]} parts]
          (put-part object-key part (slice-value value offset length)))
        (assoc (complete object-key (count parts)) :parts (count parts))))))

(defn run-with-retry
  "Run zero-arg `thunk` until it returns {:ok v}, retrying {:error _}
  results and thrown exceptions up to :attempts times. :sleep-fn is
  called with the pre-try wait (inject a no-op in tests)."
  [thunk {:keys [attempts sleep-fn] :or {attempts default-max-attempts
                                         sleep-fn (fn [_ms])}}]
  (when (or (not (integer? attempts)) (< attempts 1))
    (fail! :awai.fs/invalid-attempts "awai fs: attempts must be at least 1"
           {:attempts attempts}))
  (loop [n 1]
    (let [result (try
                   (let [r (thunk)]
                     ;; {:ok _} passes through; {:error _} retries;
                     ;; any other value is a direct success.
                     (if (and (map? r) (or (contains? r :ok)
                                           (contains? r :error)))
                       r
                       {:ok r}))
                   (catch #?(:clj Exception :cljs js/Error) e
                     (if (>= n attempts)
                       (throw e)
                       {:error e})))]
      (if (contains? result :ok)
        (:ok result)
        (if (>= n attempts)
          (fail! :awai.fs/retries-exhausted "awai fs: op failed after retries"
                 {:attempts attempts :last (:error result)})
          (do (sleep-fn (* n 100))
              (recur (inc n))))))))

(defn execute-uploads
  "Execute an `upload-plan` (from tier) through `backend`, skipping ops
  already in `journal` (a set of op ids). Returns {:journal :receipts}.
  Actions may carry bytes as opaque `:bytes-buffer` (e.g. a Node Buffer
  threaded through without conversion) or `:bytes-value` (byte-vec, or a
  Buffer); `:bytes-buffer` wins when both are present."
  [backend journal plan max-part]
  ;; Validate the *whole* publication before sending any bytes. A missing
  ;; payload must never become an invented all-zero object.
  (let [actions (vec (concat (:packs plan) [(:manifest plan)]))
        prepared (mapv (fn [action]
                         (let [value (or (:bytes-buffer action) (:bytes-value action))]
                           (when-not (and (map? action) (= :upload (:action action))
                                          (contains? #{:pack :manifest} (:kind action))
                                          (string? (:object action)) (some? value))
                             (fail! :awai.fs/invalid-upload "awai fs: upload needs actual bytes and object identity" {}))
                           (relative-key! (:object action) false)
                           (when-not #?(:clj (and (sequential? value) (every? #(and (integer? %) (<= 0 % 255)) value))
                                        :cljs (or (js/Buffer.isBuffer value)
                                                  (and (sequential? value) (every? #(and (integer? %) (<= 0 % 255)) value))))
                             (fail! :awai.fs/invalid-upload "awai fs: payload must contain unsigned bytes" {}))
                           (when (and (some? (:bytes action)) (not= (:bytes action) (byte-count value)))
                             (fail! :awai.fs/invalid-upload "awai fs: upload byte count differs" {}))
                           (let [frozen #?(:clj (vec value)
                                           :cljs (if (js/Buffer.isBuffer value) (js/Buffer.from value) (vec value)))]
                             (assoc action :payload frozen :content-sha (bytes-sha256 frozen)))))
                       actions)
        scope (:identity backend)]
    (when-not (and (string? scope) (seq scope))
      (fail! :awai.fs/invalid-backend "awai fs: upload journal needs a backend identity" {}))
    (reduce
     (fn [{:keys [journal receipts] :as acc} action]
       (let [op-id [:upload scope (:kind action) (:object action) (:content-sha action)]
             existing ((:get-object backend) (:object action))
             _ (when (and (some? existing)
                           (not= (:content-sha action) (bytes-sha256 existing)))
                 (fail! :awai.fs/immutable-object-conflict "awai fs: refusing to overwrite a published object with different bytes" {}))]
         (if (and (contains? journal op-id) (some? existing))
           acc
           (let [value (:payload action)
                 receipt (if (some? existing)
                           {:bytes (byte-count existing) :reused true}
                           (run-with-retry
                          #(put-value backend (:object action) value
                                      (or max-part (:max-part backend)))
                          {}))]
             (when-not (= (byte-count value) (:bytes receipt))
               (fail! :awai.fs/invalid-receipt "awai fs: backend receipt byte count differs" {}))
             (when-not (= (:content-sha action) (some-> ((:get-object backend) (:object action)) bytes-sha256))
               (fail! :awai.fs/cid-mismatch "awai fs: uploaded object failed read-back checksum" {}))
             {:journal (conj journal op-id)
              :receipts (conj receipts (assoc receipt :op op-id :kind (:kind action)
                                              :object (:object action) :content-sha (:content-sha action)
                                              :durability :backend-acknowledged))}))))
     {:journal journal :receipts []}
     prepared)))

(defn- serve-read
  "Serve a :read-cache action from the hot cache."
  [action cache results]
  (let [[cache' hit?] (cache/cache-lookup cache [:chunk (:chunk action)])
        stored (get-in cache' [:store [:chunk (:chunk action)] :value])
        _ (when-not hit? (fail! :awai.fs/cache-miss "awai fs: planned cache hit vanished" {}))
        _ (verify-read! action stored (:size (get-in cache' [:store [:chunk (:chunk action)]])))
        skip (when (some? stored) (- (:read-offset action) (:offset action)))
        bytes (when (some? stored)
                (slice-value stored skip (:read-length action)))]
    {:cache cache'
     :results (conj results {:chunk (:chunk action)
                             :read-offset (:read-offset action)
                             :read-length (:read-length action)
                             :bytes bytes
                             :from (if hit? :cache :cache-miss)})}))

(defn- serve-fetch
  "Serve a :fetch-remote action from the backend and admit the chunk."
  [backend action cache results]
  (let [got ((:get-range backend) (:object action)
              (:pack-offset action) (:length action))]
    (when (nil? got)
      (fail! :awai.fs/not-durable "awai fs: remote range vanished mid-read"
             {:object (:object action) :chunk (:chunk action)}))
    (verify-read! action got (:length action))
    (let [skip (- (:read-offset action) (:offset action))
          read-bytes (slice-value got skip (:read-length action))]
      {:cache (first (cache/cache-insert cache [:chunk (:chunk action)]
                                         (:length action) got))
       :results (conj results {:chunk (:chunk action)
                               :read-offset (:read-offset action)
                               :read-length (:read-length action)
                               :bytes read-bytes
                               :from :remote})})))

(defn execute-demand
  "Execute a `demand-plan` (from tier) through `backend`, threading the
  hot `cache` through. Returns {:cache :results} where each result is
  {:chunk :read-offset :read-length :bytes :from} (`:cache` or `:remote`)."
  [backend cache plan]
  (reduce
   (fn [{:keys [cache results]} action]
     (case (:action action)
       :read-cache (serve-read action cache results)
       :fetch-remote (serve-fetch backend action cache results)))
   {:cache cache :results []}
   (:actions plan)))

;; Per-volume key prefix: many volumes, one shared bucket.
;;
;; Plan keys stay flat ("packs/pack-0.car"); storage keys are qualified
;; under "prefix/" so the same plan key from two volumes never
;; overwrites one bucket object. `with-prefix` wraps any backend map
;; (dir, B2 without its own opts, memory); B2 also accepts {:prefix}
;; directly in `b2-backend` for the same math. A bad prefix fails
;; closed; "" keeps the flat layout.

(defn normalize-prefix
  "Validate a raw volume prefix; return \"\" or \"a/b/\". Rejects
  absolute paths, \"..\" escapes and empty segments."
  [prefix]
  (let [s (or prefix "")]
    (relative-key! s true)
    (if (empty? s)
      ""
      (let [segs (str/split s #"/")]
        (when (or (str/starts-with? s "/")
                  (some #(or (empty? %) (= ".." %)) segs))
          (fail! :awai.fs/invalid-prefix "awai fs: bad volume prefix"
                 {:prefix prefix}))
        (str (str/join "/" segs) "/")))))

(defn qualify-key
  "Storage key for plan key `k` under normalized prefix `px`.
  Rejects absolute or escaping plan keys (dir-backend resolves them
  against the filesystem root)."
  [px k]
  (relative-key! k true)
  (let [segs (str/split (or k "") #"/")]
    (when (or (str/starts-with? (or k "") "/")
              (some #(= ".." %) segs)
              (empty? k))
      (fail! :awai.fs/invalid-prefix "awai fs: bad object key for prefix"
             {:prefix px :key k}))
    (str px k)))

(defn strip-prefix
  "Inverse of qualify-key: plan key, or nil when `storage-key` lies
  outside `px` (lets listings filter foreign namespaces out). \"\"
  prefix is the identity."
  [px storage-key]
  (if (empty? px)
    storage-key
    (when (str/starts-with? storage-key px)
      (subs storage-key (count px)))))

(defn with-prefix
  "Wrap any backend map so callers keep using flat plan keys while
  storage keys live under `prefix/`. Listings strip the prefix back
  and drop keys from foreign namespaces."
  [backend prefix]
  (let [px (normalize-prefix prefix)
        qq (fn [k] (qualify-key px k))]
    (cond-> (assoc backend
                   :identity (str (:identity backend) "|prefix:" px)
                   :prefix px
                   :put-object (fn [k v] ((:put-object backend) (qq k) v))
                   :get-object (fn [k] ((:get-object backend) (qq k)))
                   :get-range (fn [k o l] ((:get-range backend) (qq k) o l))
                   :delete-object (fn [k] ((:delete-object backend) (qq k)))
                   :head-object (fn [k] ((:head-object backend) (qq k)))
                   :list-objects (fn [sub]
                                    (into []
                                          (keep #(strip-prefix px %))
                                          ((:list-objects backend) (str px (relative-key! (or sub "") true))))))
      (:put-part backend)
      (assoc :put-part (fn [k n b] ((:put-part backend) (qq k) n b))
             :complete-multipart (fn [k n] ((:complete-multipart backend) (qq k) n))))))
