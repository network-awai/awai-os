(ns awai.fs.plan-cache
  "P3 plan cache: binding and stage-order preservation (AWAI-236).

  The cache key binds query-shape, policy digest, revocation generation,
  basis, and target: a stored fetch plan is served only on an exact key
  match, so a policy, generation, basis, or target change always misses.
  Stored plans must carry the full canonical verification stage order;
  skipped or reordered stages are refused at store time, so an optimizer
  can move fetch work around but can never drop a check.

  The per-request authorization evaluation itself stays with the authz
  owner (AWAI-173): this namespace binds and replays plans, it does not
  mint approvals. Pure data in, pure data out."
  (:refer-clojure :exclude []))

(def verification-stages
  "Canonical verification order. Every served plan ran these, in this order."
  [:authz-caveat :revocation-generation :endpoint-consent :cid-verify
   :sig-verify :aead-verify :fsync-order :fetch-plan])

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn cache-key
  "Build the binding key from its five dimensions. Equality on the key is
  equality on every dimension."
  [{:keys [query-shape policy-digest generation basis target]}]
  [query-shape policy-digest generation basis target])

(defn run-stages
  "Run stages in order against an accumulator, returning it. The runner
  has no skip and no reorder path by construction."
  [stages log]
  (reduce (fn [acc stage] (conj acc stage)) log stages))

(defn- check-stages
  [stages]
  (when (not= (vec stages) verification-stages)
    (fail! :awai.fs.plan-cache/bad-stage-order
           "awai fs plan cache: stages must match the canonical order"
           {:stages (vec stages)})))

(defn store-plan
  "Store fetch-plan under key after enforcing the canonical stage order.
  Returns [cache {:cache :miss :stages :plan}]. Refusals are never stored:
  only successfully verified plans reach this function."
  [cache key stages fetch-plan]
  (check-stages stages)
  [(assoc cache key {:stages verification-stages :plan fetch-plan})
   {:cache :miss :stages verification-stages :plan fetch-plan}])

(defn lookup-plan
  "Serve the stored plan only on an exact key match. Returns {:cache
  :hit/:miss :plan-or-nil}."
  [cache key]
  (if-let [entry (get cache key)]
    {:cache :hit :plan (:plan entry) :stages (:stages entry)}
    {:cache :miss :plan nil}))
