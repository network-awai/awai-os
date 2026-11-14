(ns d1.reservation
  "Idempotent reservation ledger as .cljc Otehon oracle.

  Decides the ledger half of C1.1 (AWAI-2774) only: one stable key admits
  at most one live digest; the same key with the same digest replays the
  recorded outcome and never re-executes; the same key with a different
  digest is a conflict; an in-flight key answers retry-later. Reusing an
  expired resolved claim advances its fence; unresolved effects never
  become a fresh admission merely through expiry. Only the recorded
  fence may settle; an unverifiable effect is recorded as unknown,
  never as success (protocol v0.1 section 8, ADR 0027 D6).

  Pure: no I/O, regex, dates or platform numbers. The caller supplies
  now-ms. Durable persistence, clock trust, coupon issuance, fencing the
  reservation path itself, OCI execution and the independent witness are
  host obligations and stay unimplemented here; the draft dispatch path
  (PR #69) owns the execution boundary, this ledger owns the decision.
  Expiry drops the old claim: a superseded receipt stays observable as
  :prior-receipt, but retaining spent keys beyond expiry is the host's
  spent-set, not this map.")

;; ---------------------------------------------------------------------------
;; Ledger shape. :reservations maps a stable key to its entry; terminal
;; entries keep their receipt so a late redelivery replays it.
;;
;; entry {:digest d :expires e :state s :fence f :receipt r-or-nil}
;; state one of :reserved :in-flight :completed :failed :unknown :expired

(def terminal-states #{:completed :failed :unknown})

(defn- entry-expired?
  [entry now-ms]
  (and (map? entry) (integer? (:expires entry)) (<= (:expires entry) now-ms)))

(defn reserve
  "Idempotent submit under a stable key. Returns [ledger decision]."
  [ledger k digest now-ms ttl-ms]
  (let [entry (get-in ledger [:reservations k])]
    (cond
      (and (entry-expired? entry now-ms)
           (contains? #{:in-flight :unknown} (:state entry)))
      [ledger {:retry-later true :key k}]
      (or (nil? entry) (entry-expired? entry now-ms))
      (let [fence (inc (:fence entry -1))]
        [(assoc-in ledger [:reservations k]
                 {:digest digest :expires (+ now-ms ttl-ms)
                  :state :reserved :fence fence :receipt nil
                  :prior-receipt (:receipt entry)})
         {:admit true :key k :fence fence :superseded (some? (:receipt entry))}])
      (not= digest (:digest entry))
      [ledger {:refused true :cause :conflict :key k}]
      (= :in-flight (:state entry))
      [ledger {:retry-later true :key k}]
      (contains? terminal-states (:state entry))
      [ledger {:replay true :key k :receipt (:receipt entry)}]
      :else
      [ledger {:replay true :key k :state (:state entry)}])))

(defn raise-fence
  "Monotonic fence ratchet for a live reservation. Only moves upward;
  rewind, unknown keys and settled entries are refused, never applied."
  [ledger k epoch]
  (let [entry (get-in ledger [:reservations k])]
    (cond
      (or (nil? entry) (contains? terminal-states (:state entry)))
      [ledger {:refused true :cause :not-live :key k}]
      (or (not (integer? epoch)) (<= epoch (:fence entry 0)))
      [ledger {:refused true :cause :fence-rewind :key k}]
      :else
      [(assoc-in ledger [:reservations k :fence] epoch)
       {:fenced true :key k :fence epoch}])))

(defn reconcile
  "Authoritative resolution of an unknown entry. Only an :unknown entry
  moves, and only to the outcome the authority reports for the same
  digest and recorded epoch. The legacy arity applies only to epoch zero;
  it cannot resolve a newer reservation or raised fence."
  ([ledger k digest outcome receipt]
   (reconcile ledger k digest 0 outcome receipt))
  ([ledger k digest epoch outcome receipt]
  (let [entry (get-in ledger [:reservations k])]
    (cond
      (or (nil? entry) (not= :unknown (:state entry)))
      [ledger {:refused true :cause :not-unknown :key k}]
      (not= digest (:digest entry))
      [ledger {:refused true :cause :conflict :key k}]
      (or (not (integer? epoch)) (not= epoch (:fence entry 0)))
      [ledger {:refused true :cause :stale-writer :key k}]
      (= outcome :completed)
      [(assoc-in ledger [:reservations k]
                 (assoc entry :state :completed :receipt receipt))
       {:state :completed :key k :receipt receipt}]
      (= outcome :failed)
      [(assoc-in ledger [:reservations k]
                 (assoc entry :state :failed :receipt receipt))
       {:state :failed :key k}]
      :else
      [ledger {:refused true :cause :unknown-outcome :key k}]))))

(defn settle
  "Terminal settle of a live reservation. Returns [ledger decision].
  effect is :ok, :failed or :unverified. An epoch other than the recorded
  fence, or a supplied digest mismatch, refuses the writer."
  [ledger k digest epoch effect receipt]
  (let [entry (get-in ledger [:reservations k])]
    (cond
      (or (nil? entry) (contains? terminal-states (:state entry)))
      [ledger {:refused true :cause :not-live :key k}]
      (not= digest (:digest entry))
      [ledger {:refused true :cause :conflict :key k}]
      (or (not (integer? epoch)) (not= epoch (:fence entry 0)))
      [ledger {:refused true :cause :stale-writer :key k}]
      (= effect :unverified)
      [(assoc-in ledger [:reservations k] (assoc entry :state :unknown))
       {:unknown true :key k}]
      (= effect :failed)
      [(assoc-in ledger [:reservations k]
                 (assoc entry :state :failed :receipt receipt))
       {:state :failed :key k}]
      (= effect :ok)
      [(assoc-in ledger [:reservations k]
                 (assoc entry :state :completed :receipt receipt))
       {:state :completed :key k :receipt receipt}]
      :else
      [ledger {:refused true :cause :unknown-effect :key k}])))
