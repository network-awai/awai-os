(ns awai.fs.vector-scan
  "Vector-lane range planning: width-aligned full lanes plus scalar
  head/tail (AWAI-236, AWAI-533 scope).

  Pure planning only: no SIMD runs here. A half-open index range [lo hi)
  splits into full lanes on absolute width multiples (the vectorizable
  part) with at most one scalar head [lo, lane-start) and one scalar
  tail [lane-end, hi). Lanes, head, and tail tile the range exactly
  once; an empty range yields no work."
  )

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn plan-lanes
  "Split [lo hi) at absolute `width` multiples. Returns {:lanes [[s e]
  ...] :head [s e]|nil :tail [s e]|nil :width width}."
  [lo hi width]
  (when-not (and (integer? width) (pos? width))
    (fail! :awai.fs/invalid-lane-width "awai fs: lane width must be positive" {:width width}))
  (when-not (and (integer? lo) (integer? hi) (not (neg? lo)) (not (neg? hi)))
    (fail! :awai.fs/invalid-range "awai fs: range bounds must be non-negative integers"
           {:lo lo :hi hi}))
  (when (> lo hi)
    (fail! :awai.fs/inverted-range "awai fs: range start must not pass its end" {:lo lo :hi hi}))
  (if (= lo hi)
    {:lanes [] :head nil :tail nil :width width}
    (let [start (* width (quot (+ lo (dec width)) width))
          full (into [] (comp (take-while #(<= (+ % width) hi))
                              (map (fn [s] [s (+ s width)])))
                     (iterate #(+ % width) start))
          head (cond (and (seq full) (< lo (ffirst full))) [lo (ffirst full)]
                     (empty? full) [lo hi])
          tail (when (and (seq full) (< (second (last full)) hi))
                 [(second (last full)) hi])]
      {:lanes full :head head :tail tail :width width})))
