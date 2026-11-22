(ns awai-compute.core
  "Compute support for Awai Network (AWAI-3115, parent AWAI-3112).
  Pure .cljc Otehon core.

  C1 only: an Android device (Murakumo llama.cpp real inference, AWAI-3011)
  is the provider. It signs an Offer (`awai.compute.offer/1`), accepts a
  sanka compute Order, runs the inference locally, and returns a signed
  work receipt (`awai.work-receipt/1`). The bot acts as the acceptor and
  funds the provider with a devnet-only EN devnet `:compute-funding` transfer
  (bot -> provider) decided by `en-devnet.core`.

  devnet and simulation only in this stage. Nothing here is money, revenue,
  a deposit or a donation. C2 (the \"resources to give\" button UX, AWAI-196)
  and C3 (real node path AWAI-234, evidence AWAI-140) are out of scope and
  untouched.

  Key separation (approved design): the provider signs Offer and receipt
  with a separate non-exportable P-256 key (not the device identity key);
  the acceptor signs the Order and the funding transfer from the desk
  host with its own key. The sponsor key and EN devnet ACLs are untouched.

  The unit of credit is provisional: one Order consumes one credit. That
  constant lives here so replacement is one edit; nothing in the phone or
  the desk hard-codes a meaning.

  Pure: no I/O, keys, signatures, randomness or clock. The host supplies
  now-ms, nonces and signatures.")

;; Provisional constant: one compute order consumes one devnet credit.
;; Replaceable later; C1 only.
(def provisional-credit-per-order 1)

(def target
  {:id "awai-compute"
   :wording :provide
   :value-class :devnet
   :kind :awai-compute-offer
   :receipt-kind :work-receipt
   :notices [:devnet-not-money :work-receipt-no-content :simulation-only]})

(defn- int-value? [x] (and (integer? x) (not (boolean? x))))
(defn- did? [x]
  (and (string? x) (> (count x) 8) (= "did:key:" (subs x 0 8))))

(defn- order-id? [x]
  (and (string? x)
       (>= (count x) 8)
       (>= (count x) 9)
       (= "compute-" (subs x 0 8))))

(defn offer-problem
  "First reason an offer request cannot be shown, or nil."
  [{:keys [route chain-id provider consumer amount order-id expires-ms]}]
  (cond
    (not= :en-devnet route) :route-unavailable
    (not (and (string? chain-id) (pos? (count chain-id)))) :bad-chain-id
    (not (did? provider)) :bad-provider
    (not (did? consumer)) :bad-consumer
    (= provider consumer) :self-provision
    (not (and (int-value? amount) (pos? amount))) :bad-amount
    (not (order-id? order-id)) :bad-order-id
    (not (int-value? expires-ms)) :bad-expiry
    :else nil))

(defn offer-card
  "The card shown to the acceptor before anything is signed, or
  {:refused true :cause c}. Every field the funding transfer depends on
  is on the card, so signing the offer signs exactly that transfer."
  [request]
  (if-let [cause (offer-problem request)]
    {:refused true :cause cause}
    {:kind (:kind target)
     :target (:id target)
     :wording (:wording target)
     :value-class (:value-class target)
     :route (:route request)
     :chain-id (:chain-id request)
     :provider (:provider request)
     :consumer (:consumer request)
     :amount (:amount request)
     :order-id (:order-id request)
     :expires-ms (:expires-ms request)
     :notices (:notices target)}))

(defn decide
  "answer {:approved bool :card c}. Returns {:order? true :funding tx}
  only when the answer approves the identical offer card; otherwise
  {:order? false :cause c} and nothing may be sent. The funding tx is
  unsigned; the host adds the nonce and both signatures (acceptor first,
  provider second)."
  [card answer now-ms]
  (cond
    (:refused card) {:order? false :cause (:cause card)}
    (not (map? answer)) {:order? false :cause :no-answer}
    (not (true? (:approved answer))) {:order? false :cause :denied}
    (not= card (:card answer)) {:order? false :cause :card-mismatch}
    (<= (:expires-ms card) now-ms) {:order? false :cause :expired}
    :else
    {:order? true
     :funding {:chain-id (:chain-id card)
               :value-class :devnet
               :kind :compute-funding
               :transfer-id (:order-id card)
               :spender (:consumer card)
               :receiver (:provider card)
               :amount (:amount card)
               :fee 0
               :expires-ms (:expires-ms card)}}))

(defn work-receipt
  "The work receipt doc issued by the provider after real inference.
  Contains no prompt or output body in any stage: order-id, provider,
  transfer-id, height and credit only. The host asks the provider to
  sign this exact text (canonical form front of :awai.work-receipt/1)."
  [order-id provider transfer-id height amount]
  {:kind :work-receipt
   :order-id order-id
   :provider provider
   :transfer-id transfer-id
   :height height
   :amount amount
   :value-class :devnet})

(defn receipt
  "Check the node's readback for a completed order.
  readback {:decision d :before b :after a :journal entries}, where b and a
  are the provider's balance reads (en-devnet `balance` shape) before and
  after. Returns {:received true ...} or {:received false :cause c}."
  [card {:keys [decision before after journal]}]
  (let [tid (:order-id card)
        mine (filter (fn [e] (= tid (:transfer-id e))) journal)
        credit (filter (fn [e] (and (= :credit-received (:entry e))
                                    (= (:provider card) (:account e))))
                       mine)]
    (cond
      (not (true? (:finalized decision))) {:received false :cause :not-finalized}
      (not= tid (:transfer-id decision)) {:received false :cause :wrong-transfer}
      (not (and (:known? before) (:known? after))) {:received false :cause :balance-unknown}
      (not= (:amount card) (- (:balance after) (:balance before)))
      {:received false :cause :balance-mismatch}
      (not= 1 (count credit)) {:received false :cause :journal-mismatch}
      (not= (:amount card) (:amount (first credit))) {:received false :cause :journal-mismatch}
      :else
      {:received true
       :provider (:provider card)
       :order-id tid
       :height (:height decision)
       :amount (:amount card)
       :value-class :devnet
       :finality (:finality decision)})))
