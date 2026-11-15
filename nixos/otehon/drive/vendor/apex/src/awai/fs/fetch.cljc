(ns awai.fs.fetch
  "Parallel fetch planning over coalesced pack ranges.

  Pure planning only: `fetch-lanes` stripes fetch groups across worker
  lanes so N workers can pull concurrently without sharing state. Workers
  own connection pools and in-flight limits; this namespace only decides
  which lane pulls what, preserving pack order inside each lane."
  )

(def ^:const default-lanes
  "Default worker-lane count for parallel fetch."
  4)

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn fetch-lanes
  "Stripe `groups` (with :pack, :pack-offset, :length) across :lanes
  round-robin. Returns [{:lane :bytes :groups}] with pack order preserved
  inside each lane, plus :lane-count. Refuses non-positive lane counts."
  ([groups]
   (fetch-lanes groups nil))
  ([groups {:keys [lanes] :or {lanes default-lanes}}]
   (when (or (not (integer? lanes)) (< lanes 1))
     (fail! :awai.fs/invalid-lanes "awai fs: lanes must be at least 1"
            {:lanes lanes}))
   (let [laned (mapv (fn [i g] {:lane (mod i lanes) :group g})
                     (range) groups)
         by-lane (group-by :lane laned)]
     {:lane-count lanes
      :lanes (mapv (fn [l]
                     (let [gs (mapv :group (get by-lane l []))]
                       {:lane l
                        :bytes (reduce + 0 (mapv :length gs))
                        :groups gs}))
                   (range lanes))})))
