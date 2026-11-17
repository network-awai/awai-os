(ns awai.fs.manifest-codec
  "P1 limited codec: one versioned manifest header shape (AWAI-236).

  Shape awai.fs.manifest/v1 is the fixed header map
    {:v 1 :file-size F :leaf-size L :pack-target T :chunk-count C :pack-count P}
  with non-negative integer values. Keys are DAG-CBOR text in canonical
  order (length first, then bytewise):
    v, file-size, leaf-size, pack-count, chunk-count, pack-target.

  This codec must emit bytes identical to the generic canonical DAG-CBOR
  encoder for the same node; pinned oracle fixtures in manifest_codec_test
  enforce that. Anything outside the shape is refused, never guessed.
  Entry payloads are the next unit, not this one."
  (:refer-clojure :exclude []))

(def ^:const shape-version 1)

(def ^:private key-bytes
  "Canonical key order with UTF-8 byte vectors and value types."
  [[:v [0x76] :uint]
   [:file-size [0x66 0x69 0x6c 0x65 0x2d 0x73 0x69 0x7a 0x65] :uint]
   [:leaf-size [0x6c 0x65 0x61 0x66 0x2d 0x73 0x69 0x7a 0x65] :uint]
   [:pack-count [0x70 0x61 0x63 0x6b 0x2d 0x63 0x6f 0x75 0x6e 0x74] :uint]
   [:chunk-count [0x63 0x68 0x75 0x6e 0x6b 0x2d 0x63 0x6f 0x75 0x6e 0x74] :uint]
   [:pack-target [0x70 0x61 0x63 0x6b 0x2d 0x74 0x61 0x72 0x67 0x65 0x74] :uint]])

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

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
           (bit-and (bit-shift-right n 40) 0xff)
           (bit-and (bit-shift-right n 32) 0xff)
           (bit-and (bit-shift-right n 24) 0xff)
           (bit-and (bit-shift-right n 16) 0xff)
           (bit-and (bit-shift-right n 8) 0xff)
           (bit-and n 0xff)]))

(defn- head
  "Shortest-form head bytes for major with value n."
  [major n]
  (let [h (uint-head n)]
    (into [(bit-or (bit-shift-left major 5) (bit-and (first h) 0x1f))] (rest h))))

(defn- encode-value
  "Encode a value by its table type: uint or bool."
  [v t kind k]
  (case t
    :uint (do
            (when-not (and (integer? v) (not (neg? v)))
              (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a non-negative integer"
                     {:kind kind :key k :value v}))
            (uint-head v))
    :bool (do
            (when-not (boolean? v)
              (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a boolean"
                     {:kind kind :key k :value v}))
            [(if v 0xf5 0xf4)])))

(defn encode
  "Encode a v1 manifest header map to canonical DAG-CBOR bytes (vector of
  byte ints). Refuses anything outside the shape."
  [header]
  (when-not (map? header)
    (fail! :awai.fs.codec/not-a-map "awai fs codec: header must be a map" {}))
  (let [want (mapv first key-bytes)
        have (set (keys header))]
    (doseq [k want]
      (when-not (contains? have k)
        (fail! :awai.fs.codec/missing-key "awai fs codec: missing key" {:key k})))
    (doseq [k (keys header)]
      (when-not (contains? (set want) k)
        (fail! :awai.fs.codec/unknown-key "awai fs codec: unknown key" {:key k})))
    (when-not (= shape-version (:v header))
      (fail! :awai.fs.codec/unknown-version "awai fs codec: unknown shape version"
             {:v (:v header)}))
    (doseq [k (rest want)]
      (let [v (get header k)]
        (when-not (and (integer? v) (not (neg? v)))
          (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a non-negative integer"
                 {:key k :value v}))))
    (into [(first (head 5 (count key-bytes)))]
          (mapcat (fn [[k kb]]
                    (let [v (get header k)]
                      (concat [(+ 0x60 (count kb))] kb (uint-head v))))
                  key-bytes))))

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

(defn- read-map-pairs
  "Read n text->value pairs at pos. Returns [pairs end-pos] where each pair
  is [key-bytes value]. Refuses non-text keys, non-uint/bool values,
  indefinite lengths, and truncated input."
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

(defn- check-value
  "Validate a decoded value against its table type."
  [v t kind k]
  (case t
    :uint (if (and (integer? v) (not (neg? v)))
            v
            (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a non-negative integer"
                   {:kind kind :key k :value v}))
    :bool (if (boolean? v)
            v
            (fail! :awai.fs.codec/bad-value "awai fs codec: value must be a boolean"
                   {:kind kind :key k :value v}))))

(defn- check-keys
  "Enforce the exact key set in canonical order with per-key value types.
  Returns a keyword map built positionally against want-table (only valid
  after the order check)."
  [read-pairs want-table kind]
  (let [got-keys (mapv first read-pairs)
        want-keys (mapv second want-table)]
    (doseq [kb got-keys]
      (when-not (some #(= % kb) want-keys)
        (fail! :awai.fs.codec/unknown-key "awai fs codec: unknown key" {:key kb})))
    (when (not= got-keys want-keys)
      (fail! :awai.fs.codec/bad-key-order "awai fs codec: keys out of canonical order" {}))
    (into {} (map (fn [[_ v] [k _ t]] [k (check-value v t kind k)])
                   read-pairs want-table))))

(defn- encode-map
  "Encode header (a string->value map) with key-table order. Values are
  validated and encoded by their table type (:uint or :bool)."
  [header want-table kind]
  (let [want (mapv first want-table)
        have (set (keys header))]
    (doseq [k want]
      (when-not (contains? have k)
        (fail! :awai.fs.codec/missing-key "awai fs codec: missing key" {:kind kind :key k})))
    (doseq [k (keys header)]
      (when-not (contains? (set want) k)
        (fail! :awai.fs.codec/unknown-key "awai fs codec: unknown key" {:kind kind :key k})))
    (mapcat (fn [[k kb t]]
              (concat [(+ 0x60 (count kb))] kb (encode-value (get header k) t kind k)))
            want-table)))

(defn decode
  "Decode canonical v1 manifest header bytes to a header map. Enforces the
  exact key set, canonical key order, and no trailing bytes."
  [raw]
  (let [bytes (vec raw)]
    (when (empty? bytes)
      (fail! :awai.fs.codec/truncated "awai fs codec: truncated input" {:pos 0}))
    (let [[major n pos] (read-head bytes 0)]
      (when (not= major 5)
        (fail! :awai.fs.codec/not-a-map "awai fs codec: input is not a map" {:major major}))
      (when (not= n (count key-bytes))
        (fail! :awai.fs.codec/bad-pair-count "awai fs codec: wrong pair count" {:n n}))
      (let [[read-pairs end] (read-map-pairs bytes pos n)]
        (when (< end (count bytes))
          (fail! :awai.fs.codec/trailing-bytes "awai fs codec: trailing bytes" {:pos end}))
        (let [by-key (check-keys read-pairs key-bytes :header)]
          (when-not (= shape-version (:v by-key))
            (fail! :awai.fs.codec/unknown-version "awai fs codec: unknown shape version"
                   {:v (:v by-key)}))
          by-key)))))

(def ^:private entry-key-bytes
  "Canonical entry key order (length first, then bytewise):
  pack, index, length, offset, oversized, pack-offset."
  [[:pack [0x70 0x61 0x63 0x6b] :uint]
   [:index [0x69 0x6e 0x64 0x65 0x78] :uint]
   [:length [0x6c 0x65 0x6e 0x67 0x74 0x68] :uint]
   [:offset [0x6f 0x66 0x66 0x73 0x65 0x74] :uint]
   [:oversized [0x6f 0x76 0x65 0x72 0x73 0x69 0x7a 0x65 0x64] :bool]
   [:pack-offset [0x70 0x61 0x63 0x6b 0x5f 0x6f 0x66 0x66 0x73 0x65 0x74] :uint]])

(defn encode-entries
  "Encode manifest entries (sequential of entry maps) to a canonical
  DAG-CBOR array. Each entry is exactly {:pack :index :length :offset
  :oversized :pack-offset}; :oversized is a bool, the rest are
  non-negative integers. Entry order is the caller's planning invariant
  and is preserved, not sorted."
  [entries]
  (when-not (sequential? entries)
    (fail! :awai.fs.codec/not-an-array "awai fs codec: entries must be sequential" {}))
  (into (head 4 (count entries))
        (mapcat (fn [e]
                  (when-not (map? e)
                    (fail! :awai.fs.codec/not-a-map "awai fs codec: entry must be a map" {:entry e}))
                  (concat (head 5 (count entry-key-bytes))
                          (encode-map e entry-key-bytes :entry)))
                entries)))

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
            (let [[pairs p3] (read-map-pairs bytes p2 en)]
              (recur p3 (inc i) (conj out (check-keys pairs entry-key-bytes :entry))))))))))

(defn encode-manifest
  "Encode one versioned manifest shape as two canonical parts: the header
  map and the entries array. Returns {:header [...] :entries [...]}."
  [{:keys [header entries] :as manifest}]
  (when-not (map? manifest)
    (fail! :awai.fs.codec/not-a-map "awai fs codec: manifest must be a map" {}))
  (when-not (contains? manifest :header)
    (fail! :awai.fs.codec/missing-key "awai fs codec: missing manifest header" {:kind :manifest}))
  (when-not (contains? manifest :entries)
    (fail! :awai.fs.codec/missing-key "awai fs codec: missing manifest entries" {:kind :manifest}))
  {:header (encode header) :entries (encode-entries entries)})

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
  {:header (decode header) :entries (decode-entries entries)})
