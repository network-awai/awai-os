(ns otehon.pack-store
  "Bounded Pack/CAR persistence over the Otehon checkpoint/WAL adapter.
  Uses the pinned Awai pack codec; no new CID or DAG-CBOR implementation.
  Derived indexes live only in the returned process-local handle."
  (:require [clojure.edn :as edn]
            [clojure.string :as str]
            [awai.fs.car :as car]
            [otehon.forest :as forest]
            [otehon.segmented :as segmented]
            [otehon.storage :as store])
  (:import [java.io ByteArrayOutputStream]
           [java.nio.file Files Paths OpenOption]
           [java.security MessageDigest]))

(def max-data-bytes (* 900 1024))
(def max-car-bytes (* 1024 1024))
(def leaf-size 65536)
(def max-leaves 64)
(def ^:private prefix "awai.pack/")
(def ^:private group-prefix "awai.pack-group/")
(def ^:private max-group-packs 64)

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
         :car-size (alength ^bytes bytes)
         :index (mapv (fn [section block]
                        {:offset (+ 51 (:data-offset section)) :length (:length section) :cid (:cid block)
                         :sha (car/hex-encode (:digest (car/parse-cid (:cid block))))})
                      (butlast (car/carv2-sections v)) raw)}))))

(defn- compressed? [ref] (= :awai.otehon-store/pack-zstd3-v1 (:format ref)))
(defn- forest? [ref] (= :awai.otehon-store/pack-forest-v1 (:format ref)))
(defn- physical? [ref] (or (compressed? ref) (forest? ref)))
(defn- cache-key [ref] (or (:stored-sha ref) (:car-sha ref)))
(defn- canonical-ref [ref]
  (-> ref (dissoc :stored-sha :stored-size) (assoc :format :awai.otehon-store/pack-v1)))

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
                     (= (if (physical? value)
                          #{:format :car-sha :root-cid :data-sha :size :leaf-count :stored-sha :stored-size}
                          #{:format :car-sha :root-cid :data-sha :size :leaf-count}) (set (keys value)))
                     (contains? #{:awai.otehon-store/pack-v1 :awai.otehon-store/pack-zstd3-v1 :awai.otehon-store/pack-forest-v1} (:format value))
                     (or (not (physical? value))
                         (and (string? (:stored-sha value)) (re-matches #"[0-9a-f]{64}" (:stored-sha value))
                              (integer? (:stored-size value)) (<= 1 (:stored-size value) max-car-bytes)))
                     (every? #(and (string? %) (re-matches #"[0-9a-f]{64}" %))
                             [(:car-sha value) (:data-sha value)])
                     (string? (:root-cid value))
                     (integer? (:size value)) (<= 0 (:size value) max-data-bytes)
                     (integer? (:leaf-count value)) (<= 0 (:leaf-count value) max-leaves))
        (fail! :invalid-pack-ref "invalid Pack catalog reference"))
      value)))

(defn- forest-car [opened]
  (let [payload (:carv1 opened)
        encoded (car/carv2-encode (car/carv1-decode payload))
        end (first (car/decode-u64-le encoded 43))
        car-v2 (into (into (subvec encoded 0 43) (repeat 8 0)) (subvec encoded 51 end))]
    (when-not (= payload (subvec car-v2 51))
      (fail! :unsupported-car-profile "Forest CAR payload is not canonical"))
    (byte-array-of car-v2)))

(defn- group-key [name]
  (pack-key name)
  (str group-prefix name))

(defn- parse-group [text]
  (with-open [r (java.io.PushbackReader. (java.io.StringReader. text))]
    (let [opts {:eof ::eof :readers {} :default (fn [& _] (fail! :invalid-pack-group "unknown tag"))}
          value (edn/read opts r)]
      (when-not (and (= ::eof (edn/read opts r)) (map? value)
                     (or (and (= :awai.otehon-store/forest-group-v1 (:format value))
                              (= #{:format :packs} (set (keys value))))
                         (and (= :awai.otehon-store/logical-forest-v1 (:format value))
                              (= #{:format :packs :manifest-hex :manifest-cid} (set (keys value)))
                              (string? (:manifest-hex value))
                              (<= 2 (count (:manifest-hex value)) (* 2 131072))
                              (re-matches #"(?:[0-9a-f]{2})+" (:manifest-hex value))
                              (string? (:manifest-cid value))))
                     (vector? (:packs value)) (<= 1 (count (:packs value)) max-group-packs))
        (fail! :invalid-pack-group "invalid bounded Pack group"))
      (let [refs (mapv #(parse-ref (pr-str %)) (:packs value))]
        (when-not (every? forest? refs)
          (fail! :invalid-pack-group "group must contain Forest Pack references"))
        (assoc value :packs refs)))))

(defn- verify-logical-manifest [wire expected-cid indexes]
  ;; Closed v1 profile is owned by Kotoba; this adapter reuses the pinned
  ;; DAG-CBOR/CID codec and checks it against verified Pack leaf indexes.
  (let [v (vector-bytes wire 131072)
        [m end] (car/cbor-decode v 0)
        profile (get m "chunkProfile") chunks (get m "chunks")
        cid (car/cid-str (car/cid-bytes car/codec-dag-cbor (digest v)))]
    (when-not (and (= end (count v)) (= v (car/cbor-encode m)) (= cid expected-cid)
                   (map? m) (= #{"format" "version" "fileSize" "chunkProfile" "chunks"} (set (keys m)))
                   (= "awai.logical-file" (get m "format")) (= 1 (get m "version"))
                   (integer? (get m "fileSize")) (<= 0 (get m "fileSize") 17179869184)
                   (map? profile) (= #{"kind" "version" "leafSize"} (set (keys profile)))
                   (= "fixed" (get profile "kind")) (= 1 (get profile "version"))
                   (integer? (get profile "leafSize")) (<= 1 (get profile "leafSize") 16777216)
                   (vector? chunks) (<= (count chunks) 1024))
      (fail! :invalid-logical-manifest "invalid canonical logical-file v1 or CID"))
    (let [leaves (vec (mapcat identity indexes))]
      (when-not (= (count chunks) (count leaves))
        (fail! :logical-pack-mismatch "logical chunks do not match Pack leaves"))
      (loop [i 0 offset 0]
        (if (= i (count chunks))
          (when-not (= offset (get m "fileSize"))
            (fail! :invalid-logical-manifest "logical file size differs"))
          (let [chunk (nth chunks i) leaf (nth leaves i)
                length (get chunk "length") link (get chunk "cid")]
            (when-not (and (map? chunk) (= #{"cid" "length" "offset"} (set (keys chunk)))
                           (= offset (get chunk "offset")) (integer? length)
                           (<= 1 length (get profile "leafSize"))
                           (or (= i (dec (count chunks))) (= length (get profile "leafSize")))
                           (= length (:length leaf)) (= {:tag 42 :bytes (:cid leaf)} link))
              (fail! :logical-pack-mismatch "chunk extent or CID differs from verified Pack leaf"))
            (recur (inc i) (+ offset length))))))
    m))

(defn- load-index [directory ref stats]
  (let [stored (cond (compressed? ref) (store/read-zpack directory (:stored-sha ref))
                     (forest? ref) (store/read-forest directory (:stored-sha ref)))
        decoded (when (compressed? ref) (segmented/decode stored))
        opened (when (forest? ref) (forest/open stored))
        bytes (cond decoded (:car decoded) opened (forest-car opened) :else (store/read-car directory (:car-sha ref)))
        checked (verify-car bytes)]
    (when (and stored (not= (:stored-size ref) (alength ^bytes stored)))
      (fail! :pack-ref-mismatch "compressed representation size mismatch"))
    (swap! stats #(-> % (update :car-reads inc) (update :bytes-read + (alength ^bytes (or stored bytes)))
                       (update :index-rebuilds inc)))
    (when-not (= (canonical-ref ref) (:ref checked))
      (fail! :pack-ref-mismatch "CAR bytes do not match the committed Pack reference"))
    (assoc checked :ref ref :layout (:layout decoded)
           :forest (when opened (dissoc opened :bytes :carv1)))))

(defn- recover-map [directory state]
  (let [cache (atom {})
        decoded-cache (atom {:order [] :values {}})
        stats (atom {:cache-entries-before 0 :index-rebuilds 0 :car-reads 0 :bytes-read 0})
        verify-ref (fn [ref]
                     (let [checked (assoc (or (get @cache (cache-key ref)) (load-index directory ref stats))
                                          :decoded-cache decoded-cache)]
                       (when-not (= ref (:ref checked))
                         (fail! :pack-ref-mismatch "conflicting references to the same CAR"))
                       (swap! cache assoc (cache-key ref) checked)))
        files (reduce-kv
                (fn [out key value]
                  (if-not (str/starts-with? key prefix)
                    out
                    (let [name (subs key (count prefix))
                          _ (pack-key name)
                          ref (parse-ref value)
                          _ (verify-ref ref)]
                      (assoc out name ref)))) {} state)]
    (let [groups (reduce-kv (fn [out key value]
                              (if-not (str/starts-with? key group-prefix) out
                                (let [name (subs key (count group-prefix))
                                      _ (group-key name) group (parse-group value)]
                                  (doseq [ref (:packs group)] (verify-ref ref))
                                  (when (= :awai.otehon-store/logical-forest-v1 (:format group))
                                    (verify-logical-manifest
                                      (byte-array-of (car/hex-decode (:manifest-hex group)))
                                      (:manifest-cid group)
                                      (mapv #(get-in @cache [(cache-key %) :index]) (:packs group))))
                                  (assoc out name group)))) {} state)]
      {:directory directory :files files :groups groups :index-cache cache :stats stats})))

(defn recover
  "Verify every committed Pack and rebuild derived indexes from durable CAR
  sections, starting with an empty process-local cache. No sidecar is needed.
  The handle retains this snapshot basis; it is not a mutable-head authority."
  [directory]
  (let [{:keys [state root degraded?]} (store/read-store directory)]
    (assoc (recover-map directory state) :basis root :degraded? degraded?)))

(defn summary [handle]
  {:files (:files handle) :groups (:groups handle) :basis (:basis handle) :degraded? (:degraded? handle)
   :stats (assoc @(:stats handle) :index-cache-entries (count @(:index-cache handle)))})

(defn- import-representation!
  "Verify and durably publish a supported CAR before publishing its catalog
  reference through the existing WAL/root transaction, under one writer lock."
  [directory name bytes zstd3?]
  (vector-bytes bytes max-car-bytes)
  (let [bytes (aclone ^bytes bytes)
        key (pack-key name)
        base-ref (:ref (verify-car bytes))
        candidate (when zstd3? (segmented/encode bytes))
        ;; Explicit size policy: the new container must beat the whole raw CAR,
        ;; including its directory. Entropy stays in the existing raw format.
        stored (when (and candidate (< (alength ^bytes candidate) (alength ^bytes bytes))) candidate)
        _ (when (and stored (not (java.util.Arrays/equals ^bytes bytes ^bytes (:car (segmented/decode stored)))))
            (fail! :compression-mismatch "compression did not preserve canonical CAR bytes"))
        ref (if stored (assoc base-ref :format :awai.otehon-store/pack-zstd3-v1
                              :stored-sha (segmented/sha stored) :stored-size (alength ^bytes stored)) base-ref)
        result (store/transact!
                 directory :put {:key key :value (pr-str ref)}
                 (fn [directory state]
                   (recover-map directory state)
                   (when-not (= (cache-key ref) (if stored (store/write-zpack! directory stored)
                                                           (store/write-car! directory bytes)))
                     (fail! :car-changed "CAR bytes changed during publication"))))]
    (cond-> (assoc result :pack ref)
      zstd3? (assoc :compression {:requested :zstd3 :representation (if stored :segmented-zstd3 :raw-car)
                                 :candidate-bytes (alength ^bytes candidate)
                                 :stored-bytes (alength ^bytes (or stored bytes))}))))

(defn import-car! [directory name bytes] (import-representation! directory name bytes false))
(defn import-car-zstd3!
  "Opt-in segmented physical representation. Exact canonical CAR/root retained;
  no raw CAR duplicate is stored. Existing raw entries remain readable."
  [directory name bytes] (import-representation! directory name bytes true))

(defn import-forest!
  "Validate a bounded Forest snapshot and import its exact CARv1 payload into
  the existing indexless CARv2 Pack profile. Stores the existing zpack format."
  [directory name bytes]
  (import-car-zstd3! directory name (forest-car (forest/open bytes))))

(defn import-forest-direct!
  "Publish exact Forest bytes and bind them to the canonical Pack root."
  [directory name input]
  (vector-bytes input max-car-bytes)
  (let [bytes (aclone ^bytes input) opened (forest/open bytes)
        base-ref (:ref (verify-car (forest-car opened)))
        ref (assoc base-ref :format :awai.otehon-store/pack-forest-v1
                   :stored-sha (segmented/sha bytes) :stored-size (alength bytes))
        result (store/transact! directory :put {:key (pack-key name) :value (pr-str ref)}
                 (fn [directory state]
                   (recover-map directory state)
                   (when-not (= (:stored-sha ref) (store/write-forest! directory bytes))
                     (fail! :forest-changed "Forest bytes changed during publication"))))]
    (assoc result :pack ref)))

(defn- import-forest-group* [directory name inputs manifest manifest-cid]
  (group-key name)
  (when-not (and (vector? inputs) (<= 1 (count inputs) max-group-packs))
    (fail! :invalid-pack-group "expected 1..64 Forest Packs"))
  (let [candidates (mapv (fn [input]
                           (vector-bytes input max-car-bytes)
                           (let [bytes (aclone ^bytes input)
                                 checked (verify-car (forest-car (forest/open bytes)))
                                 base (:ref checked)]
                             {:bytes bytes :index (:index checked) :ref (assoc base :format :awai.otehon-store/pack-forest-v1
                                                       :stored-sha (segmented/sha bytes)
                                                       :stored-size (alength bytes))})) inputs)
        manifest (when manifest (aclone ^bytes manifest))
        _ (when manifest (verify-logical-manifest manifest manifest-cid (mapv :index candidates)))
        group (cond-> {:format (if manifest :awai.otehon-store/logical-forest-v1
                                            :awai.otehon-store/forest-group-v1)
                       :packs (mapv :ref candidates)}
                manifest (assoc :manifest-hex (car/hex-encode (vector-bytes manifest 131072))
                                :manifest-cid manifest-cid))
        result (store/transact! directory :put {:key (group-key name) :value (pr-str group)}
                 (fn [directory state]
                   (recover-map directory state)
                   (doseq [{:keys [bytes ref]} candidates]
                     (when-not (= (:stored-sha ref) (store/write-forest! directory bytes))
                       (fail! :forest-changed "Forest bytes changed during publication")))))]
    (assoc result :group group)))

(defn import-forest-group!
  "Atomically publish a bounded ordered group of verified Forest Packs."
  [directory name inputs]
  (import-forest-group* directory name inputs nil nil))

(defn import-logical-forest!
  "Bind canonical logical-file v1 bytes/CID to all ordered Forest Pack leaves
  and publish them together under one WAL/root. Bounded to 64 Packs."
  [directory name inputs manifest manifest-cid]
  (when-not (and (bytes? manifest) (string? manifest-cid))
    (fail! :invalid-logical-manifest "manifest bytes and CID are required"))
  (import-forest-group* directory name inputs manifest manifest-cid))

(defn- read-bounded-forest-file [path]
  (when-not (string? path) (fail! :invalid-pack-source "expected a file path"))
  (with-open [in (Files/newInputStream (Paths/get path (make-array String 0))
                                      (make-array OpenOption 0))]
    (let [bytes (.readNBytes in (inc max-car-bytes))]
      (when (> (alength ^bytes bytes) max-car-bytes)
        (fail! :too-large "Forest input exceeds the declared bound"))
      bytes)))

(defn import-logical-forest-files!
  "Atomically publish canonical manifest and ordered Forest files. The files
  are verified one at a time and re-read under the writer lock; changes between
  passes abort publication. At most one input Pack is retained at a time."
  [directory name paths manifest manifest-cid]
  (group-key name)
  (when-not (and (vector? paths) (<= 1 (count paths) max-group-packs))
    (fail! :invalid-pack-group "expected 1..64 Forest Pack paths"))
  (when-not (and (bytes? manifest) (string? manifest-cid))
    (fail! :invalid-logical-manifest "manifest bytes and CID are required"))
  (let [manifest (aclone ^bytes manifest)
        candidates (mapv (fn [path]
                           (let [bytes (read-bounded-forest-file path)
                                 checked (verify-car (forest-car (forest/open bytes)))]
                             {:path path :index (:index checked)
                              :ref (assoc (:ref checked) :format :awai.otehon-store/pack-forest-v1
                                          :stored-sha (segmented/sha bytes)
                                          :stored-size (alength ^bytes bytes))})) paths)
        _ (verify-logical-manifest manifest manifest-cid (mapv :index candidates))
        group {:format :awai.otehon-store/logical-forest-v1
               :packs (mapv :ref candidates)
               :manifest-hex (car/hex-encode (vector-bytes manifest 131072))
               :manifest-cid manifest-cid}
        result (store/transact! directory :put {:key (group-key name) :value (pr-str group)}
                 (fn [directory state]
                   (recover-map directory state)
                   (doseq [{:keys [path ref]} candidates]
                     (let [bytes (read-bounded-forest-file path)]
                       (when-not (and (= (:stored-size ref) (alength ^bytes bytes))
                                      (= (:stored-sha ref) (segmented/sha bytes)))
                         (fail! :forest-changed "Forest input changed during publication"))
                       (when-not (= (:stored-sha ref) (store/write-forest! directory bytes))
                         (fail! :forest-changed "Forest bytes changed during publication"))))))]
    (assoc result :group group)))

(defn put-data! [directory name bytes]
  (let [v (vector-bytes bytes max-data-bytes)
        leaves (mapv (fn [part] (let [v (vec part)] {:bytes v :digest (digest v)}))
                     (partition-all leaf-size v))]
    (import-car! directory name (byte-array-of (encode-pack leaves)))))

(defn put-data-zstd3! [directory name bytes]
  (let [v (vector-bytes bytes max-data-bytes)
        leaves (mapv (fn [part] (let [v (vec part)] {:bytes v :digest (digest v)}))
                     (partition-all leaf-size v))]
    (import-car-zstd3! directory name (byte-array-of (encode-pack leaves)))))

(defn checkpoint! [directory]
  (store/checkpoint! directory (fn [directory state] (recover-map directory state))))

(defn- ref-for [handle name]
  (pack-key name)
  (or (get (:files handle) name) (fail! :pack-not-found "Pack name is not in the selected committed catalog")))

(defn read-forest-block
  "Read a CID from the durable Forest index after full recovery verification.
  Only candidate frames are read; unread bytes are not scrubbed."
  [handle name cid]
  (let [ref (ref-for handle name)
        checked (get @(:index-cache handle) (cache-key ref))]
    (when-not (and (forest? ref) (:forest checked))
      (fail! :unsupported-pack-profile "selected Pack is not a recovered Forest archive"))
    (forest/get-block-from (:forest checked) cid
      (fn [offset length]
        (let [bytes (first (store/read-payload-segments (:directory handle) (:stored-sha ref)
                                                        "forest" (:stored-size ref)
                                                        [{:offset offset :length length}]))]
          (swap! (:stats handle) #(-> % (update :car-reads inc) (update :bytes-read + length)
                                        (update :forest-frame-reads (fnil inc 0))))
          bytes)))))

(defn export-forest [handle name]
  (let [ref (ref-for handle name)]
    (when-not (forest? ref) (fail! :unsupported-pack-profile "selected Pack is not Forest"))
    (store/read-forest (:directory handle) (:stored-sha ref))))

(defn export-car [handle name]
  (let [ref (ref-for handle name)
        stored (cond (compressed? ref) (store/read-zpack (:directory handle) (:stored-sha ref))
                     (forest? ref) (store/read-forest (:directory handle) (:stored-sha ref)))
        bytes (cond (compressed? ref) (:car (segmented/decode stored))
                    (forest? ref) (forest-car (forest/open stored))
                    :else (store/read-car (:directory handle) (:car-sha ref)))]
    (when (and stored (not= (:car-sha ref) (segmented/sha bytes)))
      (fail! :corrupt-car "decoded canonical CAR digest mismatch"))
    (swap! (:stats handle) #(-> % (update :car-reads inc) (update :bytes-read + (alength ^bytes (or stored bytes)))))
    bytes))

(defn read-range [handle name offset length]
  (let [ref (ref-for handle name)]
    (when-not (and (integer? offset) (integer? length) (<= 0 offset (:size ref))
                   (<= 0 length (- (:size ref) offset)))
      (fail! :invalid-range "Pack range is outside the selected file"))
    (let [bytes (export-car handle name)
          index (get-in @(:index-cache handle) [(cache-key ref) :index])]
      (when-not index (fail! :missing-index "Pack handle has no verified derived index"))
      (with-open [out (ByteArrayOutputStream.)]
        (doseq [{:keys [offset length]} (car/car-range-segments index offset length)]
          (.write out ^bytes bytes (int offset) (int length)))
        (.toByteArray out)))))

(defn read-data [handle name]
  (read-range handle name 0 (:size (ref-for handle name))))

(defn read-range-verified-leaves
  "Efficient explicit range operation against a fully verified recovered handle.
  Re-verify touched WHOLE leaf CIDs; compressed reads also verify touched frames.
  Does not scrub unread bytes. read-range/read-data/export/recover/checkpoint
  retain their strict whole-representation integrity checks."
  [handle name offset length]
  (let [ref (ref-for handle name)
        checked (get @(:index-cache handle) (cache-key ref))]
    (when-not (and (integer? offset) (integer? length) (<= 0 offset (:size ref))
                   (<= 0 length (- (:size ref) offset)))
      (fail! :invalid-range "Pack range is outside the selected file"))
    (when-not checked (fail! :missing-index "no verified snapshot index"))
    (let [leaves (loop [[leaf & more] (:index checked) logical 0 out []]
                   (if-not leaf out
                     (recur more (+ logical (:length leaf))
                       (if (and (pos? length) (< logical (+ offset length)) (< offset (+ logical (:length leaf))))
                         (conj out (assoc leaf :logical logical)) out))))
          spans (mapv #(select-keys % [:offset :length]) leaves)
          raw (cond
                (forest? ref) (mapv (fn [leaf]
                                      (or (read-forest-block handle name (:cid leaf))
                                          (fail! :missing-block "published Forest block is missing"))) leaves)
                (compressed? ref) (segmented/read-ranges (:directory handle) (:stored-sha ref) (:layout checked)
                                      spans (:decoded-cache checked) (:stats handle))
                :else (let [parts (store/read-payload-segments (:directory handle) (:car-sha ref) "car" (:car-size checked) spans)]
                        (swap! (:stats handle) #(-> % (update :car-reads inc) (update :bytes-read + (reduce + 0 (map :length spans))))) parts))]
      (with-open [out (ByteArrayOutputStream.)]
        (doseq [[leaf bytes] (map vector leaves raw)]
          (when-not (= (:sha leaf) (segmented/sha bytes)) (fail! :cid-mismatch "selected leaf CID mismatch"))
          (let [start (max offset (:logical leaf)) end (min (+ offset length) (+ (:logical leaf) (:length leaf)))]
            (.write out ^bytes bytes (int (- start (:logical leaf))) (int (- end start)))))
        (.toByteArray out)))))

(defn read-group-range
  "Read at most 1 MiB across the ordered physical group; touched leaves are
  CID-verified. A group is not a canonical logical-file manifest."
  [handle name offset length]
  (group-key name)
  (let [refs (get-in handle [:groups name :packs])
        size (reduce + 0 (map :size refs))]
    (when-not refs (fail! :pack-group-not-found "Pack group not found"))
    (when-not (and (integer? offset) (integer? length) (<= 0 offset size)
                   (<= 0 length max-car-bytes) (<= length (- size offset)))
      (fail! :invalid-range "group range exceeds file or read bound"))
    (with-open [out (ByteArrayOutputStream.)]
      (loop [remaining refs base 0]
        (when-let [ref (first remaining)]
          (let [end (+ base (:size ref)) lo (max offset base) hi (min (+ offset length) end)]
            (when (< lo hi)
              (.write out ^bytes (read-range-verified-leaves
                                    (assoc handle :files {"group-read" ref})
                                    "group-read" (- lo base) (- hi lo))))
            (recur (next remaining) end))))
      (.toByteArray out))))
