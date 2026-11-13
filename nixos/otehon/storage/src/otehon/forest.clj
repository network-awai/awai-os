(ns otehon.forest
  "Bounded, read-only Forest CAR adapter for the existing SHA-256 CID profile.
  Forest index v1: ChainSafe/forest 7f63144 (Apache-2.0 OR MIT).
  Open verifies every indexed block; this is not a general Forest implementation."
  (:require [awai.fs.car :as car] [otehon.segmented :as segmented])
  (:import [java.nio ByteBuffer ByteOrder] [java.security MessageDigest]
           [java.util Arrays]))

(def max-size (* 1024 1024))
(defn- fail! [type msg] (throw (ex-info msg {:type type})))
(defn- le-long [^bytes b offset]
  (.getLong (doto (ByteBuffer/wrap b offset 8) (.order ByteOrder/LITTLE_ENDIAN))))
(defn- le-int [^bytes b offset]
  (bit-and 0xffffffff (.getInt (doto (ByteBuffer/wrap b offset 4) (.order ByteOrder/LITTLE_ENDIAN)))))
(defn- vbytes [^bytes b] (mapv #(bit-and 255 %) b))
(defn- bytes-of [v] (byte-array (map unchecked-byte v)))
(defn- hash-cid [cid]
  (let [{:keys [codec digest next-offset]} (car/parse-cid cid)
        _ (when-not (= next-offset (count cid)) (fail! :invalid-cid "CID has trailing bytes"))
        digest (bytes-of digest)
        h (reduce bit-xor (bit-xor (long codec) 0x12)
                  (map #(le-long digest %) [0 8 16 24]))]
    ;; Forest's NonMaximalU64::fit is unsigned saturating_sub(1).
    (if (zero? h) 0 (unchecked-dec h))))
(defn- sha [v]
  (vbytes (.digest (MessageDigest/getInstance "SHA-256") (bytes-of v))))
(defn- sections [v]
  (loop [offset 0 out []]
    (if (= offset (count v)) out
      (let [[size start] (car/decode-uvarint v offset) end (+ start size)]
        (when (or (<= size 0) (> end (count v)))
          (fail! :invalid-forest "invalid block section extent"))
        (let [{:keys [next-offset digest]} (car/parse-cid v start)]
          (when (> next-offset end) (fail! :invalid-forest "CID exceeds section"))
          (let [cid (subvec v start next-offset) data (subvec v next-offset end)]
            (when-not (= digest (sha data)) (fail! :cid-mismatch "block bytes do not match CID"))
            (recur end (conj out {:cid cid :bytes data}))))))))
(defn- slice [^bytes b start end]
  (Arrays/copyOfRange b (int start) (int end)))
(defn- decode [b] (vbytes (segmented/decode-bounded-zstd b max-size)))
(defn- candidates [slots buckets distance h]
  (when (pos? buckets)
    (let [unsigned (bigint (Long/toUnsignedString h))
          initial (long (quot (* unsigned buckets) 18446744073709551616N))]
      (loop [i initial left distance found []]
        (when (>= i (count slots)) (fail! :invalid-forest-index "unterminated probe"))
        (if-let [[slot-h p] (nth slots i)]
          (cond
            (= h slot-h) (recur (inc i) left (conj found p))
            (seq found) found
            (zero? left) []
            :else (recur (inc i) (dec left) found))
          found)))))
(defn open
  "Fully validate a bounded Forest v1 index and all SHA-256 blocks. Owns a copy.
  This experimental adapter accepts a single index skippable frame, <=1 MiB
  compressed and <=1 MiB uncompressed; unsupported profiles are rejected."
  [input]
  (when-not (and (bytes? input) (<= 64 (alength ^bytes input) max-size))
    (fail! :invalid-forest "archive outside bounded profile"))
  (let [b (aclone ^bytes input) n (alength b) footer (- n 16)]
    (when-not (and (= 0x184d2a50 (le-int b footer)) (= 8 (le-int b (+ footer 4))))
      (fail! :invalid-forest "missing Forest footer"))
    (let [index-pos (- (le-long b (+ footer 8)) 8)]
      (when-not (and (<= 1 index-pos (- footer 40)) (= 0x184d2a50 (le-int b index-pos))
                     (= footer (+ index-pos 8 (le-int b (+ index-pos 4)))))
        (fail! :invalid-forest "invalid index extent or unsupported multiple index frames"))
      (let [start (+ index-pos 8) version (le-long b start)
            distance (le-long b (+ start 8)) buckets (le-long b (+ start 24))
            table (+ start 32) size (- footer table)]
        (when-not (and (= version 0xdeadbef0) (not (neg? distance)) (not (neg? buckets))
                       (zero? (mod size 16)) (<= buckets (quot size 16))
                       (<= distance (quot size 16)) (<= 1 (quot size 16)))
          (fail! :invalid-forest "unsupported or invalid index header"))
        (let [slots (mapv (fn [offset]
                            (let [h (le-long b offset) p (le-long b (+ offset 8))]
                              (cond
                                (and (= -1 h) (= -1 p)) nil
                                (or (= -1 h) (<= p 0) (>= p index-pos))
                                (fail! :invalid-forest "invalid index slot")
                                :else [h p]))) (range table footer 16))
              entries (vec (remove nil? slots))
              offsets (vec (sort (distinct (map second entries))))]
          (when (or (empty? entries) (> (count offsets) 65) (some? (last slots)))
            (fail! :invalid-forest "empty or unterminated index"))
          (let [first-frame (first offsets)
                header (decode (slice b 0 first-frame))
                ends (zipmap offsets (concat (rest offsets) [index-pos]))
                decoded (reduce (fn [{:keys [total] :as acc} p]
                                  (let [v (decode (slice b p (ends p))) total (+ total (count v))]
                                    (when (> total max-size) (fail! :too-large "decoded CAR exceeds 1 MiB"))
                                    (-> acc (assoc :total total) (assoc-in [:frames p] v))))
                                {:total (count header) :frames {}} offsets)
                raw-frames (:frames decoded)
                frames (into {} (map (fn [p] [p (sections (get raw-frames p))]) offsets))
                pairs (set (for [[p blocks] frames, {:keys [cid]} blocks] [(hash-cid cid) p]))
                indexed (set entries)]
            (when-not (= pairs indexed)
              (fail! :invalid-forest-index "index and verified frame blocks differ"))
            (doseq [[h group] (group-by first entries)]
              (when-not (= (set (map second group)) (set (candidates slots buckets distance h)))
                (fail! :invalid-forest-index "Forest index probe cannot find its blocks")))
            ;; Validate CAR header and all block framing with the owning codec.
            (let [all (into header (mapcat raw-frames offsets))]
              (when (> (count all) max-size) (fail! :too-large "decoded CAR exceeds 1 MiB"))
              (car/carv1-decode all)
              {:bytes b :carv1 all :slots slots :buckets buckets :distance distance :ends ends :index-pos index-pos
               :frame-sha (into {} (map (fn [p] [p (segmented/sha (slice b p (ends p)))]) offsets))})))))))
(defn get-block-from
  "Use a fully validated snapshot's Forest index and a positioned frame reader.
  Recheck the stored frame digest and block CIDs; unread frames are not scrubbed."
  [handle cid read-frame]
  (let [needle (vec cid) h (hash-cid needle)
        positions (distinct (candidates (:slots handle) (:buckets handle) (:distance handle) h))]
    (some (fn [p]
            (let [bytes (read-frame p (- (get (:ends handle) p) p))]
              (when-not (= (get (:frame-sha handle) p) (segmented/sha bytes))
                (fail! :corrupt-frame "Forest frame changed after recovery"))
              (some (fn [block] (when (= needle (:cid block)) (bytes-of (:bytes block))))
                    (sections (decode bytes)))))
          positions)))
(defn get-block
  "Find CID using the embedded index; verify the selected complete frame again.
  nil means absent from the fully verified snapshot."
  [handle cid]
  (get-block-from handle cid #(slice (:bytes handle) %1 (+ %1 %2))))
