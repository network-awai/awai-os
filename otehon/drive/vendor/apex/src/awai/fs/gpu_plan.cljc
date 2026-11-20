(ns awai.fs.gpu-plan
  "GPU offload scan/projection batch planning skeleton (AWAI-541, record-only).

  Planning layer only; Otehon owns execution. A batch is eligible for the
  Otehon GPU route only when all three hold: lane-aligned extents,
  host-decided policy (explicit caller opt-in, never defaulted), and
  host-reverifiability (the scalar path from awai.fs.lane-batch asserts
  parity for the same op). Every plan carries an explicit host fallback.

  Keys never leave the host: plans carry no key material, and `attach-key`
  always refuses. No CUDA/LLVM or device dependency anywhere in this
  namespace. Timings and thresholds are planning records, not gates."
  )

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn eligible?
  "True only when lane-aligned, host-policy-decided, and host-reverifiable."
  [{:keys [offset length lane-width policy-decided scalar-available]}]
  (and (pos-int? lane-width)
       (zero? (mod (or offset 0) lane-width))
       (zero? (mod (or length 0) lane-width))
       (true? policy-decided)
       (true? scalar-available)))

(defn plan-batch
  "Route one scan batch. Always returns an explicit :fallback host plan."
  [batch]
  (let [fallback {:route :host
                  :op (:op batch)
                  :reason :host-fallback}]
    (if (eligible? batch)
      {:route :otehon-gpu
       :op (:op batch)
       :lane-width (:lane-width batch)
       :verify :scalar-parity
       :key-scope :host-only
       :fallback fallback}
      (assoc fallback :reason (if (:policy-decided batch)
                                :not-eligible
                                :policy-undecided)))))

(defn attach-key
  "Always refuses: key material is never attached to an offload plan."
  [_plan _key-ref]
  (fail! :awai.fs/key-never-leaves-host
         "awai fs: keys stay on the host; offload plans carry no key material"
         {}))
