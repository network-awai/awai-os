(ns awai.fs.node-store
  "Node-only Otehon management records: immutable checkpoint/WAL objects and
  atomic A/B roots. These JSON byte hashes are internal references, not CIDs.
  Every transaction checkpoints; no batching/performance claim is made."
  (:require [awai.fs.remote :as rm]))

(def fs (js/require "fs"))
(def path (js/require "path"))
(def crypto (js/require "crypto"))
(def max-record-bytes (* 1024 1024))
(def ^:dynamic *write-observer* nil)
(defn fail! [type message] (throw (ex-info message {:type type})))
(defn- json-value [v]
  (cond
    (map? v) (into (sorted-map) (map (fn [[k x]] [(if (keyword? k) (subs (str k) 1) (str k)) (json-value x)])) v)
    (sequential? v) (mapv json-value v)
    (keyword? v) (subs (str v) 1)
    :else v))
(defn json-bytes [v] (js/Buffer.from (js/JSON.stringify (clj->js (json-value v))) "utf8"))
(defn hash-bytes [v] (rm/bytes-sha256 v))
(defn digest? [v] (and (string? v) (boolean (re-matches #"[0-9a-f]{64}" v))))
(defn observe! [event role]
  (when *write-observer* (*write-observer* event role))
  ;; Disposable test children only opt into process-fault boundaries.
  (when (= (aget (.-env js/process) "AWAI_VOL_TEST_FAULT") (str (name role) ":" (name event)))
    (.writeSync fs 1 (str "AWAI_FAULT_READY " (name role) ":" (name event) "\n"))
    (js/Atomics.wait (js/Int32Array. (js/SharedArrayBuffer. 4)) 0 0 30000)
    (fail! :awai.fs/fault-timeout "fault driver did not terminate its own writer")))

(defn real-root! [root]
  (let [p (.resolve path root)]
    (when-not (and (.existsSync fs p) (.isDirectory (.lstatSync fs p))
                   (= p (.realpathSync fs p)))
      (fail! :awai.fs/unsafe-root "volume root must be a real directory without symlink ancestors"))
    p))
(defn regular! [filename]
  (let [st (try (.lstatSync fs filename)
                (catch :default e (if (= "ENOENT" (.-code e)) nil (throw e))))]
    (when (and st (not (.isFile st)))
      (fail! :awai.fs/unsafe-path "storage path must be a regular file")))
  filename)
(defn sync-dir! [dir]
  (let [fd (.openSync fs dir "r")]
    (try (.fsyncSync fs fd) (finally (.closeSync fs fd)))))
(defn- admit-disk-write! [root additional]
  ;; Retain pending/orphan evidence, but never allow repeated failures or
  ;; checkpoint history to grow this bounded comparison store indefinitely.
  (let [total (atom 0) entries (atom 0)]
    (doseq [dir [root (.join path root "packs") (.join path root ".state")]
            :when (.existsSync fs dir)
            name (.readdirSync fs dir)]
      (when (> (swap! entries inc) 8192) (fail! :awai.fs/resource-limit "volume entry bound exceeded"))
      (let [f (.join path dir name) st (.lstatSync fs f)]
        (cond (.isFile st) (swap! total + (.-size st))
              (and (= dir root) (contains? #{"packs" ".state"} name) (.isDirectory st)) nil
              :else (fail! :awai.fs/unsafe-path "unexpected directory or symlink in volume"))))
    (when (> (+ @total additional) (* 128 1024 1024))
      (fail! :awai.fs/resource-limit "volume disk budget exceeded; preserve and review retained evidence"))))
(defn write-atomic!
  "Force file, atomically rename, force directory. Pending evidence remains on
  failure. Only root records may replace an existing path."
  [filename bytes role replace?]
  (regular! filename)
  (if (and (not replace?) (.existsSync fs filename))
    (do (when-not (= (hash-bytes bytes) (hash-bytes (.readFileSync fs filename)))
          (fail! :awai.fs/immutable-object-conflict "immutable local object differs"))
        (sync-dir! (.dirname path filename)))
    (let [dir (.dirname path filename)
          root (if (= role :root) dir (.dirname path dir))
          _ (admit-disk-write! root (.-length bytes))
          tmp (.join path dir (str ".pending-" (.randomUUID crypto)))
          fd (.openSync fs tmp "wx" 384)
          half (quot (.-length bytes) 2)]
      (try
        (doseq [[start length event] [[0 half :half-written]
                                      [half (- (.-length bytes) half) :written]]]
          (loop [n 0]
            (when (< n length)
              (let [wrote (.writeSync fs fd bytes (+ start n) (- length n))]
                (when-not (pos? wrote) (fail! :awai.fs/short-write "storage write made no progress"))
                (recur (+ n wrote)))))
          (observe! event role))
        (.fsyncSync fs fd) (observe! :file-synced role)
        (finally (.closeSync fs fd)))
      (.renameSync fs tmp filename) (observe! :renamed role)
      (sync-dir! dir) (observe! :dir-synced role)))
  (hash-bytes bytes))

(defn- read-record [filename]
  (regular! filename)
  (when (> (.-size (.statSync fs filename)) max-record-bytes)
    (fail! :awai.fs/record-too-large "management record exceeds 1 MiB"))
  (.readFileSync fs filename))
(defn- object-path [root digest]
  (when-not (digest? digest) (fail! :awai.fs/invalid-digest "invalid management object reference"))
  (let [dir (.join path root ".state")]
    (when-not (and (.existsSync fs dir) (.isDirectory (.lstatSync fs dir)) (= dir (.realpathSync fs dir)))
      (fail! :awai.fs/unsafe-path "management directory is missing or symlinked")))
  (.join path root ".state" (str digest ".json")))
(defn- object! [root bytes role]
  (when (> (.-length bytes) max-record-bytes)
    (fail! :awai.fs/record-too-large "management object exceeds 1 MiB"))
  (let [digest (hash-bytes bytes)]
    (write-atomic! (object-path root digest) bytes role false)
    digest))
(defn- load-object [root digest]
  (let [filename (object-path root digest)]
    (when-not (.existsSync fs filename) (fail! :awai.fs/missing-object "committed management object is missing"))
    (let [bytes (read-record filename)]
      (when-not (= digest (hash-bytes bytes)) (fail! :awai.fs/corrupt-object "management object checksum differs"))
      (js->clj (js/JSON.parse (.toString bytes "utf8")) :keywordize-keys false))))
(defn- slot [root i]
  (let [filename (.join path root (str "root-" i ".json"))]
    (regular! filename)
    (when (.existsSync fs filename)
      (try
        (let [envelope (js->clj (js/JSON.parse (.toString (read-record filename) "utf8")))
              payload (get envelope "payload") digest (get envelope "digest")]
          (when-not (and (= #{"payload" "digest"} (set (keys envelope)))
                         (string? payload) (digest? digest)
                         (= digest (hash-bytes (js/Buffer.from payload "utf8"))))
            (fail! :awai.fs/corrupt-root "root envelope checksum differs"))
          (let [v (js->clj (js/JSON.parse payload)) n (get v "generation")]
            (when-not (= "awai.otehon.volume-root.v1" (get v "format"))
              (fail! :awai.fs/unsupported-root "unsupported root version"))
            (when-not (and (= #{"format" "generation" "snapshot" "wal" "catalog"} (set (keys v)))
                           (js/Number.isSafeInteger n) (pos? n) (= i (mod n 2))
                           (every? digest? [(get v "snapshot") (get v "wal") (get v "catalog")]))
              (fail! :awai.fs/corrupt-root "invalid root fields"))
            {:root v}))
        (catch :default e
          (if (= :awai.fs/unsupported-root (:type (ex-data e))) (throw e) {:error true}))))))
(defn- selected-root [root]
  (let [slots (mapv #(slot root %) [0 1])
        generations (sort (keep #(get-in % [:root "generation"]) slots))
        current (last (sort-by #(get % "generation") (keep :root slots)))]
    (when-not current (fail! :awai.fs/no-root "no committed v1 root; legacy volumes need explicit migration"))
    {:root current
     :initial? (and (nil? (first slots)) (= 1 (get-in slots [1 :root "generation"])))
     :degraded? (not (and (= 2 (count generations)) (= 1 (- (last generations) (first generations)))))}))

(defn read-state [directory]
  (let [root (real-root! directory)
        {:keys [root degraded? initial?]} (selected-root root)
        base (real-root! directory)
        snapshot (load-object base (get root "snapshot"))
        wal (load-object base (get root "wal"))
        generation (get root "generation")
        manifest (get snapshot "manifest")]
    (when-not (and (= "awai.otehon.volume-checkpoint.v1" (get snapshot "format"))
                   (= "awai.otehon.volume-wal.v1" (get wal "format"))
                   (= generation (get snapshot "generation") (get wal "generation"))
                   (= (get root "snapshot") (get wal "snapshot"))
                   (map? manifest)
                   (= (get root "catalog") (hash-bytes (json-bytes (get manifest "packs")))))
      (fail! :awai.fs/invalid-state "committed checkpoint/WAL/catalog binding differs"))
    {:manifest manifest :generation generation :degraded? degraded? :initial? initial? :root root}))

(defn commit!
  "Checkpoint-per-transaction: immutable WAL and snapshot precede the root.
  Caller validates immutable Pack references and holds the platform flock."
  [directory manifest event basis & [initializing?]]
  (when-not (= "1" (aget (.-env js/process) "AWAI_OTEHON_LOCKED"))
    (fail! :awai.fs/writer-lock-required "run through the pinned Otehon volume launcher"))
  (let [root (real-root! directory)
        current (when (or (.existsSync fs (.join path root "root-0.json"))
                           (.existsSync fs (.join path root "root-1.json")))
                  (read-state root))]
    (when (and (:degraded? current) (not (and initializing? (:initial? current))))
      (fail! :awai.fs/degraded-store "missing, damaged or nonconsecutive root slot requires review before writes"))
    (when-not (= (or basis 0) (or (:generation current) 0))
      (fail! :awai.fs/stale-basis "writer basis differs from committed root"))
    (.mkdirSync fs (.join path root ".state") #js {:recursive true :mode 448})
    (when-not (.isDirectory (.lstatSync fs (.join path root ".state")))
      (fail! :awai.fs/unsafe-path "management object path is not a directory"))
    (let [generation (inc (or (:generation current) 0))
          _ (when-not (js/Number.isSafeInteger generation) (fail! :awai.fs/sequence-exhausted "generation exhausted"))
          snapshot (json-bytes {:format "awai.otehon.volume-checkpoint.v1" :generation generation :manifest manifest})
          snapshot-sha (hash-bytes snapshot)
          wal (json-bytes {:format "awai.otehon.volume-wal.v1" :generation generation
                           :snapshot snapshot-sha :event event})
          wal-sha (object! root wal :wal)
          _ (object! root snapshot :snapshot)
          value {:format "awai.otehon.volume-root.v1" :generation generation
                 :snapshot snapshot-sha :wal wal-sha :catalog (hash-bytes (json-bytes (:packs manifest)))}
          payload (js/JSON.stringify (clj->js value))]
      (write-atomic! (.join path root (str "root-" (mod generation 2) ".json"))
                     (json-bytes {:payload payload :digest (hash-bytes (js/Buffer.from payload "utf8"))}) :root true)
      generation)))

(defn protected-packs [directory]
  ;; Invalid retained slots block collection rather than weakening retention.
  (let [root (real-root! directory)]
    (reduce (fn [out i]
              (let [s (slot root i)]
                (when (or (nil? s) (:error s)) (fail! :awai.fs/degraded-store "cannot collect with a missing or invalid retained root"))
                (if-let [r (:root s)]
                  (let [snapshot (load-object root (get r "snapshot"))
                        wal (load-object root (get r "wal"))]
                    (when-not (and (= "awai.otehon.volume-checkpoint.v1" (get snapshot "format"))
                                   (= (get r "generation") (get snapshot "generation"))
                                   (= "awai.otehon.volume-wal.v1" (get wal "format"))
                                   (= (get r "generation") (get wal "generation"))
                                   (= (get r "snapshot") (get wal "snapshot"))
                                   (vector? (get-in snapshot ["manifest" "packs"]))
                                   (= (get r "catalog") (hash-bytes (json-bytes (get-in snapshot ["manifest" "packs"])))))
                      (fail! :awai.fs/invalid-state "retained checkpoint is invalid"))
                    (into out (map #(get % "pack-index") (get-in snapshot ["manifest" "packs"]))))
                  out))) #{} [0 1])))
