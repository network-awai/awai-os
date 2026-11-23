(ns en-devnet.core
  "EN devnet ledger as .cljc Otehon oracle (ADR 0027 V3, AWAI-3101).

  The settlement half of the D1 first vertical: one dedicated devnet
  chain, mutual-credit balances in raw EN units, two-party signed
  transfers, single-operator append order as finality, accounting entries
  derived only from finalized transfers, and the three-way reconciliation
  of signer state, ledger and journal (ADR 0027 D5-D7).

  Owner decision 2026-11-17: this is a new minimal devnet ledger in
  awai-os. The 404 kotoba-lang/en is a semantic reference only (net-zero,
  never below a declared credit floor), not a dependency.

  Pure: no I/O, regex, dates, randomness or platform numbers. The caller
  supplies now-ms. The host owns signature verification over
  `signing-payload`, key custody, durable persistence, the trusted clock
  and transport. A transfer carries the host's verification results;
  this core decides whether they are sufficient, never computes them.

  value-class is always :devnet. Nothing here is money, revenue, a
  deposit or a reward, and single-operator order is not distributed
  finality.")

;; ---------------------------------------------------------------------------
;; Genesis

(def chain-prefix "awai-en-devnet/")
(def finality :single-operator-devnet)
(def roles #{:sponsor :bot :provider})

(defn- starts-with? [s prefix]
  (and (string? s)
       (>= (count s) (count prefix))
       (= prefix (subs s 0 (count prefix)))))

(defn- int-value? [x] (and (integer? x) (not (boolean? x))))
(defn- pos-amount? [x] (and (int-value? x) (pos? x)))

(defn- account-problem [{:keys [did role floor] :as account}]
  (cond
    (contains? account :opening-balance) :opening-balance-refused
    (not (starts-with? did "did:key:")) :bad-did
    (not (contains? roles role)) :bad-role
    (not (and (int-value? floor) (<= floor 0))) :bad-floor
    :else nil))

(defn genesis
  "Validate genesis params and return {:ledger l} or {:refused true :cause c}.
  params {:chain-id s :value-class :devnet :operator did :fee-cap 0
          :accounts [{:did :role :floor}] :allowlist [{:spender :receivers}]}
  Every account opens at balance 0: credit floors, not minted balances."
  [{:keys [chain-id value-class operator fee-cap accounts allowlist]}]
  (let [dids (map :did accounts)
        account-cause (some account-problem accounts)]
    (cond
      (not= :devnet value-class) {:refused true :cause :not-devnet}
      (not (and (starts-with? chain-id chain-prefix)
                (> (count chain-id) (count chain-prefix))))
      {:refused true :cause :bad-chain-id}
      (not (starts-with? operator "did:key:")) {:refused true :cause :bad-operator}
      (not= 0 fee-cap) {:refused true :cause :bad-fee-cap}
      (empty? accounts) {:refused true :cause :no-accounts}
      account-cause {:refused true :cause account-cause}
      (not= (count dids) (count (distinct dids))) {:refused true :cause :duplicate-account}
      :else
      {:ledger {:chain-id chain-id
                :value-class :devnet
                :finality finality
                :operator operator
                :fee-cap 0
                :height 0
                :accounts (into {} (map (fn [{:keys [did role floor]}]
                                          [did {:role role :floor floor :balance 0}])
                                        accounts))
                :allowlist (into {} (map (fn [{:keys [spender receivers]}]
                                           [spender (vec receivers)])
                                         allowlist))
                :nonces {}
                :transfer-ids {}
                :log []}})))

(defn adr0027-genesis
  "The ADR 0027 D5 amounts: sponsor floor -2, bot floor 0, provider floor
  0, fee cap 0. The sponsor may fund only the bot; the bot may pay only
  the provider operator (never a node id, JUN-28)."
  [chain-id operator sponsor bot provider]
  {:chain-id chain-id
   :value-class :devnet
   :operator operator
   :fee-cap 0
   :accounts [{:did sponsor :role :sponsor :floor -2}
              {:did bot :role :bot :floor 0}
              {:did provider :role :provider :floor 0}]
   :allowlist [{:spender sponsor :receivers [bot]}
               {:spender bot :receivers [provider]}]})

;; ---------------------------------------------------------------------------
;; Transfers

(def payload-fields
  [:chain-id :kind :transfer-id :nonce :spender :receiver :amount :fee
   :order :acceptance :demand :expires-ms])

(defn signing-payload
  "The exact ordered field vector both parties sign. The host encodes it
  deterministically and verifies each signature over those bytes; the
  ledger chain id is included so a signature cannot replay on another
  chain."
  [tx]
  (mapv (fn [k] [k (get tx k)]) payload-fields))

(defn- signed-by? [tx did]
  (some (fn [s] (= did (:signer s))) (:signatures tx)))

(defn- signature-problem [tx]
  (let [sigs (:signatures tx)
        parties #{(:spender tx) (:receiver tx)}]
    (cond
      (not (signed-by? tx (:spender tx))) :missing-spender-signature
      (not (signed-by? tx (:receiver tx))) :missing-receiver-signature
      (some (fn [s] (not (contains? parties (:signer s)))) sigs) :foreign-signature
      (some (fn [s] (not (true? (:verified s)))) sigs) :unverified-signature
      (some (fn [s] (not= (:payload s) (signing-payload tx))) sigs) :payload-mismatch
      :else nil)))

(defn transfer-problem
  "First reason this transfer cannot finalize on ledger at now-ms, or nil.
  Precedence is fixed so both runners name the same cause."
  [ledger tx now-ms]
  (let [{:keys [kind spender receiver amount fee nonce transfer-id expires-ms]} tx
        accounts (:accounts ledger)
        from (get accounts spender)
        fee (if (contains? tx :fee) fee 0)]
    (cond
      (not= (:chain-id ledger) (:chain-id tx)) :wrong-chain
      (not= :devnet (:value-class tx)) :not-devnet
      (not (contains? #{:funding :settlement :compute-funding} kind)) :bad-kind
      (not (pos-amount? amount)) :bad-amount
      (not (and (int-value? fee) (<= 0 fee (:fee-cap ledger)))) :fee-over-cap
      (= spender receiver) :self-transfer
      (or (nil? from) (nil? (get accounts receiver))) :unknown-account
      (not (some (fn [r] (= r receiver)) (get (:allowlist ledger) spender)))
      :receiver-not-allowlisted
      (not (int-value? expires-ms)) :bad-expiry
      (<= expires-ms now-ms) :expired
      (not (and (string? nonce) (pos? (count nonce)))) :bad-nonce
      (contains? (:nonces ledger) [spender nonce]) :duplicate-nonce
      (contains? (:transfer-ids ledger) transfer-id) :duplicate-transfer
      (and (= :settlement kind) (not (and (string? (:order tx)) (string? (:acceptance tx)))))
      :missing-acceptance
      (and (= :settlement kind) (not (pos-amount? (:reserved tx)))) :missing-reservation
      (and (= :settlement kind) (> amount (:reserved tx))) :over-reservation
      :else
      (or (signature-problem tx)
          (when (< (- (:balance from) amount fee) (:floor from)) :below-floor)))))

(defn apply-transfer
  "Returns [ledger decision]. A refused transfer leaves the ledger unchanged.
  A finalized one moves the balance, records the nonce and transfer id and
  appends one log entry at the next height."
  [ledger tx now-ms]
  (if-let [cause (transfer-problem ledger tx now-ms)]
    [ledger {:refused true :cause cause :transfer-id (:transfer-id tx)}]
    (let [{:keys [spender receiver amount transfer-id nonce]} tx
          height (inc (:height ledger))
          entry {:height height
                 :transfer-id transfer-id
                 :kind (:kind tx)
                 :spender spender
                 :receiver receiver
                 :amount amount
                 :order (:order tx)
                 :acceptance (:acceptance tx)
                 :demand (:demand tx)}]
      [(-> ledger
           (update-in [:accounts spender :balance] - amount)
           (update-in [:accounts receiver :balance] + amount)
           (assoc :height height)
           (assoc-in [:nonces [spender nonce]] height)
           (assoc-in [:transfer-ids transfer-id] height)
           (update :log conj entry))
       {:finalized true :transfer-id transfer-id :height height :finality finality}])))

;; ---------------------------------------------------------------------------
;; Reads

(defn balance
  "Known balance, or {:known? false}. An unknown account is never 0."
  [ledger did]
  (if-let [a (get-in ledger [:accounts did])]
    {:known? true :balance (:balance a) :floor (:floor a) :value-class :devnet}
    {:known? false}))

(defn net-zero? [ledger]
  (zero? (reduce + 0 (map :balance (vals (:accounts ledger))))))

(defn balances
  "Sorted [did balance] pairs for readback display."
  [ledger]
  (vec (sort-by first (map (fn [[did a]] [did (:balance a)]) (:accounts ledger)))))

;; ---------------------------------------------------------------------------
;; Accounting (ADR 0027 D7, ADR-0065). Append-only, derived from finalized
;; log entries only. A reservation or budget is never an entry.

(defn- entries-for [{:keys [kind spender receiver amount transfer-id order acceptance demand height]}]
  (let [base {:transfer-id transfer-id :height height :amount amount
              :order order :acceptance acceptance :demand demand
              :value-class :devnet}]
    (if (= :settlement kind)
      [(assoc base :account spender :entry :provider-expense)
       (assoc base :account receiver :entry :earned-en)]
      [(assoc base :account spender :entry :credit-extended)
       (assoc base :account receiver :entry :credit-received)])))

(defn journal [ledger]
  (vec (mapcat entries-for (:log ledger))))

(defn earned-summary
  "earned-en split by demand. owner-internal is excluded from the external
  figure; neither is revenue or cash (value-class :devnet)."
  [entries]
  (let [earned (filter (fn [e] (= :earned-en (:entry e))) entries)
        internal (filter (fn [e] (= :owner-internal (:demand e))) earned)
        external (remove (fn [e] (= :owner-internal (:demand e))) earned)]
    {:value-class :devnet
     :external-earned-en (reduce + 0 (map :amount external))
     :owner-internal-excluded (reduce + 0 (map :amount internal))}))

;; ---------------------------------------------------------------------------
;; Three-way reconciliation. Mismatch stops; nothing is adjusted to match.

(defn reconcile
  "signer-records [{:transfer-id :amount :state}] where :state :finalized
  means the signer saw finality. Every signer-finalized record must be on
  the ledger with the same amount and have exactly its two journal
  entries; every settlement on the ledger must be known to the signer."
  [signer-records ledger entries]
  (let [log (:log ledger)
        by-id (into {} (map (fn [e] [(:transfer-id e) e]) log))
        signer-final (filter (fn [r] (= :finalized (:state r))) signer-records)
        signer-ids (set (map :transfer-id signer-records))
        journal-count (fn [id] (count (filter (fn [j] (= id (:transfer-id j))) entries)))
        problem
        (or (some (fn [r]
                    (let [e (get by-id (:transfer-id r))]
                      (cond
                        (nil? e) {:cause :missing-on-ledger :transfer-id (:transfer-id r)}
                        (not= (:amount r) (:amount e)) {:cause :amount-mismatch :transfer-id (:transfer-id r)}
                        (not= 2 (journal-count (:transfer-id r))) {:cause :journal-mismatch :transfer-id (:transfer-id r)}
                        :else nil)))
                  signer-final)
            (some (fn [e]
                    (when (and (= :settlement (:kind e))
                               (not (contains? signer-ids (:transfer-id e))))
                      {:cause :unexpected-on-ledger :transfer-id (:transfer-id e)}))
                  log)
            (some (fn [j]
                    (when-not (contains? by-id (:transfer-id j))
                      {:cause :journal-without-ledger :transfer-id (:transfer-id j)}))
                  entries))]
    (if problem
      (assoc problem :stop true)
      {:match true :count (count signer-final) :height (:height ledger)})))

;; ---------------------------------------------------------------------------
;; Scenario runner shared by both test runners: threads the ledger through
;; a sequence of operations so cases stay plain data.

(defn- tamper-journal [entries {:keys [drop-transfer-id add]}]
  (cond-> (vec (remove (fn [e] (= drop-transfer-id (:transfer-id e))) entries))
    add (conj add)))

(defn- run-op
  "Returns [ledger result] for one scenario operation."
  [ledger o]
  (case (:op o)
    :transfer (apply-transfer ledger (:tx o) (:now-ms o))
    :balance [ledger (balance ledger (:did o))]
    :reconcile [ledger (reconcile (:signer o) ledger
                                  (tamper-journal (journal ledger) (:tamper o)))]
    [ledger {:refused true :cause :bad-op}]))

(defn run-scenario
  "params: genesis params. ops: [{:op :transfer :tx tx :now-ms n}
  {:op :balance :did d} {:op :reconcile :signer [...] :tamper {...}}].
  Returns {:genesis decision :results [...] :final summary}."
  [params ops]
  (let [g (genesis params)]
    (if (:refused g)
      {:genesis g}
      (loop [ledger (:ledger g) ops ops results []]
        (if (empty? ops)
          (let [entries (journal ledger)]
            {:genesis {:ok true :chain-id (:chain-id ledger) :finality finality}
             :results results
             :final {:height (:height ledger)
                     :balances (balances ledger)
                     :net-zero (net-zero? ledger)
                     :journal (mapv (fn [e] [(:transfer-id e) (:account e) (:entry e) (:amount e)]) entries)
                     :earned (earned-summary entries)}})
          ;; One recur in tail position, no destructuring: Basilisp expands
          ;; destructuring let and case branches into fns, which would
          ;; detach recur from this loop.
          (let [step (run-op ledger (first ops))]
            (recur (first step) (rest ops) (conj results (second step)))))))))
