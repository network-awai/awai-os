(ns awai.fs.placement
  "End-to-end placement planning: heat-driven replica/EC choice composed
  over pack byte plans (AWAI-236, AWAI-535 scope).

  Pure planning only: no bytes move and no cost formula is invented here.
  Heat is caller-measured, thresholds and tiers are caller policy — this
  namespace only routes each pack to the policy's hot or cold branch and
  composes the existing EC striper for cold packs. A pack with no heat
  reading or a branch naming an unknown tier is refused, never guessed."
  (:require [awai.fs.ec :as ec]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn- check-policy!
  [{:keys [hot-heat tiers hot cold] :as policy}]
  (when-not (and (integer? hot-heat) (not (neg? hot-heat)))
    (fail! :awai.fs/invalid-policy "awai fs: policy needs a non-negative :hot-heat"
           {:hot-heat hot-heat}))
  (when-not (set? tiers)
    (fail! :awai.fs/invalid-policy "awai fs: policy needs a :tiers set" {}))
  (doseq [[branch {:keys [strategy tier]}] [[:hot hot] [:cold cold]]]
    (when-not (contains? #{:replica :ec} strategy)
      (fail! :awai.fs/invalid-policy "awai fs: branch strategy must be :replica or :ec"
             {:branch branch :strategy strategy}))
    (when-not (contains? tiers tier)
      (fail! :awai.fs/unknown-tier "awai fs: policy branch names an unknown tier"
             {:branch branch :tier tier})))
  (when-not (and (integer? (get-in policy [:hot :copies]))
                 (pos? (get-in policy [:hot :copies])))
    (fail! :awai.fs/invalid-policy "awai fs: hot branch needs positive :copies" {}))
  policy)

(defn plan-placement
  "Route every pack in `packs` ([{:pack-index :bytes}]) by its heat in
  `heats` ({pack-index n}) under `policy`. Heat at or above :hot-heat
  replicates per the :hot branch; below stripes per the :cold branch via
  `ec/stripe`. Returns {:decisions [...] :summary {:replica n :ec m}}."
  [packs heats policy]
  (check-policy! policy)
  (doseq [{:keys [pack-index bytes]} packs]
    (when-not (contains? heats pack-index)
      (fail! :awai.fs/missing-heat "awai fs: no heat reading for pack" {:pack pack-index}))
    (when-not (and (integer? bytes) (pos? bytes))
      (fail! :awai.fs/invalid-pack-bytes "awai fs: pack bytes must be positive"
             {:pack pack-index})))
  (let [decisions (mapv (fn [{:keys [pack-index bytes]}]
                          (let [heat (get heats pack-index)]
                            (if (>= heat (:hot-heat policy))
                              (let [hot (:hot policy)]
                                {:pack pack-index :heat heat :strategy :replica
                                 :tier (:tier hot) :copies (:copies hot)})
                              (let [cold (:cold policy)]
                                {:pack pack-index :heat heat :strategy :ec
                                 :tier (:tier cold)
                                 :fragments (:fragments (ec/stripe {:pack pack-index
                                                                   :bytes bytes}
                                                                  {:k (:k cold)
                                                                   :m (:m cold)}))}))))
                        packs)]
    {:decisions decisions
     :summary (reduce (fn [acc d] (update acc (:strategy d) (fnil inc 0)))
                      {} decisions)}))
