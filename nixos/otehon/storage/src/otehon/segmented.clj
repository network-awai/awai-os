(ns otehon.segmented
  "Explicit physical Zstd-3 framing over unchanged canonical CAR bytes.
  Not a CAR dialect, encryption format, authority or native fallback."
  (:require [clojure.edn :as edn] [otehon.storage :as store])
  (:import [java.io ByteArrayOutputStream PushbackReader StringReader]
           [java.nio ByteBuffer] [java.security MessageDigest]
           [java.util Arrays] [java.util.concurrent TimeUnit]))
(def frame-size 65536)
(def max-size 1048576)
(def magic (.getBytes "AWZP003\n" "US-ASCII"))
(defn- fail! [type message] (throw (ex-info message {:type type})))
(defn sha [^bytes b]
  (.formatHex (java.util.HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") b)))
(defn- hash? [s] (and (string? s) (boolean (re-matches #"[a-f0-9]{64}" s))))
(defn- bounded-stream [stream ceiling]
  (with-open [in stream out (ByteArrayOutputStream.)]
    (let [b (byte-array 8192)]
      (loop [total 0]
        (let [n (.read in b)]
          (if (neg? n) (.toByteArray out)
            (let [total (+ total n)]
              (when (> total ceiling) (fail! :zstd-output-too-large "Zstd output exceeds frame bound"))
              (.write out b 0 n) (recur total))))))))
(defn- zstd
  ([input decode?] (zstd input decode? (+ frame-size 1024)))
  ([^bytes input decode? output-ceiling]
  (let [command (into [(or (System/getenv "OTEHON_ZSTD") "zstd") "-q" "-T1"]
                      (if decode? ["-d" "--memory=8MB" "-c"] ["-3" "-c"]))
        p (.start (ProcessBuilder. ^java.util.List command))
        output (future (bounded-stream (.getInputStream p) output-ceiling))
        error (future (bounded-stream (.getErrorStream p) 4096))
        writer (future (with-open [w (.getOutputStream p)] (.write w input)))]
    (try
      (when-not (.waitFor p 5 TimeUnit/SECONDS) (fail! :zstd-timeout "Zstd frame deadline exceeded"))
      (when-not (zero? (.exitValue p)) (fail! :zstd-refused "Zstd refused frame"))
      (deref writer 1000 nil)
      (let [result (deref output 1000 ::timeout)]
        (when (= ::timeout result) (fail! :zstd-timeout "Zstd output deadline exceeded"))
        result)
      (finally (.destroyForcibly p) (future-cancel writer) (future-cancel output) (future-cancel error))))))
(defn decode-bounded-zstd
  "Decode a complete caller-bounded Zstd stream under an explicit output limit."
  [bytes ceiling]
  (when-not (and (bytes? bytes) (integer? ceiling) (<= 1 ceiling max-size)
                 (<= 1 (alength ^bytes bytes) max-size))
    (fail! :invalid-zstd-bounds "invalid compressed input or output bound"))
  (zstd bytes true ceiling))
(defn encode [^bytes car]
  (when-not (<= 1 (alength car) max-size) (fail! :too-large "invalid CAR size"))
  (let [parts (mapv (fn [start] (Arrays/copyOfRange car start (min (alength car) (+ start frame-size))))
                    (range 0 (alength car) frame-size))
        packed (mapv (fn [raw] (let [z (zstd raw false)]
                               (if (< (alength ^bytes z) (alength ^bytes raw))
                                 {:bytes z :encoding :zstd3} {:bytes raw :encoding :raw}))) parts)
        frames (loop [i 0 offset 0 out []]
                 (if (= i (count parts)) out
                   (let [raw (nth parts i) {:keys [bytes encoding]} (nth packed i)]
                     (recur (inc i) (+ offset (alength ^bytes bytes))
                       (conj out {:raw-offset (* i frame-size) :raw-size (alength ^bytes raw)
                                  :stored-offset offset :stored-size (alength ^bytes bytes)
                                  :encoding encoding :raw-sha (sha raw) :stored-sha (sha bytes)})))))
        header (.getBytes (pr-str {:format :awai.otehon-store/zstd3-v1 :car-size (alength car) :frames frames}) "UTF-8")]
    (when (> (alength header) 32768) (fail! :too-large "frame directory too large"))
    (with-open [out (ByteArrayOutputStream.)]
      (.write out magic)
      (.write out (.array (.putInt (ByteBuffer/allocate 4) (alength header))))
      (.write out header)
      (doseq [p packed] (.write out ^bytes (:bytes p)))
      (let [bytes (.toByteArray out)]
        (when (> (alength bytes) max-size) (fail! :too-large "segmented Pack exceeds 1 MiB"))
        bytes))))
(defn- parse-header [^bytes bytes]
  (when-not (and (<= 13 (alength bytes) max-size)
                (Arrays/equals magic (Arrays/copyOfRange bytes 0 8)))
    (fail! :invalid-zpack "invalid segmented Pack magic/size"))
  (let [length (.getInt (ByteBuffer/wrap bytes 8 4)) prefix (+ 12 length)]
    (when-not (and (<= 1 length 32768) (<= prefix (alength bytes)))
      (fail! :invalid-zpack "invalid frame directory size"))
    (with-open [r (PushbackReader. (StringReader. (String. bytes 12 length "UTF-8")))]
      (let [opts {:eof ::eof :readers {} :default (fn [& _] (fail! :invalid-zpack "tagged directory refused"))}
            h (edn/read opts r)]
        (when-not (and (= ::eof (edn/read opts r)) (map? h)
                      (= #{:format :car-size :frames} (set (keys h)))
                      (= :awai.otehon-store/zstd3-v1 (:format h))
                      (integer? (:car-size h)) (<= 1 (:car-size h) max-size)
                      (vector? (:frames h)) (<= 1 (count (:frames h)) 16))
          (fail! :invalid-zpack "invalid frame directory"))
        (loop [[f & more] (:frames h) raw 0 stored 0]
          (if-not f
            (when-not (and (= raw (:car-size h)) (= (+ prefix stored) (alength bytes)))
              (fail! :invalid-zpack "frame extents do not close"))
            (do
              (when-not (and (map? f)
                            (= #{:raw-offset :raw-size :stored-offset :stored-size :encoding :raw-sha :stored-sha} (set (keys f)))
                            (= raw (:raw-offset f)) (= stored (:stored-offset f))
                            (integer? (:raw-size f)) (<= 1 (:raw-size f) frame-size)
                            (or (empty? more) (= frame-size (:raw-size f)))
                            (integer? (:stored-size f)) (<= 1 (:stored-size f) (:raw-size f))
                            (contains? #{:raw :zstd3} (:encoding f))
                            (or (= :zstd3 (:encoding f)) (= (:raw-size f) (:stored-size f)))
                            (hash? (:raw-sha f)) (hash? (:stored-sha f)))
                (fail! :invalid-zpack "invalid or overlapping frame"))
              (recur more (+ raw (:raw-size f)) (+ stored (:stored-size f))))))
        (assoc h :prefix-size prefix :stored-size (alength bytes))))))
(defn- decode-frames [pairs]
  ;; Independent Zstd frames concatenate losslessly. Batch only cache misses
  ;; into one bounded decoder invocation, then verify each exact raw frame.
  (doseq [[f ^bytes stored] pairs]
    (when-not (and (= (:stored-size f) (alength stored)) (= (:stored-sha f) (sha stored)))
      (fail! :corrupt-frame "compressed frame digest mismatch")))
  (let [compressed (filterv #(= :zstd3 (:encoding (first %))) pairs)
        expected (reduce + 0 (map #(:raw-size (first %)) compressed))
        decoded (when (seq compressed)
                  (with-open [out (ByteArrayOutputStream.)]
                    (doseq [[_ bytes] compressed] (.write out ^bytes bytes))
                    (zstd (.toByteArray out) true expected)))]
    (when (and decoded (not= expected (alength ^bytes decoded)))
      (fail! :corrupt-frame "batched decoded size mismatch"))
    (loop [[[f stored] & more] pairs offset 0 out []]
      (if-not f out
        (let [z? (= :zstd3 (:encoding f))
              raw (if z? (Arrays/copyOfRange ^bytes decoded offset (+ offset (:raw-size f))) stored)]
          (when-not (and (= (:raw-size f) (alength ^bytes raw)) (= (:raw-sha f) (sha raw)))
            (fail! :corrupt-frame "decoded frame digest/length mismatch"))
          (recur more (if z? (+ offset (:raw-size f)) offset) (conj out raw)))))))
(defn decode [^bytes bytes]
  (let [layout (parse-header bytes)]
    (with-open [out (ByteArrayOutputStream.)]
      (doseq [raw (decode-frames
                    (mapv (fn [f] (let [start (+ (:prefix-size layout) (:stored-offset f))]
                                    [f (Arrays/copyOfRange bytes start (+ start (:stored-size f)))])) (:frames layout)))]
        (.write out ^bytes raw))
      {:car (.toByteArray out) :layout layout})))
(defn- overlap? [a n b m] (and (< a (+ b m)) (< b (+ a n))))
(defn- cache! [cache key value]
  (swap! cache (fn [{:keys [order values]}]
                 (let [order (conj (vec (remove #{key} order)) key)
                       order (vec (take-last 4 order))]
                   {:order order :values (select-keys (assoc values key value) order)}))) value)
(defn read-ranges
  "Check/read selected complete frames against a fully verified recovered
  directory. Recheck compressed bytes even on bounded decoded-cache hits.
  Unread frames/header are not scrubbed here; decode/recovery/export are strict."
  [directory digest layout spans cache stats]
  (let [needed (filterv (fn [f] (some #(overlap? (:offset %) (:length %) (:raw-offset f) (:raw-size f)) spans)) (:frames layout))
        disk-spans (mapv (fn [f] {:offset (+ (:prefix-size layout) (:stored-offset f)) :length (:stored-size f)}) needed)
        stored (store/read-payload-segments directory digest "zpack" (:stored-size layout) disk-spans)
        _ (doseq [[f bytes] (map vector needed stored)]
            (when-not (= (:stored-sha f) (sha bytes)) (fail! :corrupt-frame "selected frame changed")))
        hits (:values @cache)
        misses (filterv (fn [[f _]] (not (contains? hits (:stored-sha f)))) (mapv vector needed stored))
        fresh (zipmap (map #(:stored-sha (first %)) misses) (decode-frames misses))
        _ (when (some #(= :zstd3 (:encoding (first %))) misses)
            (swap! stats update :decoder-processes (fnil inc 0)))
        decoded (mapv (fn [f]
                        (let [key (:stored-sha f) hit (get hits key)]
                          (swap! stats update (if hit :decoded-cache-hits :frame-decodes) (fnil inc 0))
                          (cache! cache key (or hit (get fresh key))))) needed)]
    (swap! stats #(-> % (update :car-reads inc) (update :bytes-read + (reduce + 0 (map :stored-size needed)))))
    (mapv (fn [{:keys [offset length]}]
            (with-open [out (ByteArrayOutputStream.)]
              (doseq [[f raw] (map vector needed decoded)]
                (let [start (max offset (:raw-offset f)) end (min (+ offset length) (+ (:raw-offset f) (:raw-size f)))]
                  (when (< start end) (.write out ^bytes raw (int (- start (:raw-offset f))) (int (- end start))))))
              (.toByteArray out))) spans)))
