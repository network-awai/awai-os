(ns awai.fs.format-codec
  "AWAI-531 record-only: versioned manifest codec + minimal CARv2 container
  + range scan. Next unit after the AWAI-236 header codec
  (awai.fs.manifest-codec, which this namespace reuses and does not modify).

  Manifest: one versioned shape {:header {...} :entries [...]}. The header is
  the awai.fs.manifest/v1 map from manifest-codec; each entry is exactly
  {:pack :index :length :offset :oversized :pack-offset} where :oversized is
  a bool and the rest are non-negative integers. Entry keys are DAG-CBOR
  text in canonical order (length first, then bytewise):
    pack, index, length, offset, oversized, pack-offset.
  Entry order is the caller's planning invariant and is preserved, not
  sorted. Anything outside the shape is refused, never guessed.

  CARv2 container: record-only interchange framing shaped like CARv2, not a
  full CARv2 implementation. Layout is pragma (CBOR {version: 2}, 11 bytes)
  ++ 40-byte little-endian header (16 zero characteristics bytes, data
  offset, data size, index offset) ++ CARv1-style data (uvarint 1, roots,
  varint-framed blocks) ++ a CID-sorted index (uvarint count, then per
  block: CID, data-relative offset, frame size). CIDs ride as multibase
  strings (ASCII by construction); digest verification is out of scope.
  Offsets are recomputed from the data on decode and must match the index.

  Range scan: entries of {:file-size :entries} overlapped by
  [offset, offset+length), with :read-offset/:read-length attached. Reads
  past the end are refused, never shortened. Zero-length reads return [].

  Record-only: no production qualification is claimed."
  (:require [awai.fs.manifest-codec :as mc]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

;; ---- shared canonical-CBOR write/read helpers (mirror manifest-codec) ----

(defn- uint-head
  "Shortest-form major-0 head for n as a byte vector."
  [n]
  (cond
    (< n 24) [n]
    (< n 256) [0x18 n]
    (< n 65536) [0x19 (bit-and (bit-shift-right n 8) 0xff) (bit-and n 0xff)]
    (< n 4294967296) [0x1a
                      (bit-and (bit-shift-right n 24) 0xff)
                      (bit-and (bit-shift-right n 16) 0xff)
                      (bit-and (bit-shift-right n 8) 0xff)
                      (bit-and n 0xff)]
    :else [0x1b
           (bit-and (bit-shift-right n 56) 0xff)
           (bit-and (bit-shift-right n 48) 0xff)
           (bit-and (bit-shift-right n 32) 0xff)
           (bit-and (bit-shift-right n 24) 0xff)
           (bit-and (bit-shift-right n 16) 0xff)
           (bit-and (bit-shift-right n 8) 0xff)
           (bit-and n 0xff)]))

(defn- read-head
  "Read one head at pos. Returns [major n pos-after]. Refuses indefinite
  lengths and truncated input."
  [bytes pos]
  (when (>= pos (count bytes))
    (fail! :awai.fs.codec/truncated "awai fs codec: truncated input" {:pos pos}))
  (let [b (nth bytes pos)
        major (bit-shift-right b 5)
        ai (bit-and b 0x1f)]
    (when (= ai 31)
      (fail! :awai.fs.codec/indefinite-length "awai fs codec: indefinite length forbidden" {:pos pos}))
    (cond
      (< ai 24) [major ai (inc pos)]
      (= ai 24) (if (< (inc pos) (count bytes))
                  [major (nth bytes (inc pos)) (+ pos 2)]
                  (fail! :awai.fs.codec/truncated "awai fs codec: truncated input" {:pos pos}))
      (= ai 25) (if (< (+ pos 2) (count bytes))
                  [major (+ (* 256 (nth bytes (inc pos))) (nth bytes (+ pos 2))) (+ pos 3)]
                  (fail! :awai.fs.codec/truncated "awai fs codec: truncated input" {:pos pos}))
      (= ai 26) (if (< (+ pos 4) (count bytes))
                  [major (reduce (fn [acc i] (+ (* acc 256) (nth bytes (+ pos 1 i)))) 0 (range 4)) (+ pos 5)]
                  (fail! :awai.fs.codec/truncated "awai fs codec: truncated input" {:pos pos}))
      :else (if (< (+ pos 8) (count bytes))
              [major (reduce (fn [acc i] (+ (* acc 256) (nth bytes (+ pos 1 i)))) 0 (range 8)) (+ pos 9)]
              (fail! :awai.fs.codec/truncated "awai fs codec: truncated input" {:pos pos})))))

(defn- head
  "Shortest-form head bytes for major with value n."
  [major n]
  (let [h (uint-head n)]
    (into [(bit-or (bit-shift-left major 5) (bit-and (first h) 0x1f))] (rest h))))

(defn- read-value
  "Read one canonical value head: uint (major 0) or bool (0xf4/0xf5).
  Anything else is refused."
  [bytes pos]
  (let [[major n p] (read-head bytes pos)]
    (cond
      (= major 0) [n p]
      (and (= major 7) (= n 20)) [false p]
      (and (= major 7) (= n 21)) [true p]
      :else (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a uint or bool"
                   {:pos pos :major major}))))

(defn- read-pairs
  "Read n text->value pairs at pos. Returns [pairs end-pos]."
  [bytes pos n]
  (loop [p pos out []]
    (if (= (count out) n)
      [out p]
      (let [[km kn p2] (read-head bytes p)]
        (when (not= km 3)
          (fail! :awai.fs.codec/bad-key "awai fs codec: map key must be text" {:pos p}))
        (when (> (+ p2 kn) (count bytes))
          (fail! :awai.fs.codec/truncated "awai fs codec: truncated input" {:pos p2}))
        (let [kb (subvec bytes p2 (+ p2 kn))
              [v p4] (read-value bytes (+ p2 kn))]
          (recur p4 (conj out [kb v])))))))

;; ---- entries payload codec (6-key shape with :oversized bool) ----

(def ^:private entry-key-bytes
  "Canonical entry key order (length first, then bytewise) with value types."
  [[:pack [0x70 0x61 0x63 0x6b] :uint]
   [:index [0x69 0x6e 0x64 0x65 0x78] :uint]
   [:length [0x6c 0x65 0x6e 0x67 0x74 0x68] :uint]
   [:offset [0x6f 0x66 0x66 0x73 0x65 0x74] :uint]
   [:oversized [0x6f 0x76 0x65 0x72 0x73 0x69 0x7a 0x65 0x64] :bool]
   [:pack-offset [0x70 0x61 0x63 0x6b 0x5f 0x6f 0x66 0x66 0x73 0x65 0x74] :uint]])

(defn- encode-entry-value [v t k]
  (case t
    :uint (do
            (when-not (and (integer? v) (not (neg? v)))
              (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a non-negative integer"
                     {:key k :value v}))
            (uint-head v))
    :bool (do
            (when-not (boolean? v)
              (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a boolean"
                     {:key k :value v}))
            [(if v 0xf5 0xf4)])))

(defn encode-entries
  "Encode manifest entries (sequential of entry maps) to a canonical
  DAG-CBOR array. Entry order is preserved, not sorted."
  [entries]
  (when-not (sequential? entries)
    (fail! :awai.fs.codec/not-an-array "awai fs codec: entries must be sequential" {}))
  (into (head 4 (count entries))
        (mapcat (fn [e]
                  (when-not (map? e)
                    (fail! :awai.fs.codec/not-a-map "awai fs codec: entry must be a map" {:entry e}))
                  (let [want (mapv first entry-key-bytes)]
                    (doseq [k want]
                      (when-not (contains? e k)
                        (fail! :awai.fs.codec/missing-key "awai fs codec: missing entry key" {:key k})))
                    (doseq [k (keys e)]
                      (when-not (contains? (set want) k)
                        (fail! :awai.fs.codec/unknown-key "awai fs codec: unknown entry key" {:key k}))))
                  (concat [0xa6]
                          (mapcat (fn [[k kb t]]
                                    (concat [(+ 0x60 (count kb))] kb
                                            (encode-entry-value (get e k) t k)))
                                  entry-key-bytes)))
                entries)))

(defn- check-entry-value [v t k]
  (case t
    :uint (if (and (integer? v) (not (neg? v)))
            v
            (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a non-negative integer"
                   {:key k :value v}))
    :bool (if (boolean? v)
            v
            (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a boolean"
                   {:key k :value v}))))

(defn decode-entries
  "Decode a canonical entries array to a vector of entry maps. Enforces the
  per-entry key set and order, and no trailing bytes."
  [raw]
  (let [bytes (vec raw)]
    (when (empty? bytes)
      (fail! :awai.fs.codec/truncated "awai fs codec: truncated input" {:pos 0}))
    (let [[major n pos] (read-head bytes 0)]
      (when (not= major 4)
        (fail! :awai.fs.codec/not-an-array "awai fs codec: input is not an array" {:major major}))
      (loop [p pos i 0 out []]
        (if (= i n)
          (do
            (when (< p (count bytes))
              (fail! :awai.fs.codec/trailing-bytes "awai fs codec: trailing bytes" {:pos p}))
            out)
          (let [[em en p2] (read-head bytes p)]
            (when (not= em 5)
              (fail! :awai.fs.codec/not-a-map "awai fs codec: entry must be a map" {:index i}))
            (when (not= en (count entry-key-bytes))
              (fail! :awai.fs.codec/bad-pair-count "awai fs codec: wrong entry pair count"
                     {:index i :n en}))
            (let [[pairs p3] (read-pairs bytes p2 en)
                  got-keys (mapv first pairs)
                  want-keys (mapv second entry-key-bytes)]
              (doseq [kb got-keys]
                (when-not (some #(= % kb) want-keys)
                  (fail! :awai.fs.codec/unknown-key "awai fs codec: unknown entry key" {:key kb})))
              (when (not= got-keys want-keys)
                (fail! :awai.fs.codec/bad-key-order "awai fs codec: entry keys out of canonical order" {}))
              (recur p3 (inc i)
                     (conj out (into {} (map (fn [[_ v] [k _ t]] [k (check-entry-value v t k)])
                                             pairs entry-key-bytes)))))))))))

;; ---- versioned manifest: header part + entries part ----

(defn encode-manifest
  "Encode one versioned manifest shape as two canonical parts: the header
  map bytes and the entries array bytes. Returns {:header [...] :entries [...]}."
  [{:keys [header entries] :as manifest}]
  (when-not (map? manifest)
    (fail! :awai.fs.codec/not-a-map "awai fs codec: manifest must be a map" {}))
  (when-not (contains? manifest :header)
    (fail! :awai.fs.codec/missing-key "awai fs codec: missing manifest header" {:kind :manifest}))
  (when-not (contains? manifest :entries)
    (fail! :awai.fs.codec/missing-key "awai fs codec: missing manifest entries" {:kind :manifest}))
  {:header (mc/encode header) :entries (encode-entries entries)})

(defn decode-manifest
  "Decode a two-part manifest map back to {:header {...} :entries [...]};
  part failures keep their own reasons."
  [{:keys [header entries] :as manifest}]
  (when-not (map? manifest)
    (fail! :awai.fs.codec/not-a-map "awai fs codec: manifest must be a map" {}))
  (when-not (contains? manifest :header)
    (fail! :awai.fs.codec/missing-key "awai fs codec: missing manifest header" {:kind :manifest}))
  (when-not (contains? manifest :entries)
    (fail! :awai.fs.codec/missing-key "awai fs codec: missing manifest entries" {:kind :manifest}))
  {:header (mc/decode header) :entries (decode-entries entries)})

;; ---- minimal CARv2 container (record-only framing) ----

(def ^:private carv2-pragma
  "CARv2 pragma: CBOR {\"version\": 2}."
  [0x0a 0xa1 0x67 0x76 0x65 0x72 0x73 0x69 0x6f 0x6e 0x02])

(def ^:private carv2-header-len 51)

(defn- check-count!
  [n what type]
  (when (or (not (integer? n)) (neg? n))
    (fail! type (str "awai fs car: " what " must be a non-negative integer") {:value n})))

(defn- uvarint-bytes
  "Unsigned varint bytes for n (portable arithmetic, no wide bit shifts)."
  [n]
  (check-count! n "length" :awai.fs.car/bad-value)
  (loop [n n out []]
    (let [b (rem n 128) n2 (quot n 128)]
      (if (zero? n2)
        (conj out b)
        (recur n2 (conj out (+ b 128)))))))

(defn- read-uvarint
  "Read an unsigned varint at pos. Returns [n pos-after]."
  [bytes pos]
  (loop [p pos mult 1 acc 0]
    (when (>= p (count bytes))
      (fail! :awai.fs.car/truncated "awai fs car: truncated input" {:pos p}))
    (let [b (nth bytes p)]
      (if (< b 128)
        [(+ acc (* mult b)) (inc p)]
        (recur (inc p) (* mult 128) (+ acc (* mult (- b 128))))))))

(defn- u64le-bytes
  "8-byte little-endian encoding of n (exact below 2^53 in both engines)."
  [n]
  (check-count! n "offset" :awai.fs.car/bad-value)
  (mapv (fn [i] (rem (quot n (nth (iterate #(* % 256) 1) i)) 256)) (range 8)))

(defn- read-u64le
  "Read 8 little-endian bytes at pos. Returns [n pos-after]."
  [bytes pos]
  (when (> (+ pos 8) (count bytes))
    (fail! :awai.fs.car/truncated "awai fs car: truncated input" {:pos pos}))
  [(reduce (fn [acc i] (+ (* acc 256) (nth bytes (+ pos 7 (- i))))) 0 (range 8))
   (+ pos 8)])

(defn- cid-bytes
  "ASCII bytes of a multibase CID string (base32 CIDs are ASCII)."
  [cid]
  (mapv (fn [i] #?(:clj (int (.charAt ^String cid i)) :cljs (.charCodeAt cid i)))
        (range (count cid))))

(defn- bytes->str
  "Inverse of cid-bytes for ASCII bytes."
  [bytes]
  (apply str (map char bytes)))

(defn- byte-compare
  "Lexicographic compare of two byte vectors. Returns -1, 0, or 1."
  [a b]
  (let [n (min (count a) (count b))]
    (loop [i 0]
      (if (= i n)
        (compare (count a) (count b))
        (let [d (- (nth a i) (nth b i))]
          (if (zero? d) (recur (inc i)) (if (neg? d) -1 1)))))))

(defn- encode-block
  "One varint-framed block: total ++ cid-len ++ cid ++ data."
  [{:keys [cid data]}]
  (when-not (string? cid)
    (fail! :awai.fs.car/bad-value "awai fs car: block cid must be a string" {:cid cid}))
  (let [cb (cid-bytes cid)
        db (vec data)
        prefix (uvarint-bytes (count cb))
        total (+ (count prefix) (count cb) (count db))]
    (into (uvarint-bytes total) (concat prefix cb db))))

(defn- encode-index-record
  "One sorted-index record: cid-len ++ cid ++ u64le offset ++ u64le size."
  [cid offset size]
  (let [cb (cid-bytes cid)]
    (into (uvarint-bytes (count cb)) (concat cb (u64le-bytes offset) (u64le-bytes size)))))

(defn encode-carv2
  "Frame {:roots [cid...] :blocks [{:cid :data}...]} as a minimal CARv2 byte
  vector. Blocks are stored CID-sorted; the index records data-relative
  offsets and frame sizes."
  [{:keys [roots blocks] :as car}]
  (when-not (map? car)
    (fail! :awai.fs.car/bad-value "awai fs car: container must be a map" {}))
  (doseq [r (or roots [])]
    (when-not (string? r)
      (fail! :awai.fs.car/bad-value "awai fs car: root must be a CID string" {:root r})))
  (doseq [b (or blocks [])]
    (when-not (and (map? b) (contains? b :cid) (contains? b :data))
      (fail! :awai.fs.car/bad-value "awai fs car: block must carry :cid and :data" {:block b})))
  (let [roots (vec (or roots []))
        blocks (vec (sort-by (comp cid-bytes :cid) (or blocks [])))
        prelude (into (uvarint-bytes 1)
                      (concat (uvarint-bytes (count roots))
                              (mapcat (fn [r] (let [cb (cid-bytes r)]
                                                 (concat (uvarint-bytes (count cb)) cb)))
                                      roots)))
        data (into (vec prelude) (mapcat encode-block blocks))
        data-size (count data)
        index-body (loop [bs blocks off (count prelude) out []]
                     (if (empty? bs)
                       out
                       (let [frame (encode-block (first bs))
                             size (count frame)]
                         (recur (rest bs) (+ off size)
                                (conj out {:record (encode-index-record (:cid (first bs)) off size)
                                           :size size})))))
        index (into (uvarint-bytes (count blocks))
                    (mapcat :record index-body))
        index-offset (+ carv2-header-len data-size)
        header (into (vec (repeat 16 0x00))
                         (concat (u64le-bytes carv2-header-len)
                                 (u64le-bytes data-size)
                                 (u64le-bytes index-offset)))]
    (vec (concat carv2-pragma header data index))))

(defn- read-cid-str
  "Read a length-prefixed CID string at pos. Returns [cid pos-after]."
  [bytes pos]
  (let [[len p] (read-uvarint bytes pos)]
    (when (> (+ p len) (count bytes))
      (fail! :awai.fs.car/truncated "awai fs car: truncated input" {:pos p}))
    [(bytes->str (subvec bytes p (+ p len))) (+ p len)]))

(defn decode-carv2
  "Decode a minimal CARv2 byte vector back to {:roots [...] :blocks [...]},
  with block :data as byte vectors. Enforces the pragma, header offsets, a
  sorted index whose offsets match the data frames, and no trailing bytes."
  [raw]
  (let [bytes (vec raw)]
    (when (< (count bytes) carv2-header-len)
      (fail! :awai.fs.car/truncated "awai fs car: truncated input" {:pos 0}))
    (when (not= (subvec bytes 0 (count carv2-pragma)) carv2-pragma)
      (fail! :awai.fs.car/bad-pragma "awai fs car: bad pragma" {}))
    (let [header (subvec bytes (count carv2-pragma) carv2-header-len)
          [data-offset] (read-u64le (vec header) 16)
          [data-size] (read-u64le (vec header) 24)
          [index-offset] (read-u64le (vec header) 32)]
      (when (not= data-offset carv2-header-len)
        (fail! :awai.fs.car/bad-offset "awai fs car: data offset must follow the header"
               {:data-offset data-offset}))
      (when (not= index-offset (+ data-offset data-size))
        (fail! :awai.fs.car/bad-offset "awai fs car: index must follow the data"
               {:index-offset index-offset :data-size data-size}))
      (when (> (+ data-offset data-size) (count bytes))
        (fail! :awai.fs.car/truncated "awai fs car: truncated input" {:pos data-offset}))
      (let [data-end (+ data-offset data-size)
            [version p] (read-uvarint bytes data-offset)]
        (when (not= version 1)
          (fail! :awai.fs.car/bad-version "awai fs car: data must be CARv1" {:version version}))
        (let [[root-count p] (read-uvarint bytes p)]
          (loop [i 0 pos p roots []]
            (if (< i root-count)
              (let [[r pos2] (read-cid-str bytes pos)]
                (recur (inc i) pos2 (conj roots r)))
              (loop [pos pos frames []]
                (if (= pos data-end)
                  (let [[index-count q] (read-uvarint bytes index-offset)
                        _ (when (not= index-count (count frames))
                            (fail! :awai.fs.car/bad-index
                                   "awai fs car: index count must match block count"
                                   {:index-count index-count :blocks (count frames)}))
                        records (loop [i 0 rpos q out []]
                                  (if (= i index-count)
                                    [out rpos]
                                    (let [[cid rpos2] (read-cid-str bytes rpos)
                                          [off rpos3] (read-u64le bytes rpos2)
                                          [size rpos4] (read-u64le bytes rpos3)]
                                      (recur (inc i) rpos4 (conj out {:cid cid :off off :size size})))))]
                    (let [[index-records rend] records]
                      (when (< rend (count bytes))
                        (fail! :awai.fs.car/trailing-bytes "awai fs car: trailing bytes" {:pos rend}))
                      (doseq [[a b] (partition 2 1 (map (comp cid-bytes :cid) index-records))]
                        (when (pos? (byte-compare a b))
                          (fail! :awai.fs.car/unsorted-index "awai fs car: index must be CID-sorted" {})))
                      (doseq [[frame rec] (map vector frames index-records)]
                        (when (or (not= (:cid frame) (:cid rec))
                                  (not= (:off frame) (:off rec))
                                  (not= (:size frame) (:size rec)))
                          (fail! :awai.fs.car/bad-offset
                                 "awai fs car: index record must match its data frame"
                                 {:frame (dissoc frame :data) :record rec})))
                      {:roots roots
                       :blocks (mapv (fn [f] {:cid (:cid f) :data (:data f)}) frames)}))
                  (let [[total fpos] (read-uvarint bytes pos)
                        [cid cpos] (read-cid-str bytes fpos)
                        frame-end (+ fpos total)]
                    (when (> frame-end data-end)
                      (fail! :awai.fs.car/truncated "awai fs car: truncated input" {:pos pos}))
                    (when (> cpos frame-end)
                      (fail! :awai.fs.car/bad-frame "awai fs car: frame overruns its length" {:pos pos}))
                    (recur frame-end
                           (conj frames {:cid cid :off (- pos data-offset)
                                         :size (- frame-end pos)
                                         :data (subvec bytes cpos frame-end)}))))))))))))

;; ---- range scan over manifest entries ----

(defn- check-size!
  [n what type]
  (when (or (not (integer? n)) (neg? n))
    (fail! type (str "awai fs: " what " must be a non-negative integer") {what n})))

(defn range-entries
  "Entries of manifest overlapped by the file byte range
  [offset, offset+length). Each result keeps its entry keys plus
  :read-offset and :read-length. Reads past the end are refused, never
  shortened. Zero-length reads return []."
  [manifest offset length]
  (let [file-size (:file-size manifest)]
    (check-size! file-size "file-size" :awai.fs/invalid-manifest)
    (check-size! offset "offset" :awai.fs/negative-offset)
    (check-size! length "length" :awai.fs/negative-length)
    (let [end (+ offset length)]
      (when (> offset file-size)
        (fail! :awai.fs/range-past-end "awai fs: read starts past the end"
               {:offset offset :file-size file-size}))
      (when (> end file-size)
        (fail! :awai.fs/range-past-end "awai fs: read extends past the end"
               {:offset offset :length length :file-size file-size}))
      (if (zero? length)
        []
        (into []
              (comp (filter (fn [e]
                              (and (< (:offset e) end)
                                   (> (+ (:offset e) (:length e)) offset))))
                    (map (fn [e]
                           (let [read-offset (max offset (:offset e))
                                 read-end (min end (+ (:offset e) (:length e)))]
                             (assoc e
                                    :read-offset read-offset
                                    :read-length (- read-end read-offset))))))
              (:entries manifest))))))
