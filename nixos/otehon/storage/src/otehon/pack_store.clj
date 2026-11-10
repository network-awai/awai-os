(ns otehon.pack-store
  "Bounded Pack/CAR persistence over the Otehon checkpoint/WAL adapter.
  Uses the pinned Awai pack codec; no new CID or DAG-CBOR implementation.
  Derived indexes live only in the returned process-local handle."
  (:require [clojure.edn :as edn]
            [clojure.string :as str]
            [awai.fs.car :as car]
            [otehon.storage :as store])
  (:import [java.io ByteArrayOutputStream]
           [java.security MessageDigest]))

(def max-data-bytes (* 900 1024))
(def max-car-bytes (* 1024 1024))
(def leaf-size 65536)
(def max-leaves 64)
(def ^:private prefix "awai.pack/")

(defn- fail! [type message] (throw (ex-info message {:type type})))
(defn- digest [v]
  (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256")
                                 (byte-array (map unchecked-byte v)))))
(defn- vector-bytes [bytes ceiling]
  (when-not (bytes? bytes) (fail! :invalid-bytes "expected a byte array"))
  (when (> (alength ^bytes bytes) ceiling) (fail! :too-large "Pack input exceeds the declared bound"))
  (mapv #(bit-and 255 %) bytes))
(defn- byte-array-of [v] (byte-array (map unchecked-byte v)))

(defn- encode-pack [leaves]
  (let [encoded (:car (car/assemble-pack leaves digest))
        end (first (car/decode-u64-le encoded 43))]
    ;; CARv2's index is optional. This profile stores no optional index and
    ;; reconstructs one from verified sections. Keep the existing CARv1
    ;; payload/root bytes intact; do not qualify the source's index dialect.
    (into (into (subvec encoded 0 43) (repeat 8 0))
          (subvec encoded 51 end))))

(defn- verify-car [bytes]
  (let [v (vector-bytes bytes max-car-bytes)]
    (when (or (< (count v) 51) (not= 0 (first (car/decode-u64-le v 43))))
      (fail! :unsupported-car-profile "expected the bounded indexless CARv2 Pack profile"))
    (when-not (and (= 51 (first (car/decode-u64-le v 27)))
                   (= (- (count v) 51) (first (car/decode-u64-le v 35)))
                   (every? zero? (subvec v 11 27))
                   (<= 1 (first (car/decode-uvarint v 51)) 128))
      (fail! :unsupported-car-profile "unsupported CAR extents, characteristics or header bound"))
    (let [{:keys [roots blocks]} (car/carv2-decode v)]
      (when-not (<= 1 (count blocks) (inc max-leaves))
        (fail! :invalid-pack "Pack must contain a root and at most 64 leaves"))
      (doseq [{:keys [cid bytes]} blocks]
        (when-not (= (:digest (car/parse-cid cid)) (digest bytes))
          (fail! :cid-mismatch "CAR block does not match its CID")))
      (let [raw (vec (butlast blocks))
            leaves (mapv (fn [{:keys [cid bytes]}]
                           (when-not (= car/codec-raw (:codec (car/parse-cid cid)))
                             (fail! :invalid-pack "Pack leaves must use the raw codec"))
                           {:digest (digest bytes) :bytes bytes}) raw)
            size (reduce + 0 (map #(count (:bytes %)) raw))]
        (when (> size max-data-bytes) (fail! :too-large "Pack payload exceeds 900 KiB"))
        ;; Reuse the owning codec to bind root links, block order, framing and
        ;; the entire closed profile. Hashes alone do not establish linkage.
        (when-not (= v (encode-pack leaves))
          (fail! :invalid-pack "unsupported framing, roots, links or trailing bytes"))
        {:ref {:format :awai.otehon-store/pack-v1
               :car-sha (car/hex-encode (digest v))
               :root-cid (car/cid-str (first roots))
               :data-sha (car/hex-encode (digest (mapcat :bytes raw)))
               :size size :leaf-count (count raw)}
         :index (mapv (fn [section]
                        {:offset (+ 51 (:data-offset section)) :length (:length section)})
                      (butlast (car/carv2-sections v)))}))))

(defn- pack-key [name]
  (when-not (and (string? name) (pos? (count name)) (<= (count name) 1024))
    (fail! :invalid-name "Pack name must contain 1..1024 characters"))
  (str prefix name))

(defn- parse-ref [text]
  (with-open [r (java.io.PushbackReader. (java.io.StringReader. text))]
    (let [opts {:eof ::eof :readers {} :default (fn [& _] (fail! :invalid-pack-ref "unknown tag"))}
          value (edn/read opts r)]
      (when-not (and (= ::eof (edn/read opts r))
                     (map? value)
                     (= #{:format :car-sha :root-cid :data-sha :size :leaf-count} (set (keys value)))
                     (= :awai.otehon-store/pack-v1 (:format value))
                     (every? #(and (string? %) (re-matches #"[0-9a-f]{64}" %))
                             [(:car-sha value) (:data-sha value)])
                     (string? (:root-cid value))
                     (integer? (:size value)) (<= 0 (:size value) max-data-bytes)
                     (integer? (:leaf-count value)) (<= 0 (:leaf-count value) max-leaves))
        (fail! :invalid-pack-ref "invalid Pack catalog reference"))
      value)))

(defn- load-index [directory ref stats]
  (let [bytes (store/read-car directory (:car-sha ref))
        checked (verify-car bytes)]
    (swap! stats #(-> % (update :car-reads inc) (update :bytes-read + (alength ^bytes bytes))
                       (update :index-rebuilds inc)))
    (when-not (= ref (:ref checked))
      (fail! :pack-ref-mismatch "CAR bytes do not match the committed Pack reference"))
    checked))

(defn- recover-map [directory state]
  (let [cache (atom {})
        stats (atom {:cache-entries-before 0 :index-rebuilds 0 :car-reads 0 :bytes-read 0})
        files (reduce-kv
                (fn [out key value]
                  (if-not (str/starts-with? key prefix)
                    out
                    (let [name (subs key (count prefix))
                          _ (pack-key name)
                          ref (parse-ref value)
                          checked (or (get @cache (:car-sha ref)) (load-index directory ref stats))]
                      (when-not (= ref (:ref checked))
                        (fail! :pack-ref-mismatch "conflicting references to the same CAR"))
                      (swap! cache assoc (:car-sha ref) checked)
                      (assoc out name ref)))) {} state)]
    {:directory directory :files files :index-cache cache :stats stats}))

(defn recover
  "Verify every committed Pack and rebuild derived indexes from durable CAR
  sections, starting with an empty process-local cache. No sidecar is needed.
  The handle retains this snapshot basis; it is not a mutable-head authority."
  [directory]
  (let [{:keys [state root degraded?]} (store/read-store directory)]
    (assoc (recover-map directory state) :basis root :degraded? degraded?)))

(defn summary [handle]
  {:files (:files handle) :basis (:basis handle) :degraded? (:degraded? handle)
   :stats (assoc @(:stats handle) :index-cache-entries (count @(:index-cache handle)))})

(defn import-car!
  "Verify and durably publish a supported CAR before publishing its catalog
  reference through the existing WAL/root transaction, under one writer lock."
  [directory name bytes]
  (vector-bytes bytes max-car-bytes)
  (let [bytes (aclone ^bytes bytes)
        key (pack-key name)
        ref (:ref (verify-car bytes))
        result (store/transact!
                 directory :put {:key key :value (pr-str ref)}
                 (fn [directory state]
                   (recover-map directory state)
                   (when-not (= (:car-sha ref) (store/write-car! directory bytes))
                     (fail! :car-changed "CAR bytes changed during publication"))))]
    (assoc result :pack ref)))

(defn put-data! [directory name bytes]
  (let [v (vector-bytes bytes max-data-bytes)
        leaves (mapv (fn [part] (let [v (vec part)] {:bytes v :digest (digest v)}))
                     (partition-all leaf-size v))]
    (import-car! directory name (byte-array-of (encode-pack leaves)))))

(defn checkpoint! [directory]
  (store/checkpoint! directory (fn [directory state] (recover-map directory state))))

(defn- ref-for [handle name]
  (pack-key name)
  (or (get (:files handle) name) (fail! :pack-not-found "Pack name is not in the selected committed catalog")))

(defn export-car [handle name]
  (let [bytes (store/read-car (:directory handle) (:car-sha (ref-for handle name)))]
    (swap! (:stats handle) #(-> % (update :car-reads inc) (update :bytes-read + (alength ^bytes bytes))))
    bytes))

(defn read-range [handle name offset length]
  (let [ref (ref-for handle name)]
    (when-not (and (integer? offset) (integer? length) (<= 0 offset (:size ref))
                   (<= 0 length (- (:size ref) offset)))
      (fail! :invalid-range "Pack range is outside the selected file"))
    (let [bytes (export-car handle name)
          index (get-in @(:index-cache handle) [(:car-sha ref) :index])]
      (when-not index (fail! :missing-index "Pack handle has no verified derived index"))
      (with-open [out (ByteArrayOutputStream.)]
        (doseq [{:keys [offset length]} (car/car-range-segments index offset length)]
          (.write out ^bytes bytes (int offset) (int length)))
        (.toByteArray out)))))

(defn read-data [handle name]
  (read-range handle name 0 (:size (ref-for handle name))))
