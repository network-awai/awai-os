(ns awai.fs.selector
  "Local experimental traversal AST, not the IPLD selector wire schema. The subset Awai
  FS needs — MatchPoint, ExploreAll, ExploreFields, ExploreIndex,
  ExploreRange, ExploreUnion, ExploreRecursive (+Edge) — executed over
  decoded nodes with optional link loading.

  Selector shape (all maps):
  - {:match true}                          MatchPoint: emit this node
  - {:all next}                            ExploreAll: every child
  - {:fields {name sel}}                   ExploreFields: named children
  - {:index i :next sel}                   ExploreIndex: one list slot
  - {:range {:start s :end e} :next sel}   ExploreRange: list slice
  - {:union [sel ...]}                     ExploreUnion: concat
  - {:recursive {:sequence sel :limit {:depth n} | {:none true}
    :next sel}}                            ExploreRecursive: DFS
  - {:edge true}                           ExploreRecursiveEdge: stop

  `select` returns [{:path [segments] :node}] in walk order. Links
  (`{:tag 42 :bytes}`, see awai.fs.path) load through `load-fn`
  (nil = links are terminal values: MatchPoint still emits them, but
  no traversal passes through). Nested ExploreRecursive inside a
  sequence fails closed. Conditions (And/Or/KindIs) are out of scope:
  matching is structural here."
  (:refer-clojure :exclude [])
  (:require [awai.fs.path :as ipath]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(def ^:dynamic *budget* nil)
(defn- tick! []
  (when (and *budget* (neg? (swap! *budget* dec)))
    (fail! :awai.fs/traversal-limit "local traversal budget exhausted" {})))
(defn admit!
  "Validate the local AST before loading blocks. Unbounded recursion is refused."
  ([s] (admit! s 0))
  ([s depth]
   (when (or (> depth 32) (not (map? s))) (fail! :awai.fs/bad-selector "invalid local selector" {}))
   (let [ks (set (keys s)) next! #(admit! % (inc depth))
         uint? #(and (integer? %) (<= 0 % 4096))]
     (cond
       (= ks #{:match}) (when-not (= true (:match s)) (fail! :awai.fs/bad-selector "invalid matcher" {}))
       (= ks #{:edge}) (when-not (= true (:edge s)) (fail! :awai.fs/bad-selector "invalid edge" {}))
       (= ks #{:all}) (next! (:all s))
       (= ks #{:fields}) (do (when-not (and (map? (:fields s)) (<= (count (:fields s)) 256) (every? string? (keys (:fields s))))
                              (fail! :awai.fs/bad-selector "invalid fields" {})) (doseq [v (vals (:fields s))] (next! v)))
       (= ks #{:index :next}) (do (when-not (uint? (:index s)) (fail! :awai.fs/bad-selector "invalid index" {})) (next! (:next s)))
       (= ks #{:range :next}) (do (when-not (and (= #{:start :end} (set (keys (:range s))))
                                                                (uint? (get-in s [:range :start])) (uint? (get-in s [:range :end]))
                                                                (<= (get-in s [:range :start]) (get-in s [:range :end])))
                                          (fail! :awai.fs/bad-selector "invalid range" {})) (next! (:next s)))
       (= ks #{:union}) (do (when-not (and (vector? (:union s)) (<= 1 (count (:union s)) 64))
                              (fail! :awai.fs/bad-selector "invalid union" {})) (doseq [v (:union s)] (next! v)))
       (= ks #{:recursive}) (let [r (:recursive s) d (get-in r [:limit :depth])]
                              (when-not (and (= #{:sequence :limit :next} (set (keys r)))
                                             (= #{:depth} (set (keys (:limit r)))) (integer? d) (<= 0 d 32))
                                (fail! :awai.fs/bad-selector "finite recursion depth required" {}))
                              (next! (:sequence r)) (next! (:next r)))
       :else (fail! :awai.fs/bad-selector "unknown or mixed selector fields" {}))) s))

(defn- loaded
  "Follow `node` through `load-fn` when it is a link. Returns nil for
  unloaded links."
  [node load-fn]
  (tick!)
  (if (ipath/link? node)
    (when (some? load-fn) (load-fn (:bytes node)))
    node))

(defn- kids-of
  "Direct [segment child] pairs of `node` (links loaded). [] for
  scalars and unloaded links."
  [node load-fn]
  (let [n (loaded node load-fn)]
    (cond
      (nil? n) []
      (map? n) (mapv (fn [[k v]] [k v]) n)
      (sequential? n) (mapv vector (range (count n)) n)
      :else [])))

(declare select* kids-step)

(defn- seq-paths
  "Apply sequence selector `sel` to `node`, returning [[segments node]]
  next-level pairs (segments relative to `node`). Nested selectors
  recurse (ExploreRecursiveEdge yields the reached node and ends that
  sequence path); nested ExploreRecursive fails closed."
  [sel node load-fn]
  (tick!)
  (let [n (loaded node load-fn)]
    (cond
      (nil? n) []
      (:edge sel) [[[] node]]
      (:match sel) [[[] node]]
      (:all sel) (mapv (fn [[seg c]] [[seg] c]) (kids-of node load-fn))
      (:fields sel)
      (if (map? n)
        (vec (mapcat (fn [[k s]]
                       (if (contains? n k)
                         (map (fn [[p c]] [(into [k] p) c])
                              (seq-paths s (get n k) load-fn))
                         []))
                     (:fields sel)))
        [])
      (contains? sel :index)
      (let [i (:index sel)]
        (if (and (sequential? n) (integer? i) (< -1 i (count n)))
          (map (fn [[p c]] [(into [i] p) c])
               (seq-paths (:next sel) (nth n i) load-fn))
          []))
      (:range sel)
      (if (sequential? n)
        (let [{:keys [start end]} (:range sel)
              lo (max 0 (or start 0)) hi (min (count n) (or end (count n)))]
          (vec (mapcat (fn [i]
                         (map (fn [[p c]] [(into [i] p) c])
                              (seq-paths (:next sel) (nth n i) load-fn)))
                       (range lo hi))))
        [])
      (:union sel)
      (vec (mapcat #(seq-paths % node load-fn) (:union sel)))
      (:recursive sel)
      (fail! :awai.fs/nested-recursive
             "awai fs: recursive inside a sequence is out of scope"
             {:selector sel})
      :else
      (fail! :awai.fs/bad-selector "awai fs: unknown selector" {:selector sel}))))

(defn- select*
  [sel node path load-fn]
  (tick!)
  (cond
    (:edge sel) []

    (:match sel) [{:path path :node node}]

    (:union sel)
    (vec (mapcat #(select* % node path load-fn) (:union sel)))

    (:recursive sel)
    (let [{:keys [sequence limit next]} (:recursive sel)
          depth (if (and (map? limit) (integer? (:depth limit)))
                  (:depth limit)
                  ::none)]
      (loop [frontier [{:node node :path path :d 0}] out []]
        (if (empty? frontier)
          out
          (let [{:keys [node path d]} (first frontier)
                hits (select* next node path load-fn)
                kids (if (or (= depth ::none) (< d depth))
                       (seq-paths sequence node load-fn)
                       [])
                more (mapv (fn [[segs c]]
                             {:node c :path (into path segs) :d (inc d)})
                           kids)]
            (recur (into (vec (rest frontier)) more)
                   (into out hits))))))

    :else
    (let [step (cond (:all sel) {:step (:all sel) :via :kids}
                     (contains? sel :index) {:step (:next sel) :via :index}
                     (:range sel) {:step (:next sel) :via :range}
                     (:fields sel) {:step nil :via :fields}
                     :else ::unknown)]
      (if (= step ::unknown)
        (fail! :awai.fs/bad-selector "awai fs: unknown selector" {:selector sel})
        (vec (mapcat (fn [[k s]]
                       (mapcat (fn [[seg c]]
                                 (select* s c (conj path seg) load-fn))
                               (kids-step step sel node load-fn k)))
                     (if (= :fields (:via step))
                       (:fields sel)
                       {nil (:step step)})))))))

(defn- kids-step
  "Single traversal step for non-recursive Explore*: [segment child]
  pairs under `node` for field `k` (ignored unless :fields)."
  [step sel node load-fn k]
  (let [n (loaded node load-fn)]
    (if (nil? n)
      []
      (case (:via step)
        :kids (kids-of node load-fn)
        :fields (if (and (map? n) (contains? n k)) [[k (get n k)]] [])
        :index (let [i (:index sel)]
                 (if (and (sequential? n) (integer? i) (< -1 i (count n)))
                   [[i (nth n i)]]
                   []))
        :range (if (sequential? n)
                 (let [{:keys [start end]} (:range sel)
                       lo (max 0 (or start 0)) hi (min (count n) (or end (count n)))]
                   (mapv (fn [i] [i (nth n i)]) (range lo hi)))
                 [])
        []))))

(defn select
  "Run `selector` from `root`, loading links through `load-fn` (nil
  for a link-free DAG). Returns [{:path :node}] matched in walk
  order. Fails closed on unknown selector shapes."
  [selector root load-fn]
  (admit! selector)
  (binding [*budget* (atom 4096)] (select* selector root [] load-fn)))
