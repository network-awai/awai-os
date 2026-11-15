(ns awai.fs.hot-cache
  "Local hot cache with admission, LRU eviction, and pins.

  This is the trial-grade cache role from the awai-fs storage design:
  an evictable hot set on fast media that must never be confused with
  the durable copy. GC roots (pins, snapshots, retention holds) are
  pinned and eviction skips them. State is one immutable map so cache
  transitions stay as testable as the layout plans.

  Keys are caller-chosen (a chunk CID, a pack id, a file id — the cache
  does not interpret them). Sizes are caller-reported bytes."
  )

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn- check-size!
  [n what type]
  (when (or (not (integer? n)) (neg? n))
    (fail! type (str "awai fs: " what " must be a non-negative integer")
           {what n})))

(defn make-cache
  "Empty cache holding at most `capacity-bytes` of unpinned entries."
  [capacity-bytes]
  (check-size! capacity-bytes "capacity-bytes" :awai.fs/invalid-capacity)
  (when (zero? capacity-bytes)
    (fail! :awai.fs/invalid-capacity "awai fs: capacity must be positive"
           {:capacity-bytes capacity-bytes}))
  {:capacity capacity-bytes
   :bytes 0
   :store {}
   :order []
   :pins #{}
   :hits 0
   :misses 0
   :evictions 0})

(defn- promote
  "Move `key` to the most-recently-used end."
  [order key]
  (conj (into [] (remove #(= % key)) order) key))

(defn cache-lookup
  "Look up `key`. Returns [cache hit?]. Hits promote and count; misses
  count and leave the cache unchanged."
  [cache key]
  (if (contains? (:store cache) key)
    [(-> cache
          (update :hits inc)
          (update :order promote key))
     true]
    [(update cache :misses inc) false]))

(defn cache-pin
  "Pin `key`: eviction skips it until `cache-unpin`. Pinning an absent
  key still records the pin so a later insert is protected."
  [cache key]
  (update cache :pins conj key))

(defn cache-unpin
  "Release a pin."
  [cache key]
  (update cache :pins disj key))

(defn- evict-one
  "Evict the least-recently-used unpinned entry. Returns [cache key] or
  [cache nil] when everything remaining is pinned."
  [cache]
  (let [victim (first (remove (:pins cache) (:order cache)))]
    (if (nil? victim)
      [cache nil]
      [(-> cache
            (update :bytes - (get-in cache [:store victim :size]))
            (update :store dissoc victim)
            (update :order (fn [order] (into [] (remove #(= % victim)) order)))
            (update :evictions inc))
       victim])))

(defn cache-insert
  "Insert `key` with `size` bytes and `value`. Returns
  [cache {:admitted bool :evicted [...]}]. Updates refresh in place and
  promote. Admission evicts LRU unpinned entries until the insert fits;
  pinned entries are never evicted, so an insert that cannot fit is
  refused whole — never partially admitted."
  [cache key size value]
  (check-size! size "size" :awai.fs/invalid-size)
  (let [old (get-in cache [:store key :size])
        after-remove (if (some? old)
                       (-> cache
                           (update :bytes - old)
                           (update :store dissoc key))
                       cache)]
    (if (> size (:capacity cache))
      [cache {:admitted false :evicted []}]
      (loop [c after-remove
             evicted []]
        (if (<= (+ (:bytes c) size) (:capacity c))
          [(-> c
                (update :bytes + size)
                (assoc-in [:store key] {:size size :value value})
                (update :order promote key))
           {:admitted true :evicted evicted}]
          (let [[c2 victim] (evict-one c)]
            (if (nil? victim)
              [cache {:admitted false :evicted evicted}]
              (recur c2 (conj evicted victim)))))))))

(defn cache-stats
  "Observable counters: occupancy, entries, hits, misses, evictions, pins."
  [cache]
  {:bytes (:bytes cache)
   :capacity (:capacity cache)
   :entries (count (:store cache))
   :hits (:hits cache)
   :misses (:misses cache)
   :evictions (:evictions cache)
   :pins (count (:pins cache))})
