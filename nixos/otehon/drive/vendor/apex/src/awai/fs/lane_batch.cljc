(ns awai.fs.lane-batch
  "Lane-batch scan planning: width-aligned lane batches with scalar edges,
  and one scan op on two paths with a scalar-parity assert (AWAI-236,
  AWAI-533 scope).

  Pure planning only: no SIMD runs here. `plan-batches` wraps
  `vector-scan/plan-lanes` and tags every batch with its kind — :lane
  for the vectorizable part, :scalar-head/:scalar-tail for the ragged
  edges — so a consumer can hand lanes to a vector path and edges to a
  scalar path without re-deriving the split. `scan-count` runs one scan
  op (entry count over [lo hi) on a Prolly tree) on both the
  lane-chunked path and the scalar path and asserts identical results:
  a vectorized batch path always ships with its scalar path, and silent
  divergence is refused, never averaged away. The scalar path stays the
  fallback (`scan-count-scalar`)."
  (:require [awai.fs.prolly :as pr]
            [awai.fs.vector-scan :as vs]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn plan-batches
  "Tag the `plan-lanes` split of [lo hi) at `width` with batch kinds.
  Returns {:lanes :head :tail :width :batches} where :batches holds
  {:kind :range} maps in scan order: at most one :scalar-head, then one
  :lane per full lane, then at most one :scalar-tail. Refusals are the
  `plan-lanes` refusals (bad width, bad/inverted range)."
  [lo hi width]
  (let [{:keys [lanes head tail] :as plan} (vs/plan-lanes lo hi width)]
    (assoc plan
           :batches (into []
                          (concat (when head [{:kind :scalar-head :range head}])
                                  (map (fn [lane] {:kind :lane :range lane}) lanes)
                                  (when tail [{:kind :scalar-tail :range tail}]))))))

(defn scan-count-scalar
  "Scalar fallback path: count entries with lo <= :index < hi by a single
  linear walk over `pr/scan`. Empty range counts 0."
  [tree lo hi]
  (loop [entries (pr/scan tree lo hi) n 0]
    (if (empty? entries)
      n
      (recur (rest entries) (inc n)))))

(defn scan-count-lanes
  "Lane-chunked path: count the same entries batch by batch. Each full
  lane is reduced in width-sized chunks (the shape a vector path would
  consume); scalar edges count directly. Same entries, different walk."
  [tree lo hi width]
  (let [{:keys [lanes head tail]} (vs/plan-lanes lo hi width)
        lane-count (fn [[s e]]
                     (reduce + 0 (map count (partition-all width (pr/scan tree s e)))))
        edge-count (fn [edge] (if edge (count (apply pr/scan tree edge)) 0))]
    (+ (reduce + 0 (map lane-count lanes))
       (edge-count head)
       (edge-count tail))))

(defn assert-parity!
  "Refuse silently divergent paths: return {:parity :matched} with the
  agreed value when `lane-result` equals `scalar-result`, else throw
  :awai.fs/lane-parity-mismatch carrying both. The negative control
  for SIMD-or-scalar parity."
  [lane-result scalar-result detail]
  (if (= lane-result scalar-result)
    {:parity :matched :value lane-result}
    (fail! :awai.fs/lane-parity-mismatch
           "awai fs: lane and scalar scan paths diverged"
           (assoc detail :lane lane-result :scalar scalar-result))))

(defn scan-count
  "Count entries with lo <= :index < hi on both paths and assert parity.
  Returns {:count n :batches [...] :parity :matched}. Throws
  :awai.fs/lane-parity-mismatch on divergence; bad width/range input is
  refused by the planner, never defaulted."
  [tree lo hi width]
  (let [planned (plan-batches lo hi width)
        lane (scan-count-lanes tree lo hi width)
        scalar (scan-count-scalar tree lo hi)]
    (assert-parity! lane scalar {:lo lo :hi hi :width width})
    {:count lane :batches (:batches planned) :parity :matched}))
