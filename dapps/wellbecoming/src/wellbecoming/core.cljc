(ns wellbecoming.core
  "Self-referenced wellbecoming measurement core.

  Implements the PROPOSED spec of network-awai root ADR 2611071400 (JUN-997). The constants in
  `default-opts` are provisional until the owner decides them. Pure: no I/O, regular expressions,
  dates or platform numbers. Observations are integers in permille (0..1000, higher is better) and
  days are integers, so every number here is exact and the same on ClojureScript, Babashka and
  Basilisp. A delta is an integer in milli-z, truncated toward zero.

  The baseline is the person's own history only. Nothing here reads another person's value."
  (:require [clojure.string :as str]))

(def default-opts
  {:current-days 14
   :baseline-days 90
   :min-current 5
   :min-baseline 20
   :floor-permille 50
   :tau-milli 500})

(def directions
  #{"improving" "stable" "worsening" "mixed" "insufficient-history"})

(defn- clip [lo hi x] (max lo (min hi x)))

(defn- abs* [n] (if (neg? n) (- n) n))

(defn- pos-int? [n] (and (integer? n) (pos? n)))

(defn- valid-opts? [{:keys [current-days baseline-days min-current min-baseline floor-permille tau-milli]}]
  (every? pos-int? [current-days baseline-days min-current min-baseline floor-permille tau-milli]))

(defn- valid-obs? [o]
  (and (map? o)
       (integer? (:day o))
       (integer? (:x o))
       (<= 0 (:x o) 1000)))

(defn- med2
  "Twice the median of xs, so an even count stays an integer. nil when xs is empty."
  [xs]
  (let [v (vec (sort xs))
        n (count v)]
    (when (pos? n)
      (if (odd? n)
        (* 2 (nth v (quot n 2)))
        (+ (nth v (dec (quot n 2))) (nth v (quot n 2)))))))

(defn- xs-in
  "Values observed on days in (from, to]."
  [obs from to]
  (mapv :x (filter #(and (> (:day %) from) (<= (:day %) to)) obs)))

(defn- invalid [reason] {:status "invalid" :reason reason})

(defn dimension-delta
  "Delta of one dimension against the person's own past, in milli-z.

  current window C = (end-day - current-days, end-day]
  baseline window B = the baseline-days before C
  delta = (median C - median B) / max(1.4826 * MAD(B), floor), truncated toward zero.

  status is \"ok\", \"insufficient\" (too few observations in C or B, or none given) or \"invalid\"
  (bad input or options, with a reason). An insufficient or invalid dimension is never read as 0."
  ([obs end-day] (dimension-delta obs end-day nil))
  ([obs end-day opts]
   (let [o (merge default-opts opts)
         obs (or obs [])]
     (cond
       (not (valid-opts? o)) (invalid "bad-options")
       (not (integer? end-day)) (invalid "bad-end-day")
       (not (sequential? obs)) (invalid "bad-observation")
       (not-every? valid-obs? obs) (invalid "bad-observation")
       :else
       (let [c-from (- end-day (:current-days o))
             b-from (- c-from (:baseline-days o))
             cs (xs-in obs c-from end-day)
             bs (xs-in obs b-from c-from)]
         (if (or (< (count cs) (:min-current o)) (< (count bs) (:min-baseline o)))
           {:status "insufficient" :current-count (count cs) :baseline-count (count bs)}
           (let [mc2 (med2 cs)
                 mb2 (med2 bs)
                 ;; 4 * MAD(B): the median of |2x - 2 median| is 2 * MAD, doubled again by med2
                 mad4 (med2 (map #(abs* (- (* 2 %) mb2)) bs))
                 ;; 40000 * max(1.4826 * MAD, floor), with 1.4826 as 14826/10000
                 scale (max (* 14826 mad4) (* (:floor-permille o) 40000))
                 delta (quot (* 20000000 (- mc2 mb2)) scale)]
             {:status "ok"
              :delta-milli delta
              :current-count (count cs)
              :baseline-count (count bs)})))))))

(defn- ok? [r] (= "ok" (:status r)))

(defn direction
  "Direction from per-dimension results. Decided from the worst side, never from a mean, so one
  worsening dimension is not averaged away. Fewer than two usable dimensions is
  \"insufficient-history\"."
  ([results] (direction results nil))
  ([results opts]
   (let [tau (:tau-milli (merge default-opts opts))
         ds (map :delta-milli (filter ok? (vals results)))
         worse (some #(<= % (- tau)) ds)
         better (some #(>= % tau) ds)]
     (cond
       (< (count ds) 2) "insufficient-history"
       (and worse better) "mixed"
       worse "worsening"
       better "improving"
       :else "stable"))))

(defn local-index-milli
  "Display-only index for the person, in [-1000, 1000]: the mean of the clipped deltas / 3. It stays
  on the device and is never exported, paid, ranked or used for placement. nil with no usable
  dimension."
  [results]
  (let [ds (map :delta-milli (filter ok? (vals results)))]
    (when (seq ds)
      (quot (reduce + (map #(quot (clip -3000 3000 %) 3) ds)) (count ds)))))

(defn assess
  "series is a map of dimension -> observations [{:day d :x permille}]."
  ([series end-day] (assess series end-day nil))
  ([series end-day opts]
   (let [results (into {} (map (fn [[k obs]] [k (dimension-delta obs end-day opts)]) series))]
     {:dimensions results
      :direction (direction results opts)
      :local-index-milli (local-index-milli results)})))

(defn confirm
  "Hysteresis over successive windows. state is {:confirmed d :pending d :count n} or nil.
  worsening is confirmed at once. Any other change needs the same raw direction twice in a row.
  The first window is accepted as it is."
  [state raw]
  (let [{:keys [confirmed pending count]} state]
    (cond
      (nil? confirmed) {:confirmed raw :pending nil :count 0}
      (= raw confirmed) {:confirmed confirmed :pending nil :count 0}
      (= raw "worsening") {:confirmed raw :pending nil :count 0}
      (= raw pending) (if (>= (inc count) 2)
                        {:confirmed raw :pending nil :count 0}
                        {:confirmed confirmed :pending raw :count (inc count)})
      :else {:confirmed confirmed :pending raw :count 1})))

;; The only record that may leave the device.

(def export-keys
  #{"pseudonymDid" "windowEnd" "trajectoryDirection" "attestationCid" "encryptedPayloadCid"})

(def ^:private forbidden-fragments
  ["population" "cohort" "peer" "norm" "percentile" "rank" "leaderboard" "healthscore" "score"
   "index" "delta"])

(defn- key-name [k]
  (if (or (keyword? k) (string? k)) (name k) (str k)))

(defn- forbidden-name? [s]
  (let [n (-> s str/lower-case (str/replace "-" "") (str/replace "_" ""))]
    (boolean (some #(str/includes? n %) forbidden-fragments))))

(defn- nonblank-string? [s] (and (string? s) (not (str/blank? s))))

(defn validate-export
  "Refuses anything but the five export fields. A field that would compare people or carry a score
  is refused as \"forbidden-field\" before the closed-set check, so the reason names the rule that
  was broken."
  [m]
  (if-not (map? m)
    {:ok false :reason "not-a-record"}
    (let [names (sort (map key-name (keys m)))
          forbidden (first (filter forbidden-name? names))
          unknown (first (remove export-keys names))
          missing (first (remove (set names) (sort export-keys)))
          value (fn [n] (some (fn [[k v]] (when (= n (key-name k)) v)) m))]
      (cond
        forbidden {:ok false :reason "forbidden-field" :field forbidden}
        unknown {:ok false :reason "unknown-field" :field unknown}
        missing {:ok false :reason "missing-field" :field missing}
        (not (contains? directions (value "trajectoryDirection"))) {:ok false :reason "bad-direction"}
        (not (integer? (value "windowEnd"))) {:ok false :reason "bad-window-end"}
        (not-every? nonblank-string?
                    (map value ["pseudonymDid" "attestationCid" "encryptedPayloadCid"]))
        {:ok false :reason "bad-value"}
        :else {:ok true}))))

(defn export-record
  "Builds the export record and checks it. Deltas, the local index and raw observations have no
  place in it; they belong inside the encrypted payload."
  [pseudonym-did window-end direction attestation-cid encrypted-payload-cid]
  (let [r {:pseudonymDid pseudonym-did
           :windowEnd window-end
           :trajectoryDirection direction
           :attestationCid attestation-cid
           :encryptedPayloadCid encrypted-payload-cid}
        v (validate-export r)]
    (if (:ok v) {:ok true :record r} v)))
