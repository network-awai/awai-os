(ns awai.fs.scrub
  "Scrub scheduling over packs: who gets verified, in what order, under
  a byte budget (AWAI-236, AWAI-534 scope).

  Pure planning only: no bytes are read and no repair runs here.
  Never-scrubbed packs go first (by pack index), then the stalest whose
  age passed :interval. The run fills up to :byte-budget; the rest is
  listed as :deferred, never dropped. A stale pack older than twice the
  interval is flagged :overdue. Future scrub timestamps and bad policy
  are refused."
  )

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn plan-scrub
  "Order `packs` ([{:pack-index :bytes}]) for verification at clock `now`
  against `last-scrubbed` ({pack-index timestamp}) under `policy`
  ({:interval :byte-budget}). Returns {:queue [...] :deferred [...]
  :bytes n}: queue entries are {:pack :reason :overdue}, deferred is a
  pack-index vector in queue order."
  [packs last-scrubbed now {:keys [interval byte-budget] :as policy}]
  (when-not (and (integer? interval) (pos? interval))
    (fail! :awai.fs/invalid-policy "awai fs: scrub policy needs a positive :interval"
           {:interval interval}))
  (when-not (and (integer? byte-budget) (pos? byte-budget))
    (fail! :awai.fs/invalid-policy "awai fs: scrub policy needs a positive :byte-budget"
           {:byte-budget byte-budget}))
  (when-not (and (integer? now) (not (neg? now)))
    (fail! :awai.fs/invalid-clock "awai fs: scrub clock must be non-negative" {:now now}))
  (doseq [[p t] last-scrubbed]
    (when (> t now)
      (fail! :awai.fs/future-scrub "awai fs: scrub timestamp is in the future"
             {:pack p :timestamp t})))
  (let [ranked (sort-by (fn [{:keys [pack-index]}]
                          (let [t (get last-scrubbed pack-index)]
                            (if (nil? t) [0 pack-index] [1 t pack-index])))
                        packs)
        wanted (filter (fn [{:keys [pack-index]}]
                         (let [t (get last-scrubbed pack-index)]
                           (or (nil? t) (> (- now t) interval))))
                       ranked)
        entries (mapv (fn [{:keys [pack-index]}]
                        (let [t (get last-scrubbed pack-index)]
                          {:pack pack-index
                           :reason (if (nil? t) :never-scrubbed :stale)
                           :overdue (boolean (and t (> (- now t) (* 2 interval))))}))
                      wanted)
        by-pack (into {} (map (juxt :pack-index :bytes) packs))]
    (loop [remaining entries bytes 0 queue [] deferred []]
      (if (empty? remaining)
        {:queue queue :deferred deferred :bytes bytes}
        (let [e (first remaining)
              size (get by-pack (:pack e))]
          (if (<= (+ bytes size) byte-budget)
            (recur (rest remaining) (+ bytes size) (conj queue e) deferred)
            (recur (rest remaining) bytes queue (conj deferred (:pack e)))))))))
