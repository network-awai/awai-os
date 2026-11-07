(ns sanka.core
  "The pure core of Sanka, where a person or a bot takes part in the Bot economy (ADR 0027). It
  checks orders, receipts and acceptances, and walks an order through its states. It runs
  unchanged on ClojureScript, Babashka and Basilisp, and test/cases.json and test/scenarios.json
  check all of them. It has no I/O, regular expressions, dates, hashing or signatures: the host
  verifies CIDs and signatures, then passes the result in as a pin or a fact. Amounts stay as digit
  strings, so no float can round them.")

(def ^:private decimal-digits "0123456789")
(def ^:private hex-digits "0123456789abcdef")
(def ^:private cid-chars "abcdefghijklmnopqrstuvwxyz234567")

;; Only compute is open. ADR 0027 D9 opens the others in order, behind their own gates.
(def ^:private open-work-kinds #{"compute"})
(def ^:private known-work-kinds #{"compute" "storage" "human"})
(def ^:private value-classes #{"simulation" "devnet" "live"})
(def ^:private demands #{"owner-internal" "external" "replay"})

(def ^:private order-keys
  #{:kind :work-kind :buyer :provider :node :asset :amount :value-class :model :max-tokens
    :expires-at :data-categories :policy :demand :nonce})

;; A closed set: a prompt or an output body has nowhere to go in a receipt.
(def ^:private receipt-keys
  #{:kind :work-kind :order :provider :node :input :output :engine :model :measured :ledger-head
    :demand :nonce :signer :signature})

(def ^:private acceptance-keys #{:kind :order :receipt :acceptor :verdict :at})

(defn- index-of-char
  "The position of character c in text, or nil."
  [text c]
  (first (keep-indexed (fn [i x] (when (= x c) i)) (seq text))))

(defn- all-in? [allowed text]
  (every? #(some? (index-of-char allowed %)) (seq text)))

(defn- prefixed
  "The text after prefix, or nil when text does not start with it."
  [prefix text]
  (when (and (string? text)
             (>= (count text) (count prefix))
             (= (subs text 0 (count prefix)) prefix))
    (subs text (count prefix))))

(defn- text? [value]
  (and (string? value) (pos? (count value))))

(defn- count-int?
  "A whole number that is not a boolean. Python counts true as an integer."
  [value]
  (and (not (boolean? value)) (integer? value)))

(defn- positive-int? [value]
  (and (count-int? value) (pos? value)))

(defn- natural-int? [value]
  (and (count-int? value) (>= value 0)))

(defn- did? [value]
  (let [body (prefixed "did:key:z" value)]
    (boolean (and body (pos? (count body))))))

(defn- cid?
  "The shape of a CIDv1 in base32. The host recomputes the hash."
  [value]
  (boolean (and (string? value)
                (< 50 (count value) 70)
                (= (subs value 0 1) "b")
                (all-in? cid-chars value))))

(defn- hex-256? [body]
  (boolean (and body (= 64 (count body)) (all-in? hex-digits body))))

(defn- sha256? [value]
  (hex-256? (prefixed "sha256:" value)))

(defn- keyed-hash?
  "An input hash under the order's key. A plain hash of a short prompt can be guessed."
  [value]
  (hex-256? (prefixed "hmac-sha256:" value)))

(defn- digits? [value]
  (boolean (and (string? value) (pos? (count value)) (all-in? decimal-digits value))))

(defn- strip-zeros [digits]
  (let [kept (apply str (drop-while #(= % (first "0")) (seq digits)))]
    (if (= kept "") "0" kept)))

(defn- positive-digits? [value]
  (and (digits? value) (not= "0" (strip-zeros value))))

(defn- digits-at-most?
  "True when digit string a is not above digit string b."
  [a b]
  (let [x (strip-zeros a) y (strip-zeros b)]
    (cond
      (< (count x) (count y)) true
      (> (count x) (count y)) false
      :else (<= (compare x y) 0))))

(defn- add-digits
  "The sum of two digit strings."
  [a b]
  (let [digit-values (fn [text] (reverse (map #(index-of-char decimal-digits %) (seq text))))]
    (loop [xs (digit-values a) ys (digit-values b) carry 0 out ()]
      (if (or (seq xs) (seq ys) (pos? carry))
        (let [sum (+ (or (first xs) 0) (or (first ys) 0) carry)
              digit (mod sum 10)]
          (recur (rest xs) (rest ys) (quot (- sum digit) 10) (cons digit out)))
        (strip-zeros (apply str out))))))

(defn- outcome
  "A check's result. Errors keep the order they were found in."
  [errors]
  (if (seq errors) {:ok false :errors errors} {:ok true}))

(defn- only-keys? [allowed value]
  (and (map? value) (every? #(contains? allowed %) (keys value))))

(defn- pinned-model? [model]
  (and (map? model) (text? (:revision model)) (sha256? (:digest model))))

(defn check-order
  "Checks one order as the buyer states it. It says nothing about whether it was approved."
  [order]
  (if-not (only-keys? order-keys order)
    {:ok false :errors ["order/unknown-field"]}
    (let [kind (:work-kind order)
          categories (:data-categories order)]
      (outcome
       (cond-> []
         (not= "awai.order/1" (:kind order)) (conj "order/kind")
         (not (contains? known-work-kinds kind)) (conj "order/work-kind")
         (and (contains? known-work-kinds kind) (not (contains? open-work-kinds kind)))
         (conj "order/work-kind-not-open")
         (not (did? (:buyer order))) (conj "order/buyer")
         (not (did? (:provider order))) (conj "order/provider")
         (not (did? (:node order))) (conj "order/node")
         (and (did? (:buyer order)) (= (:buyer order) (:provider order))) (conj "order/self-dealing")
         (and (did? (:node order)) (= (:node order) (:provider order))) (conj "order/node-as-payee")
         (not (text? (:asset order))) (conj "order/asset")
         (not (positive-digits? (:amount order))) (conj "order/amount")
         (not (contains? value-classes (:value-class order))) (conj "order/value-class")
         (= "live" (:value-class order)) (conj "order/live-not-approved")
         (and (= "compute" kind) (not (pinned-model? (:model order)))) (conj "order/model")
         (not (positive-int? (:max-tokens order))) (conj "order/max-tokens")
         (not (positive-int? (:expires-at order))) (conj "order/expires-at")
         (not (and (sequential? categories) (seq categories) (every? text? categories)))
         (conj "order/data-categories")
         (not (sha256? (:policy order))) (conj "order/policy")
         (not (contains? demands (:demand order))) (conj "order/demand")
         (not (text? (:nonce order))) (conj "order/nonce"))))))

(defn check-receipt
  "Checks a receipt against what the verifier already knows: the order's CID and fields. The host
  checks the signature and the output. A receipt records work, not its quality."
  [receipt pins]
  (if-not (only-keys? receipt-keys receipt)
    {:ok false :errors ["receipt/unknown-field"]}
    (let [engine (:engine receipt)
          measured (:measured receipt)
          started (:started-at measured)
          finished (:finished-at measured)
          model (:model receipt)]
      (outcome
       (cond-> []
         (not= "awai.work-receipt/1" (:kind receipt)) (conj "receipt/kind")
         (not= "compute" (:work-kind receipt)) (conj "receipt/work-kind")
         (not (cid? (:order receipt))) (conj "receipt/order")
         (not= (:order-cid pins) (:order receipt)) (conj "receipt/other-order")
         (not= (:provider pins) (:provider receipt)) (conj "receipt/provider")
         (not= (:node pins) (:node receipt)) (conj "receipt/node")
         (not= (:node pins) (:signer receipt)) (conj "receipt/signer")
         (not (text? (:signature receipt))) (conj "receipt/signature")
         (not (keyed-hash? (:input receipt))) (conj "receipt/input")
         (not (cid? (:output receipt))) (conj "receipt/output")
         (not (and (map? engine) (text? (:name engine)) (text? (:version engine))
                   (sha256? (:digest engine))))
         (conj "receipt/engine")
         (not (pinned-model? model)) (conj "receipt/model")
         (and (map? model) (not= (:model-digest pins) (:digest model))) (conj "receipt/other-model")
         (not (and (map? measured)
                   (natural-int? (:prompt-tokens measured))
                   (natural-int? (:completion-tokens measured))
                   (positive-int? started)
                   (positive-int? finished)
                   (<= started finished)))
         (conj "receipt/measured")
         (not (cid? (:ledger-head receipt))) (conj "receipt/ledger-head")
         (not= (:demand pins) (:demand receipt)) (conj "receipt/demand")
         (not= (:nonce pins) (:nonce receipt)) (conj "receipt/nonce"))))))

(defn check-acceptance
  "Checks the judgement on a result. The provider and its node cannot accept their own work."
  [acceptance pins]
  (if-not (only-keys? acceptance-keys acceptance)
    {:ok false :errors ["acceptance/unknown-field"]}
    (let [acceptor (:acceptor acceptance)]
      (outcome
       (cond-> []
         (not= "awai.acceptance/1" (:kind acceptance)) (conj "acceptance/kind")
         (not= (:order-cid pins) (:order acceptance)) (conj "acceptance/other-order")
         (not= (:receipt-cid pins) (:receipt acceptance)) (conj "acceptance/other-receipt")
         (not= (:acceptor pins) acceptor) (conj "acceptance/acceptor")
         (or (= acceptor (:provider pins)) (= acceptor (:node pins))) (conj "acceptance/self-judged")
         (not (contains? #{"accepted" "rejected"} (:verdict acceptance))) (conj "acceptance/verdict")
         (not (positive-int? (:at acceptance))) (conj "acceptance/at"))))))

;; ADR 0027 D6. Nothing leaves `submitted` by submitting again.
(def ^:private transitions
  {"proposed" {"approve" "approved" "deny" "denied"}
   "approved" {"reserve" "reserved" "refuse" "refused"}
   "reserved" {"start" "executing" "expire" "expired"}
   "executing" {"receipt" "receipted" "fail" "failed" "expire" "expired"}
   "receipted" {"accept" "accepted" "reject" "rejected" "expire" "expired"}
   "accepted" {"submit" "submitted" "release" "released"}
   "submitted" {"finalize" "finalized" "lose-response" "ambiguous"}
   "ambiguous" {"reconcile-finalized" "finalized" "reconcile-absent" "released"}
   "finalized" {"record" "recorded"}})

(def ^:private reservations
  {"proposed" "none" "approved" "none" "denied" "none" "refused" "none"
   "reserved" "held" "executing" "held" "receipted" "held" "accepted" "held"
   "submitted" "held" "ambiguous" "held"
   "expired" "released" "failed" "released" "rejected" "released" "released" "released"
   "finalized" "spent" "recorded" "spent"})

(defn- guard-error
  "Why an event may not happen, given what the host has verified. An absent fact is not a yes."
  [event facts]
  (case event
    "approve" (when-not (true? (:human-approved facts)) "approve/not-human")
    "reserve" (cond
                (not (true? (:balance-known facts))) "reserve/balance-unknown"
                (not (and (digits? (:available facts)) (digits? (:amount facts))))
                "reserve/amount-unknown"
                (not (digits-at-most? (:amount facts) (:available facts))) "reserve/over-available")
    "start" (when-not (true? (:reservation-persisted facts)) "start/not-persisted")
    "receipt" (when-not (true? (:receipt-verified facts)) "receipt/not-verified")
    "accept" (when-not (true? (:acceptance-verified facts)) "accept/not-verified")
    "submit" (when-not (and (digits? (:amount facts)) (digits? (:reserved facts))
                            (digits-at-most? (:amount facts) (:reserved facts)))
               "submit/over-reservation")
    "record" (when-not (true? (:readback-match facts)) "record/readback-mismatch")
    nil))

(defn transition
  "The next state, or an error that leaves the state unchanged."
  [state event facts]
  (let [next-state (get-in transitions [state event])
        problem (when next-state (guard-error event facts))]
    (cond
      (nil? next-state) {:state state :error "transition/invalid"}
      problem {:state state :error problem}
      :else {:state next-state})))

(defn reservation
  "What happened to the money set aside for an order in this state, or nil for an unknown state."
  [state]
  (get reservations state))

(defn terminal?
  "True when an order in this state can never move again."
  [state]
  (and (contains? reservations state) (not (contains? transitions state))))

(defn walk
  "Runs events from a new order and stops at the first refusal."
  [events]
  (loop [state "proposed" left events]
    (if-let [step (first left)]
      (let [result (transition state (:event step) (:facts step))]
        (if (:error result)
          {:state state :error (:error result) :event (:event step)
           :reservation (reservation state)}
          (recur (:state result) (rest left))))
      {:state state :reservation (reservation state)})))

(defn balance-view
  "What a screen may show for one balance. An unknown balance is never zero."
  [line]
  (let [known (and (true? (:known line)) (digits? (:raw line)))]
    (cond
      (not (contains? value-classes (:value-class line))) {:error "balance/value-class"}
      (not (text? (:asset line))) {:error "balance/asset"}
      known {:text (strip-zeros (:raw line)) :known true :asset (:asset line)
             :value-class (:value-class line)}
      :else {:text "unknown" :known false :asset (:asset line)
             :value-class (:value-class line)})))

(defn total
  "The sum of balances of one asset and one value class. Anything else has no total."
  [lines]
  (cond
    (empty? lines) {:error "total/empty"}
    (not= 1 (count (set (map (juxt :asset :value-class) lines)))) {:error "total/mixed"}
    (not (every? #(:known (balance-view %)) lines)) {:error "total/unknown"}
    :else {:raw (reduce add-digits "0" (map :raw lines))
           :asset (:asset (first lines))
           :value-class (:value-class (first lines))}))
