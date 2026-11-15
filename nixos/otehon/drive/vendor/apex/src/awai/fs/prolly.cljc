(ns awai.fs.prolly
  "Prolly tree over manifest entries: deterministic content-defined
  splits, ordered range scan, snapshot diff (AWAI-236, AWAI-531 scope).

  Pure planning only: no bytes on disk, no digests, no providers. Split
  boundaries come from a fixed FNV-1a hash over each entry's key bytes,
  so the shape depends only on entry content — never on insertion order
  (input must arrive sorted; unsorted input is refused). Nodes carry the
  shape version; the node codec stays out of this unit."
  )

(def ^:const shape-version 1)

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn- fnv-1a-32
  "Fixed FNV-1a over a byte seq. Pure Clojure, identical on every
  platform — unlike the host `hash`, which this tree must not depend on."
  [bytes]
  (reduce (fn [h b]
            (-> (bit-xor h (bit-and b 0xff))
                (* 16777619)
                (bit-and 0xffffffff)))
          2166136261
          bytes))

(defn- key-bytes
  "Key bytes of an entry: big-endian :index, then :length, then :offset.
  Fixed widths keep the split rule content-defined and stable."
  [{:keys [index length offset]}]
  (let [u32 (fn [n] [(bit-and (bit-shift-right n 24) 0xff)
                     (bit-and (bit-shift-right n 16) 0xff)
                     (bit-and (bit-shift-right n 8) 0xff)
                     (bit-and n 0xff)])]
    (concat (u32 index) (u32 length) (u32 offset))))

(defn- split-points
  "Entry indexes where a new leaf starts: content boundary
  (hash mod target == 0, never before the first entry) or the forced
  cap at 2x target that bounds degenerate runs."
  [entries target]
  (let [cap (* 2 target)]
    (loop [remaining (rest entries) idx 1 run 1 acc []]
      (if (empty? remaining)
        acc
        (let [boundary? (zero? (mod (fnv-1a-32 (key-bytes (first remaining))) target))
              forced? (>= run cap)]
          (if (or boundary? forced?)
            (recur (rest remaining) (inc idx) 1 (conj acc idx))
            (recur (rest remaining) (inc idx) (inc run) acc)))))))

(defn build
  "Build a one-level Prolly tree from :index-sorted `entries`.
  Returns {:version :leaf-target :leaves :separators}: leaves are entry
  vectors in key order, separators hold each non-first leaf's first
  :index for seek. Refuses empty, unsorted, and bad-target input."
  [entries {:keys [leaf-target]}]
  (when-not (and (integer? leaf-target) (pos? leaf-target))
    (fail! :awai.fs/invalid-leaf-target "awai fs: leaf-target must be positive"
           {:leaf-target leaf-target}))
  (when (empty? entries)
    (fail! :awai.fs/empty-entries "awai fs: cannot build a tree from no entries" {}))
  (let [idxs (mapv :index entries)]
    (when-not (apply < idxs)
      (fail! :awai.fs/unsorted-entries "awai fs: entries must be :index-sorted" {})))
  (let [cuts (split-points entries leaf-target)
        bounds (concat [0] cuts [(count entries)])
        leaves (mapv (fn [[from to]] (subvec (vec entries) from to))
                     (partition 2 1 bounds))]
    {:version shape-version
     :leaf-target leaf-target
     :leaves leaves
     :separators (mapv (comp :index first) (rest leaves))}))

(defn- start-leaf
  "Leaf position holding `lo`: last separator <= lo."
  [separators lo]
  (loop [i 0 pos 0]
    (if (and (< i (count separators)) (<= (nth separators i) lo))
      (recur (inc i) (inc i))
      pos)))

(defn scan
  "Entries with lo <= :index < hi, in key order. Seeks the start leaf
  over separators, then walks forward; empty range yields []."
  [{:keys [leaves separators]} lo hi]
  (if (>= lo hi)
    []
    (let [n (count leaves)]
      (loop [li (start-leaf separators lo) out []]
        (if (>= li n)
          out
          (let [kept (into [] (filter #(and (<= lo (:index %)) (< (:index %) hi)))
                           (nth leaves li))]
            (if (and (seq (nth leaves li))
                     (< (:index (last (nth leaves li))) hi)
                     (< (inc li) n))
              (recur (inc li) (into out kept))
              (into out kept))))))))

(defn diff
  "Index sets {:added :removed} of `after` against `before`: added holds
  indexes present only in after, removed only in before."
  [before after]
  (let [keys-of (fn [tree] (set (mapcat #(map :index %) (:leaves tree))))
        b (keys-of before)
        a (keys-of after)]
    {:added (into #{} (remove b) a)
     :removed (into #{} (remove a) b)}))
