(ns awai-support.core
  "Support for Awai Network as a whole, received by the awai-support bot
  (AWAI-3169, parent AWAI-3112). Pure .cljc Otehon core.

  The bot receives support on behalf of Awai Network LLC (owner decision
  2026-11-18). Whether a payment is a donation, support or a purchase is
  undecided and needs professional review, so every text here says
  \"support\" (支援), never \"donation\" (寄付). Nothing here is
  tax-deductible.

  This stage is devnet only. A sponsor's support is an EN devnet `:funding`
  transfer (sponsor -> bot) decided by `en-devnet.core`; it is not money,
  revenue, a deposit or a donation. The crypto, card and compute routes are
  tracked on their own issues and stay unavailable here.

  Flow: `consent-card` shows exactly what will be signed. `decide` turns
  the person's answer into a funding request only when the answer approves
  that same card; anything else sends nothing. `receipt` checks the node's
  readback (balance and journal) against the card.

  Pure: no I/O, keys, signatures, randomness or clock. The host supplies
  now-ms, nonces and signatures.")

(def target
  {:id "awai-support"
   :recipient {:legal-name "Awai Network LLC" :kind :llc}
   :wording :support
   :value-class :devnet
   :purpose ["Awai Network node operation"
             "Itonami dapps development"
             "creative work"
             "resource provision"]
   :routes {:en-devnet {:status :devnet :issue "AWAI-3169"}
            :crypto {:status :unavailable :issue "AWAI-3113"}
            :card {:status :unavailable :issue "AWAI-3122"}
            :compute {:status :unavailable :issue "AWAI-3115"}}
   :notices [:devnet-not-money :not-tax-deductible :wording-undecided]})

(defn- int-value? [x] (and (integer? x) (not (boolean? x))))
(defn- did? [x]
  (and (string? x) (> (count x) 8) (= "did:key:" (subs x 0 8))))

(defn card-problem
  "First reason a support request cannot be shown, or nil."
  [{:keys [route chain-id sponsor bot amount transfer-id expires-ms]}]
  (let [r (get-in target [:routes route])]
    (cond
      (nil? r) :unknown-route
      (not= :devnet (:status r)) :route-unavailable
      (not (and (string? chain-id) (pos? (count chain-id)))) :bad-chain-id
      (not (did? sponsor)) :bad-sponsor
      (not (did? bot)) :bad-bot
      (= sponsor bot) :self-support
      (not (and (int-value? amount) (pos? amount))) :bad-amount
      (not (and (string? transfer-id) (pos? (count transfer-id)))) :bad-transfer-id
      (not (int-value? expires-ms)) :bad-expiry
      :else nil)))

(defn consent-card
  "The card shown to the sponsor before anything is signed, or
  {:refused true :cause c}. Every field the funding transfer depends on is
  on the card, so approving the card approves exactly that transfer."
  [request]
  (if-let [cause (card-problem request)]
    {:refused true :cause cause}
    {:kind :awai-support/consent-card
     :target (:id target)
     :recipient (:recipient target)
     :wording (:wording target)
     :value-class :devnet
     :route (:route request)
     :chain-id (:chain-id request)
     :sponsor (:sponsor request)
     :bot (:bot request)
     :amount (:amount request)
     :transfer-id (:transfer-id request)
     :expires-ms (:expires-ms request)
     :purpose (:purpose target)
     :notices (:notices target)}))

(defn decide
  "answer {:approved bool :card c}. Returns {:send? true :funding tx} only
  when the answer approves the identical card; otherwise {:send? false
  :cause c} and nothing may be sent. The funding tx is unsigned; the host
  adds the nonce and both signatures."
  [card answer now-ms]
  (cond
    (:refused card) {:send? false :cause (:cause card)}
    (not (map? answer)) {:send? false :cause :no-answer}
    (not (true? (:approved answer))) {:send? false :cause :denied}
    (not= card (:card answer)) {:send? false :cause :card-mismatch}
    (<= (:expires-ms card) now-ms) {:send? false :cause :expired}
    :else
    {:send? true
     :funding {:chain-id (:chain-id card)
               :value-class :devnet
               :kind :funding
               :transfer-id (:transfer-id card)
               :spender (:sponsor card)
               :receiver (:bot card)
               :amount (:amount card)
               :fee 0
               :expires-ms (:expires-ms card)}}))

(defn receipt
  "Check the node's readback for an approved card.
  readback {:decision d :before b :after a :journal entries}, where b and a
  are the bot's balance reads (en-devnet `balance` shape) before and after.
  Returns {:received true ...} or {:received false :cause c}."
  [card {:keys [decision before after journal]}]
  (let [tid (:transfer-id card)
        mine (filter (fn [e] (= tid (:transfer-id e))) journal)
        credit (filter (fn [e] (and (= :credit-received (:entry e))
                                    (= (:bot card) (:account e))))
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
       :recipient (:recipient card)
       :transfer-id tid
       :height (:height decision)
       :amount (:amount card)
       :value-class :devnet
       :finality (:finality decision)})))
