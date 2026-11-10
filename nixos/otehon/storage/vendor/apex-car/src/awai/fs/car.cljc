(ns awai.fs.car
  "IPLD content-addressing for Awai FS packs: CIDv1, DAG-CBOR (minimal),
  CARv1, and the CARv2 envelope with a MultihashIndexSorted index.

  Aligned with the IPLD specs (ipld.io/specs/transport/car, codecs/dag-cbor,
  data-model/link): varint = unsigned LEB128; CIDv1 = version+codec+multihash
  with base32 multibase text form; CARv1 = header block + CID:Bytes sections;
  CARv2 = 11-byte pragma + 40-byte header + CARv1 payload + index.

  Values are byte-vecs (unsigned 0-255, portable across clj/cljs) unless a
  name says otherwise. Hashing stays with the caller (see awai.fs.large-file):
  this namespace never digests; it only frames digests as CIDs and blocks as
  CARs. Every decoder fails closed on truncation, trailing garbage (where
  the spec fixes the extent), and out-of-range codes."
  (:refer-clojure :exclude []))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn- u8
  "Byte value 0-255 regardless of signed (JVM) or unsigned (node) vecs."
  [b]
  (bit-and b 0xff))

;; Unsigned LEB128 ("varint" in the CAR specs).
(defn encode-uvarint
  "Encode non-negative integer `n` as unsigned LEB128 bytes."
  [n]
  (when (or (not (integer? n)) (neg? n))
    (fail! :awai.fs/invalid-varint "awai fs: varint must be non-negative"
           {:value n}))
  (loop [v n out []]
    (let [lo (bit-and v 0x7f)
          hi (bit-shift-right v 7)]
      (if (zero? hi)
        (conj out lo)
        (recur hi (conj out (bit-or lo 0x80)))))))

(defn decode-uvarint
  "Read an unsigned LEB128 at `offset`. Returns [value next-offset].
  Fails closed on truncation or > 64-bit overflow."
  [bytes offset]
  (loop [o offset shift 0 acc 0]
    (when (>= o (count bytes))
      (fail! :awai.fs/truncated-varint "awai fs: truncated varint"
             {:offset offset}))
    (let [b (u8 (nth bytes o))]
      (when (or (not (integer? b)) (< b 0) (> b 255))
        (fail! :awai.fs/invalid-byte "awai fs: not a byte" {:byte b}))
      (let [acc (+ acc (bit-shift-left (bit-and b 0x7f) shift))]
        (if (zero? (bit-and b 0x80))
          [acc (inc o)]
          (do (when (>= shift 63)
                (fail! :awai.fs/varint-overflow "awai fs: varint overflows 64 bits"
                       {:offset offset}))
              (recur (inc o) (+ shift 7) acc)))))))

;; Fixed-width little-endian integers (CARv2 header, index buckets).
(defn encode-u32-le [n] (mapv #(bit-and (bit-shift-right n (* % 8)) 0xff) (range 4)))
(defn encode-u64-le
  "Encode `n` as 8 little-endian bytes. Fails closed at 2^32 and above:
  CLJS bitwise ops are 32-bit, so division builds every byte exactly on
  both runtimes."
  [n]
  (when (or (not (integer? n)) (neg? n) (>= n 4294967296))
    (fail! :awai.fs/u64-too-large "awai fs: u64 over 32-bit CLJS range" {:value n}))
  (loop [v n i 0 out []]
    (if (= i 8)
      out
      (recur (quot v 256) (inc i) (conj out (mod v 256))))))

(defn decode-u64-le
  "Read 8 little-endian bytes at `offset`. Returns [value next-offset].
  Horner accumulation stays exact to 2^53 on CLJS; pack extents are
  far below that."
  [bytes offset]
  (when (> (+ offset 8) (count bytes))
    (fail! :awai.fs/truncated-u64 "awai fs: truncated u64" {:offset offset}))
  (loop [i 7 acc 0]
    (if (neg? i)
      [acc (+ offset 8)]
      (recur (dec i) (+ (* acc 256) (u8 (nth bytes (+ offset i))))))))

;; UTF-8 (DAG-CBOR text strings). Surrogate pairs round-trip: astral
;; characters encode to 4 bytes and decode back to a pair.
(defn- code-at
  "UTF-16 code unit of string `s` at `i` as a number."
  [s i]
  #?(:clj (int (.charAt ^String s (int i)))
     :cljs (.charCodeAt s i)))
(defn- encode-point [cp]
  (cond
    (< cp 0x80) [cp]
    (< cp 0x800) [(bit-or 0xc0 (bit-shift-right cp 6))
                  (bit-or 0x80 (bit-and cp 0x3f))]
    (< cp 0x10000) [(bit-or 0xe0 (bit-shift-right cp 12))
                    (bit-or 0x80 (bit-and (bit-shift-right cp 6) 0x3f))
                    (bit-or 0x80 (bit-and cp 0x3f))]
    :else [(bit-or 0xf0 (bit-shift-right cp 18))
            (bit-or 0x80 (bit-and (bit-shift-right cp 12) 0x3f))
            (bit-or 0x80 (bit-and (bit-shift-right cp 6) 0x3f))
            (bit-or 0x80 (bit-and cp 0x3f))]))

(defn utf8-encode
  "Encode string `s` as UTF-8 bytes."
  [s]
  (loop [i 0 out []]
    (if (>= i (count s))
      (vec out)
      (let [c (code-at s i)]
        (if (and (<= 0xD800 c) (<= c 0xDBFF)
                 (< (inc i) (count s)))
          (let [lo (code-at s (inc i))]
            (if (and (<= 0xDC00 lo) (<= lo 0xDFFF))
              (recur (+ i 2) (into out (encode-point
                                        (+ 0x10000
                                           (bit-shift-left (bit-and c 0x3FF) 10)
                                           (bit-and lo 0x3FF)))))
              (recur (inc i) (into out (encode-point c)))))
          (recur (inc i) (into out (encode-point c))))))))

(defn utf8-decode
  "Decode UTF-8 `bytes` (a vec) to a string. Fails closed on bad sequences."
  [bytes]
  (let [n (count bytes)]
    (loop [o 0 out []]
      (if (>= o n)
        (apply str out)
        (let [b (u8 (nth bytes o))]
          (cond
            (< b 0x80) (recur (inc o) (conj out (char b)))
            (< b 0xc2) (fail! :awai.fs/bad-utf8 "awai fs: bad utf8" {:offset o})
            (< b 0xe0)
            (do (when (>= (inc o) n)
                  (fail! :awai.fs/truncated-utf8 "awai fs: truncated utf8" {:offset o}))
                (let [c2 (u8 (nth bytes (inc o)))]
                  (when (not= 0x80 (bit-and c2 0xc0))
                    (fail! :awai.fs/bad-utf8 "awai fs: bad utf8" {:offset o}))
                  (recur (+ o 2) (conj out (char (bit-or (bit-shift-left (bit-and b 0x1f) 6)
                                                         (bit-and c2 0x3f)))))))
            (< b 0xf0)
            (do (when (>= (+ o 2) n)
                  (fail! :awai.fs/truncated-utf8 "awai fs: truncated utf8" {:offset o}))
                (let [c2 (u8 (nth bytes (inc o))) c3 (u8 (nth bytes (+ o 2)))]
                  (when (or (not= 0x80 (bit-and c2 0xc0)) (not= 0x80 (bit-and c3 0xc0)))
                    (fail! :awai.fs/bad-utf8 "awai fs: bad utf8" {:offset o}))
                  (recur (+ o 3) (conj out (char (bit-or (bit-shift-left (bit-and b 0x0f) 12)
                                                         (bit-shift-left (bit-and c2 0x3f) 6)
                                                         (bit-and c3 0x3f)))))))
            (< b 0xf5)
            (do (when (>= (+ o 3) n)
                  (fail! :awai.fs/truncated-utf8 "awai fs: truncated utf8" {:offset o}))
                (let [c2 (u8 (nth bytes (inc o))) c3 (u8 (nth bytes (+ o 2))) c4 (u8 (nth bytes (+ o 3)))]
                  (when (or (not= 0x80 (bit-and c2 0xc0))
                            (not= 0x80 (bit-and c3 0xc0))
                            (not= 0x80 (bit-and c4 0xc0)))
                    (fail! :awai.fs/bad-utf8 "awai fs: bad utf8" {:offset o}))
                  (let [cp (bit-or (bit-shift-left (bit-and b 0x07) 18)
                                    (bit-shift-left (bit-and c2 0x3f) 12)
                                    (bit-shift-left (bit-and c3 0x3f) 6)
                                    (bit-and c4 0x3f))]
                    (if (< cp 0x10000)
                      (recur (+ o 4) (conj out (char cp)))
                      (let [v (- cp 0x10000)]
                        (recur (+ o 4) (conj out (char (+ 0xD800 (bit-shift-right v 10)))
                                                 (char (+ 0xDC00 (bit-and v 0x3FF))))))))))
            :else (fail! :awai.fs/bad-utf8 "awai fs: bad utf8" {:offset o})))))))

;; Base32 (RFC 4648, lowercase, no padding) + multibase 'b' (base32).
(def ^:private b32-chars "abcdefghijklmnopqrstuvwxyz234567")

(defn base32-encode
  "Encode byte-vec `bytes` as lowercase unpadded base32."
  [bytes]
  (loop [o 0 acc 0 bits 0 out []]
    (cond
      (>= bits 5)
      (let [shift (- bits 5)]
        (recur o (bit-and acc (dec (bit-shift-left 1 shift))) shift
               (conj out (nth b32-chars (bit-shift-right acc shift)))))
      (< o (count bytes))
      (recur (inc o) (bit-or (bit-shift-left acc 8) (u8 (nth bytes o))) (+ bits 8) out)
      :else
      (apply str (if (pos? bits)
                   (conj out (nth b32-chars (bit-shift-left acc (- 5 bits))))
                   out)))))

(defn base32-decode
  "Decode lowercase unpadded base32 `s` to a byte-vec. Fails closed."
  [s]
  (let [val (into {} (map-indexed (fn [i c] [c i]) b32-chars))]
    (loop [i 0 acc 0 bits 0 out []]
      (if (>= i (count s))
        (do (when (>= bits 5)
              (fail! :awai.fs/bad-base32 "awai fs: base32 trailing bits" {}))
            (vec out))
        (let [c (.charAt s i)
              v (get val c ::missing)]
          (when (= v ::missing)
            (fail! :awai.fs/bad-base32 "awai fs: bad base32 char" {:char (str c)}))
          (let [acc (bit-or (bit-shift-left acc 5) v)
                bits (+ bits 5)]
            (if (>= bits 8)
              (recur (inc i) (bit-and acc (dec (bit-shift-left 1 (- bits 8))))
                     (- bits 8)
                     (conj out (bit-shift-right acc (- bits 8))))
              (recur (inc i) acc bits out))))))))

;; CIDv1 (version 1 + codec + multihash), text form = multibase base32.
(def ^:const codec-raw 0x55)
(def ^:const codec-dag-cbor 0x71)
(def ^:const codec-dag-pb 0x70)
(def ^:const mh-sha2-256 0x12)
(def ^:const mh-sha2-256-len 0x20)

(defn cid-bytes
  "CIDv1 byte-vec for `codec` over 32-byte sha2-256 `digest`."
  [codec digest]
  (when (not (contains? #{codec-raw codec-dag-cbor codec-dag-pb} codec))
    (fail! :awai.fs/unsupported-codec "awai fs: unsupported codec" {:codec codec}))
  (when (not= 32 (count digest))
    (fail! :awai.fs/bad-digest "awai fs: sha2-256 digest must be 32 bytes"
           {:length (count digest)}))
  (vec (concat (encode-uvarint 1) (encode-uvarint codec)
               (encode-uvarint mh-sha2-256) (encode-uvarint mh-sha2-256-len)
               digest)))

(defn parse-cid
  "Parse CID byte-vec `bytes` at `offset` (default 0). Returns
  {:version :codec :digest :next-offset}. Fails closed."
  ([bytes] (parse-cid bytes 0))
  ([bytes offset]
   (let [[ver o1] (decode-uvarint bytes offset)
         [codec o2] (decode-uvarint bytes o1)
         [mhc o3] (decode-uvarint bytes o2)
         [mlen o4] (decode-uvarint bytes o3)]
     (when (not= 1 ver)
       (fail! :awai.fs/unsupported-cid "awai fs: only CIDv1" {:version ver}))
     (when (not (contains? #{codec-raw codec-dag-cbor codec-dag-pb} codec))
       (fail! :awai.fs/unsupported-codec "awai fs: unsupported codec" {:codec codec}))
     (when (or (not= mh-sha2-256 mhc) (not= mh-sha2-256-len mlen))
       (fail! :awai.fs/unsupported-multihash "awai fs: only sha2-256" {:code mhc :len mlen}))
     (when (> (+ o4 mlen) (count bytes))
       (fail! :awai.fs/truncated-cid "awai fs: truncated cid digest" {:offset offset}))
     {:version ver :codec codec
      :digest (mapv u8 (subvec (vec bytes) o4 (+ o4 mlen)))
      :next-offset (+ o4 mlen)})))

(defn cid-str
  "Multibase-base32 text form of CID byte-vec `cid`."
  [cid]
  (str "b" (base32-encode cid)))

(defn parse-cid-str
  "Parse multibase-base32 CID text. Returns {:version :codec :digest}."
  [s]
  (when (or (empty? s) (not= \b (first s)))
    (fail! :awai.fs/bad-cid-str "awai fs: CID text must start with b" {:text (str s)}))
  (dissoc (parse-cid (base32-decode (subs s 1))) :next-offset))

;; Minimal DAG-CBOR: the subset CAR headers and pack roots need.
;; Encode is canonical (shortest uints, length-first key order, definite
;; lengths). Decode accepts any key order but rejects indefinite lengths,
;; floats, and tags other than 42 (CID link).
(defn- cbor-head [major n]
  (cond (< n 24) [ (bit-or (bit-shift-left major 5) n)]
        (< n 256) [(bit-or (bit-shift-left major 5) 24) n]
        (< n 65536) (vec (concat [(bit-or (bit-shift-left major 5) 25)]
                                [(bit-and (bit-shift-right n 8) 0xff) (bit-and n 0xff)]))
        (< n 4294967296) (vec (concat [(bit-or (bit-shift-left major 5) 26)]
                                     (mapv #(bit-and (bit-shift-right n (* % 8)) 0xff)
                                           (reverse (range 4)))))
        :else (vec (concat [(bit-or (bit-shift-left major 5) 27)]
                           (mapv #(bit-and (bit-shift-right n (* % 8)) 0xff)
                                 (reverse (range 8)))))))

(defn cbor-encode
  "Encode `v` as DAG-CBOR bytes. Supports nil, bool, uint, string,
  byte-vecs, sequential arrays, string-keyed maps, and {:tag 42 :bytes}."
  [v]
  (cond
    (nil? v) [0xf6]
    (true? v) [0xf5]
    (false? v) [0xf4]
    (and (integer? v) (not (neg? v))) (cbor-head 0 v)
    (string? v) (let [bs (utf8-encode v)] (vec (concat (cbor-head 3 (count bs)) bs)))
    (and (map? v) (= 42 (:tag v)) (:bytes v))
    ;; DAG-CBOR's tag 42 byte string carries the identity multibase prefix
    ;; 0x00 followed by the binary CID. The public value still holds a CID.
    (vec (concat (cbor-head 6 42) (cbor-encode {:bytes (into [0] (:bytes v))})))
    (and (map? v) (contains? v :bytes))
    (do (when (some #(or (not (integer? %)) (< % 0) (> % 255)) (:bytes v))
          (fail! :awai.fs/uncodable-cbor "awai fs: byte string needs 0-255 ints" {}))
        (vec (concat (cbor-head 2 (count (:bytes v))) (:bytes v))))
    (sequential? v) (vec (concat (cbor-head 4 (count v)) (mapcat cbor-encode v)))
    (map? v) (let [ks (sort-by (fn [k] [(count (utf8-encode k)) (utf8-encode k)])
                               (keys v))]
               (vec (concat (cbor-head 5 (count v))
                            (mapcat (fn [k] (concat (cbor-encode k) (cbor-encode (get v k))))
                                    ks))))
    :else (fail! :awai.fs/uncodable-cbor "awai fs: cannot dag-cbor encode"
                 {:value (pr-str v)})))

(defn cbor-decode
  "Decode one DAG-CBOR value at `offset`. Returns [value next-offset]."
  [bytes offset]
  (when (>= offset (count bytes))
    (fail! :awai.fs/truncated-cbor "awai fs: truncated cbor" {:offset offset}))
  (let [b (u8 (nth bytes offset))
        major (bit-shift-right b 5)
        info (bit-and b 0x1f)
        arg (fn [o]
              (cond (< info 24) [info (inc o)]
                    (= info 24) [(u8 (nth bytes (inc o))) (+ o 2)]
                    (= info 25) [(+ (bit-shift-left (u8 (nth bytes (inc o))) 8)
                                    (u8 (nth bytes (+ o 2)))) (+ o 3)]
                    (= info 26) [(+ (bit-shift-left (u8 (nth bytes (inc o))) 24)
                                    (bit-shift-left (u8 (nth bytes (+ o 2))) 16)
                                    (bit-shift-left (u8 (nth bytes (+ o 3))) 8)
                                    (u8 (nth bytes (+ o 4)))) (+ o 5)]
                    (= info 27) (let [[v no] (decode-u64-le bytes (inc o))] [v no])
                    :else (fail! :awai.fs/bad-cbor "awai fs: indefinite cbor" {:offset offset})))]
    (case major
      0 (arg offset)
      1 (let [[v no] (arg offset)] [(- -1 v) no])
      2 (let [[n no] (arg offset)]
          (when (> (+ no n) (count bytes))
            (fail! :awai.fs/truncated-cbor "awai fs: truncated bytes" {:offset offset}))
          [{:bytes (vec (subvec (vec bytes) no (+ no n)))} (+ no n)])
      3 (let [[n o2] (arg offset)]
            (when (> (+ o2 n) (count bytes))
              (fail! :awai.fs/truncated-cbor "awai fs: truncated text" {:offset offset}))
            [(utf8-decode (vec (subvec (vec bytes) o2 (+ o2 n)))) (+ o2 n)])
      4 (let [[n no] (arg offset)]
          (loop [i 0 o no out []]
            (if (= i n) [out o]
                (let [[v no2] (cbor-decode bytes o)]
                  (recur (inc i) no2 (conj out v))))))
      5 (let [[n no] (arg offset)]
          (loop [i 0 o no out {}]
            (if (= i n) [out o]
                (let [[k o2] (cbor-decode bytes o)
                      [v o3] (cbor-decode bytes o2)]
                  (when (not (string? k))
                    (fail! :awai.fs/bad-cbor "awai fs: non-string map key" {:offset offset}))
                  (recur (inc i) o3 (assoc out k v))))))
      6 (let [[t no] (arg offset)
              [v no2] (cbor-decode bytes no)]
          (when (not= 42 t)
            (fail! :awai.fs/bad-cbor-tag "awai fs: only tag 42 links" {:tag t}))
          (when (or (not (map? v)) (not (contains? v :bytes))
                    (< (count (:bytes v)) 2) (not= 0 (first (:bytes v))))
            (fail! :awai.fs/bad-cbor-tag "awai fs: tag 42 needs 0x00 plus a CID" {:offset offset}))
          (let [cid (subvec (:bytes v) 1)
                parsed (parse-cid cid)]
            (when (not= (count cid) (:next-offset parsed))
              (fail! :awai.fs/bad-cbor-tag "awai fs: trailing CID link bytes" {:offset offset}))
            [{:tag 42 :bytes cid} no2]))
      7 (cond (= b 0xf6) [nil (inc offset)]
              (= b 0xf4) [false (inc offset)]
              (= b 0xf5) [true (inc offset)]
              :else (fail! :awai.fs/bad-cbor "awai fs: unsupported simple/float"
                           {:offset offset})))))

;; CARv1: varint(header-cbor) header-cbor, then varint(cid+data) cid data...
(defn carv1-encode
  "Encode CARv1 bytes. `roots` is a seq of CID byte-vecs; `blocks` a seq
  of {:cid :bytes}. The first block is the {version:1 roots:[...]} header."
  [{:keys [roots blocks]}]
  (let [header (cbor-encode {"roots" (mapv (fn [c] {:tag 42 :bytes c}) roots)
                             "version" 1})
        section (fn [cid data]
                  (let [body (vec (concat cid data))]
                    (vec (concat (encode-uvarint (count body)) body))))]
    (vec (concat (encode-uvarint (count header)) header
                   (mapcat (fn [{:keys [cid bytes]}] (section cid bytes)) blocks)))))

(defn carv1-decode
  "Decode CARv1 `bytes`. Returns {:version :roots [cid...]
  :blocks [{:cid :bytes :offset}]}; :offset is the section varint position."
  [bytes]
  (let [n (count bytes)
        [hlen ho] (decode-uvarint bytes 0)
        _ (when (> (+ ho hlen) n)
            (fail! :awai.fs/truncated-car "awai fs: truncated car header" {}))
        [header hnext] (cbor-decode (vec (subvec (vec bytes) ho (+ ho hlen))) 0)
        _ (when (not= hnext hlen)
            (fail! :awai.fs/bad-car "awai fs: car header trailing bytes" {}))
        _ (when (or (not (map? header)) (not= 1 (get header "version")))
            (fail! :awai.fs/bad-car "awai fs: car version must be 1"
                   {:header (pr-str header)}))
        roots (get header "roots")
        _ (when (or (not (sequential? roots))
                    (some #(or (not (map? %)) (not= 42 (:tag %))) roots))
            (fail! :awai.fs/bad-car "awai fs: car roots must be CID links" {}))]
    (loop [o (+ ho hlen) blocks []]
      (if (>= o n)
        {:version 1 :roots (mapv :bytes roots) :blocks blocks}
        (let [[slen so] (decode-uvarint bytes o)
              end (+ so slen)]
          (when (or (zero? slen) (> end n))
            (fail! :awai.fs/truncated-car "awai fs: truncated car section" {:offset o}))
          (let [{:keys [next-offset] :as cid} (parse-cid bytes so)
                data (vec (subvec (vec bytes) next-offset end))]
            (recur end (conj blocks {:cid (vec (subvec (vec bytes) so next-offset))
                                     :bytes data :offset o}))))))))

;; Pack table of contents: the root block of an awai pack CAR.
(defn pack-root-block
  "DAG-CBOR root block for a pack whose leaf blocks have `leaf-cids`
  (CID byte-vecs). `hash-fn` maps a byte-vec to its 32-byte sha2-256
  digest (callers hash). Returns {:cid :bytes}."
  [leaf-cids hash-fn]
  (let [body (cbor-encode {"leaves" (mapv (fn [c] {:tag 42 :bytes c}) leaf-cids)})]
    {:cid (cid-bytes codec-dag-cbor (hash-fn body)) :bytes body}))

(defn decode-u32-le
  "Read 4 little-endian bytes at `offset`. Returns [value next-offset]."
  [bytes offset]
  (when (> (+ offset 4) (count bytes))
    (fail! :awai.fs/truncated-u32 "awai fs: truncated u32" {:offset offset}))
  [(+ (u8 (nth bytes offset))
      (bit-shift-left (u8 (nth bytes (+ offset 1))) 8)
      (bit-shift-left (u8 (nth bytes (+ offset 2))) 16)
      (bit-shift-left (u8 (nth bytes (+ offset 3))) 24))
   (+ offset 4)])

;; CARv2 envelope + MultihashIndexSorted (sha2-256 single bucket).
(def carv2-pragma [0x0a 0xa1 0x67 0x76 0x65 0x72 0x73 0x69 0x6f 0x6e 0x02])
(def ^:private index-format-multihash-sorted 0x0401)

(defn- build-index-section
  "Index bytes for `blocks` ([{:cid :offset}]): varint(0x0401), then one
  bucket (code u64LE, width u32LE=40, count u64LE, digest+offset entries
  sorted by digest). Offsets are relative to the CARv1 payload start."
  [blocks]
  (let [pairs (sort-by first
                      (map (fn [{:keys [cid offset]}]
                             [(:digest (parse-cid cid)) offset])
                           blocks))]
    (vec (concat (encode-uvarint index-format-multihash-sorted)
                 (encode-u64-le mh-sha2-256)
                 (encode-u32-le 40)
                 (encode-u64-le (count pairs))
                 (mapcat (fn [[d off]] (concat d (encode-u64-le off))) pairs)))))

(defn carv2-encode
  "Encode CARv2 bytes for `roots` + `blocks` (same shape as carv1-encode):
  pragma + 40-byte header + CARv1 payload + MultihashIndexSorted."
  [{:keys [roots blocks]}]
  (let [payload (carv1-encode {:roots roots :blocks blocks})
        data-offset (+ 11 40)
        ;; Block offsets skip the header block (DAG-CBOR, no CID).
        [hlen hstart] (decode-uvarint payload 0)
        with-offsets (loop [o (+ hstart hlen) out []]
                       (if (>= o (count payload))
                         out
                         (let [[slen so] (decode-uvarint payload o)
                               end (+ so slen)
                               {:keys [next-offset]} (parse-cid payload so)]
                           (recur end
                                  (conj out {:cid (vec (subvec (vec payload) so next-offset))
                                             :offset o})))))
        index (build-index-section with-offsets)
        header (vec (concat (repeat 16 0)
                            (encode-u64-le data-offset)
                            (encode-u64-le (count payload))
                            (encode-u64-le (+ data-offset (count payload)))))]
    (vec (concat carv2-pragma header payload index))))

(defn carv2-decode
  "Decode CARv2 `bytes`. Returns {:version :roots :blocks :index} where
  :index maps digest-vecs to payload-relative block offsets. Fails closed
  on bad pragma, header extents, or index mismatches."
  [bytes]
  (let [n (count bytes)]
    (when (< n 51)
      (fail! :awai.fs/truncated-car "awai fs: too short for carv2" {:length n}))
    (when (not= carv2-pragma (vec (subvec (vec bytes) 0 11)))
      (fail! :awai.fs/bad-car "awai fs: bad carv2 pragma" {}))
    (let [[data-offset o1] (decode-u64-le bytes 27)
          [data-size o2] (decode-u64-le bytes 35)
          [index-offset _] (decode-u64-le bytes 43)
          payload-end (+ data-offset data-size)]
      (when (or (< data-offset 51) (> payload-end n)
                (and (not (zero? index-offset))
                     (or (< index-offset payload-end) (>= index-offset n))))
        (fail! :awai.fs/bad-car "awai fs: bad carv2 extents"
               {:data-offset data-offset :data-size data-size
                :index-offset index-offset}))
      (let [car (carv1-decode (vec (subvec (vec bytes) data-offset payload-end)))
            index (when-not (zero? index-offset)
                    (let [[fmt fo] (decode-uvarint bytes index-offset)]
                      (when (not= index-format-multihash-sorted fmt)
                        (fail! :awai.fs/bad-car-index "awai fs: unsupported index format"
                               {:format fmt}))
                      (loop [o fo acc {}]
                        (if (>= o n)
                          acc
                          (let [[code o1] (decode-u64-le bytes o)
                                [width o2] (decode-u32-le bytes o1)
                                [cnt o3] (decode-u64-le bytes o2)
                                dlen (- width 8)]
                            (when (or (neg? dlen) (<= cnt 0) (> (+ o3 (* cnt width)) n))
                              (fail! :awai.fs/bad-car-index "awai fs: bad index bucket" {}))
                            (recur (+ o3 (* cnt width))
                                   (into acc (map (fn [i]
                                                    (let [e (+ o3 (* i width))]
                                                      [(vec (subvec (vec bytes) e (+ e dlen)))
                                                       (first (decode-u64-le bytes (+ e dlen)))]))
                                                  (range cnt)))))))))]
        (when index
          (doseq [[d off] index]
            (let [hit (first (filter #(= off (:offset %)) (:blocks car)))]
              (when (or (nil? hit) (not= d (:digest (parse-cid (:cid hit)))))
                (fail! :awai.fs/bad-car-index "awai fs: index/blocks mismatch" {})))))
        (assoc car :index (or index {}))))))

;; Hex (chunk shas are hex strings; CIDs need digest bytes).
(defn hex-decode
  "Decode even-length hex string `s` to a byte-vec. Fails closed."
  [s]
  (let [n (count s)
        val (into {} (map-indexed (fn [i c] [c i]) "0123456789abcdef"))]
    (when (or (zero? n) (odd? n))
      (fail! :awai.fs/bad-hex "awai fs: hex needs even length" {:length n}))
    (mapv (fn [i]
            (let [hi (get val (.charAt ^String (str s) (* i 2)) ::missing)
                  lo (get val (.charAt ^String (str s) (inc (* i 2))) ::missing)]
              (when (or (= hi ::missing) (= lo ::missing))
                (fail! :awai.fs/bad-hex "awai fs: bad hex char" {:index i}))
              (bit-or (bit-shift-left hi 4) lo)))
          (range (/ n 2)))))

(def ^:private hex-digits "0123456789abcdef")

(defn hex-encode
  "Encode byte-vec `bytes` as lowercase hex. Fails closed on
  out-of-range values."
  [bytes]
  (let [v (vec bytes)]
    (doseq [b v]
      (when (or (not (integer? b)) (neg? b) (> b 255))
        (fail! :awai.fs/bad-byte "awai fs: hex needs byte values" {:value b})))
    (apply str (mapcat (fn [b] [(.charAt hex-digits (bit-shift-right b 4))
                                (.charAt hex-digits (bit-and b 0x0f))])
                       v))))

;; Section scan: payload-relative offsets without hashing.
(defn carv2-sections
  "Walk a CARv2's payload sections. Returns [{:cid :digest :offset
  :data-offset :length}] with :offset (section start) and :data-offset
  (leaf bytes start) relative to the CARv1 payload start. Fails
  closed on truncation (CIDs are parsed, digests are not re-hashed)."
  [bytes]
  (let [n (count bytes)]
    (when (< n 51)
      (fail! :awai.fs/truncated-car "awai fs: too short for carv2" {:length n}))
    (when (not= carv2-pragma (vec (subvec (vec bytes) 0 11)))
      (fail! :awai.fs/bad-car "awai fs: bad carv2 pragma" {}))
    (let [[data-offset _] (decode-u64-le bytes 27)
          [data-size _] (decode-u64-le bytes 35)
          end (+ data-offset data-size)]
      (when (or (< data-offset 51) (> end n))
        (fail! :awai.fs/bad-car "awai fs: bad carv2 extents" {}))
      (let [[hlen hstart] (decode-uvarint (vec (subvec (vec bytes) data-offset end)) 0)]
        (loop [o (+ data-offset hstart hlen) out []]
          (if (>= o end)
            out
            (let [[slen so] (decode-uvarint bytes o)
                  send (+ so slen)]
              (when (or (zero? slen) (> send end))
                (fail! :awai.fs/truncated-car "awai fs: truncated section" {:offset o}))
              (let [{:keys [digest next-offset]} (parse-cid bytes so)]
                (recur send (conj out {:cid (vec (subvec (vec bytes) so next-offset))
                                       :digest digest
                                       :offset (- o data-offset)
                                       :data-offset (- next-offset data-offset)
                                       :length (- send next-offset)}))))))))))

;; Pack assembly: leaves + table-of-contents root, indexed.
(defn assemble-pack
  "Build a CARv2 pack from leaf `blocks` [{:digest (32-byte vec)
  :bytes (vec)}]. `hash-fn` maps a byte-vec to its sha2-256 digest.
  Returns {:car :index :root-cid :leaf-cids}: :car is the CARv2
  byte-vec (header, leaves, root last), :index maps digest vecs to
  payload-relative block offsets, :root-cid is the pack identity."
  [leaves hash-fn]
  (doseq [{:keys [digest bytes]} leaves]
    (when (not= 32 (count digest))
      (fail! :awai.fs/bad-digest "awai fs: leaf digest must be 32 bytes" {}))
    (when (nil? bytes)
      (fail! :awai.fs/bad-leaf "awai fs: leaf needs bytes" {})))
  (let [leaf-blocks (mapv (fn [{:keys [digest bytes]}]
                            {:cid (cid-bytes codec-raw digest) :bytes bytes})
                          leaves)
        {:keys [cid] :as root-block} (pack-root-block (mapv :cid leaf-blocks) hash-fn)
        car (carv2-encode {:roots [cid] :blocks (conj leaf-blocks root-block)})
        index (into {} (map (fn [{:keys [digest offset]}] [digest offset])
                            (carv2-sections car)))]
    {:car car :index index :root-cid cid
     :leaf-cids (mapv :cid leaf-blocks)}))

;; Range mapping: leaf-stream offsets to pack-file segments.
(defn car-range-segments
  "Map leaf-stream [leaf-offset, leaf-offset+length) onto pack-file
  segments using ordered `leaves` [{:offset :length}] (absolute file
  offsets). Returns [{:offset :length}] covering exactly the in-range
  bytes, clamped to what the leaves hold. Empty when out of range."
  [leaves leaf-offset length]
  (let [end (+ leaf-offset length)]
    (if (<= length 0)
      []
      (loop [ls leaves pos 0 out []]
        (if (or (empty? ls) (>= pos end))
          out
          (let [{lo :offset ll :length} (first ls)
                lend (+ pos ll)]
            (recur (rest ls) lend
                   (if (and (< pos end) (> lend leaf-offset))
                     (let [s (max pos leaf-offset)
                           e (min lend end)]
                       (conj out {:offset (+ lo (- s pos)) :length (- e s)}))
                     out))))))))
