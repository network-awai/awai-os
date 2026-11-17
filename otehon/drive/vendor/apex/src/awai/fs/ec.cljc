(ns awai.fs.ec
  "Erasure-coding stripe planning: fragment layout, fault-domain
  placement, rebuild sets (AWAI-236, AWAI-534 scope).

  Pure planning only: no Galois arithmetic, no bytes, no network.
  `stripe` tiles a pack's bytes into k data fragments plus m parity
  descriptors; `place` assigns each fragment to a distinct fault domain;
  `rebuild` names the lost fragments and the k survivors that restore
  them, refusing when survivors fall short. Actual encode/decode math
  and fragment I/O stay in the node adapter."
  )

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn stripe
  "Tile {:pack :bytes} into k data fragments covering [0 bytes) exactly
  once (ragged tail joins the last data fragment) plus m parity
  descriptors. Returns {:pack :k :m :fragments}, each fragment
  {:index :kind :offset :end}. Refuses non-positive k/m."
  [{:keys [pack bytes]} {:keys [k m]}]
  (when-not (and (integer? pack) (not (neg? pack)))
    (fail! :awai.fs/invalid-pack-index "awai fs: pack index must be non-negative" {:pack pack}))
  (when-not (and (integer? bytes) (pos? bytes))
    (fail! :awai.fs/invalid-pack-bytes "awai fs: pack bytes must be positive" {:bytes bytes}))
  (when-not (and (integer? k) (pos? k) (integer? m) (pos? m))
    (fail! :awai.fs/invalid-ec-params "awai fs: EC needs positive k data and m parity fragments"
           {:k k :m m}))
  (let [step (quot bytes k)
        data (mapv (fn [i]
                     {:index i :kind :data
                      :offset (* i step)
                      :end (if (= i (dec k)) bytes (* (inc i) step))})
                   (range k))
        parity (mapv (fn [j]
                       {:index (+ k j) :kind :parity :offset 0 :end 0})
                     (range m))]
    {:pack pack :k k :m m :fragments (into data parity)}))

(defn place
  "Assign each fragment of `striped` to a distinct domain from `domains`
  in order. Refuses fewer domains than fragments — sharing a domain
  would silently correlate failures."
  [striped domains]
  (let [frags (:fragments striped)
        ds (vec domains)]
    (when (< (count ds) (count frags))
      (fail! :awai.fs/insufficient-domains "awai fs: one fault domain per fragment is required"
             {:fragments (count frags) :domains (count ds)}))
    (mapv (fn [f d] (assoc f :domain d)) frags ds)))

(defn rebuild
  "Plan recovery of the fragments absent from `survived` (a set of
  fragment indexes): {:rebuild lost-set :from [k survivor indexes]}.
  Refuses when fewer than k survivors remain."
  [striped survived]
  (let [{:keys [k fragments]} striped
        lost (into #{} (remove survived) (mapv :index fragments))]
    (when (< (count survived) k)
      (fail! :awai.fs/unrecoverable "awai fs: fewer than k fragments survived"
             {:k k :survived (count survived) :lost lost}))
    {:rebuild lost :from (into [] (take k) (sort survived))}))

(defn rebuild-one
  "Plan recovery of exactly one lost fragment: the single-fault case.
  Refuses :awai.fs/not-single-fault unless exactly one fragment index
  is absent from `survived` (zero means nothing to rebuild, more means
  a multi-fault this plan does not cover); refuses
  :awai.fs/unrecoverable when fewer than k survive, kept from
  `rebuild`. Returns {:rebuild index :from [...] :faults 1}."
  [striped survived]
  (let [{:keys [k fragments]} striped
        lost (into #{} (remove survived) (mapv :index fragments))]
    (when-not (= 1 (count lost))
      (fail! :awai.fs/not-single-fault "awai fs: single-fault rebuild needs exactly one lost fragment"
             {:lost lost :faults (count lost)}))
    (when (< (count survived) k)
      (fail! :awai.fs/unrecoverable "awai fs: fewer than k fragments survived"
             {:k k :survived (count survived) :lost lost}))
    {:rebuild (first lost) :from (into [] (take k) (sort survived)) :faults 1}))

(defn verified-survivors
  "Drop adapter-reported `corrupt` fragment indexes from `survived`.
  Corrupt fragments are refused as rebuild sources, never silently
  reused. Returns {:survivors #{...} :refused #{...}}; an empty corrupt
  set refuses nothing."
  [survived corrupt]
  (let [bad (into #{} (filter survived) corrupt)]
    {:survivors (into #{} (remove bad) survived) :refused bad}))

(defn rebuild-verified
  "Rebuild from verified survivors only: indexes in `corrupt` never
  enter :from, even when their holders ACKed. Refuses
  :awai.fs/unrecoverable (naming :corrupt) when fewer than k verified
  survivors remain — a bare quorum of ACKs is not sufficient; only k
  verified fragments restore the stripe."
  [striped survived corrupt]
  (let [{:keys [k fragments]} striped
        {:keys [survivors refused]} (verified-survivors survived corrupt)
        lost (into #{} (remove survivors) (mapv :index fragments))]
    (when (< (count survivors) k)
      (fail! :awai.fs/unrecoverable "awai fs: fewer than k verified fragments survived"
             {:k k :survived (count survivors) :lost lost :corrupt refused}))
    {:rebuild lost :from (into [] (take k) (sort survivors)) :refused-corrupt refused}))

(defn durable?
  "True only when `verified` holds at least k verified survivors of
  `striped`. Quorum ACKs alone never mark a stripe durable: corrupt or
  unknown indexes do not count, and sub-k verified sets stay
  non-durable. Verification belongs to the node adapter; this predicate
  only counts what the adapter verified."
  [striped verified]
  (let [indexes (set (mapv :index (:fragments striped)))
        good (into #{} (filter indexes) verified)]
    (>= (count good) (:k striped))))

(defn recovery-record
  "Record-only RPO/RTO note for a single-fault recovery: echoes the
  caller-owned `objectives` ({:rpo-faults n :rto-note s}) next to the
  plan, marked :enforced false. This records, never enforces: measured
  timings stay nil until the Otehon track approves a gate (AWAI-535).
  Refuses missing objectives instead of inventing numbers."
  [striped lost from objectives]
  (let [{:keys [pack]} striped
        {:keys [rpo-faults rto-note]} objectives]
    (when-not (and (integer? rpo-faults) (pos? rpo-faults))
      (fail! :awai.fs/missing-recovery-objective
             "awai fs: recovery record needs a positive caller-owned :rpo-faults"
             {:rpo-faults rpo-faults}))
    (when-not (string? rto-note)
      (fail! :awai.fs/missing-recovery-objective
             "awai fs: recovery record needs a caller-owned :rto-note string"
             {:rto-note rto-note}))
    {:pack pack :lost lost :rebuilt-from from
     :rpo {:max-tolerated-faults rpo-faults :data-loss-fragments 0}
     :rto {:measured-ms nil :note rto-note}
     :enforced false}))
