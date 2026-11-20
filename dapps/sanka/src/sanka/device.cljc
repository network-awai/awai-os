(ns sanka.device
  "What an Android phone or PC enforces before it serves one compute order as a provider
  (AWAI-3115, stage C1). It checks the device's offer, decides from the device's own facts whether
  to take an order now, walks the offer through its states, and builds the receipt body for the
  host to sign. Like sanka.core it has no I/O, regular expressions, dates, hashing or signatures,
  and runs unchanged on ClojureScript, Babashka and Basilisp. The host reads the battery, thermal
  and network state from Android and passes them in as facts. An absent fact is not a yes."
  (:require [sanka.core :as core]))

(def ^:private decimal-digits "0123456789")
(def ^:private hex-digits "0123456789abcdef")

;; Only simulation and devnet are open. A live offer needs its own approval (ADR 0027 D5).
(def ^:private value-classes #{"simulation" "devnet" "live"})

(def ^:private offer-keys
  #{:kind :work-kind :provider :node :asset :amount :value-class :model :engine :max-tokens
    :limits :expires-at :nonce})

(def ^:private limit-keys
  #{:min-battery-percent :require-charging :max-thermal-status :allow-metered
    :max-orders-per-day})

;; Android PowerManager thermal status: 0 none ... 6 shutdown.
(def ^:private highest-thermal-status 6)

(defn- index-of-char [text c]
  (first (keep-indexed (fn [i x] (when (= x c) i)) (seq text))))

(defn- all-in? [allowed text]
  (every? #(some? (index-of-char allowed %)) (seq text)))

(defn- prefixed [prefix text]
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

(defn- int-between? [low high value]
  (and (count-int? value) (<= low value high)))

(defn- did? [value]
  (let [body (prefixed "did:key:z" value)]
    (boolean (and body (pos? (count body))))))

(defn- sha256? [value]
  (let [body (prefixed "sha256:" value)]
    (boolean (and body (= 64 (count body)) (all-in? hex-digits body)))))

(defn- strip-zeros [digits]
  (let [kept (apply str (drop-while #(= % (first "0")) (seq digits)))]
    (if (= kept "") "0" kept)))

(defn- positive-digits? [value]
  (and (string? value) (pos? (count value)) (all-in? decimal-digits value)
       (not= "0" (strip-zeros value))))

(defn- same-amount? [a b]
  (and (positive-digits? a) (positive-digits? b) (= (strip-zeros a) (strip-zeros b))))

(defn- only-keys? [allowed value]
  (and (map? value) (every? #(contains? allowed %) (keys value))))

(defn- all-keys? [wanted value]
  (and (map? value) (= (set (keys value)) wanted)))

(defn- outcome [errors]
  (if (seq errors) {:ok false :errors errors} {:ok true}))

(defn- pinned-model? [model]
  (and (map? model) (text? (:revision model)) (sha256? (:digest model))))

(defn- pinned-engine? [engine]
  (and (map? engine) (text? (:name engine)) (text? (:version engine)) (sha256? (:digest engine))))

(defn- limits-ok? [limits]
  (and (all-keys? limit-keys limits)
       (int-between? 0 100 (:min-battery-percent limits))
       (boolean? (:require-charging limits))
       (int-between? 0 highest-thermal-status (:max-thermal-status limits))
       (boolean? (:allow-metered limits))
       (positive-int? (:max-orders-per-day limits))))

(defn check-offer
  "Checks what a device offers. It says nothing about whether the person turned the offer on."
  [offer]
  (if-not (only-keys? offer-keys offer)
    {:ok false :errors ["offer/unknown-field"]}
    (outcome
     (cond-> []
       (not= "awai.compute-offer/1" (:kind offer)) (conj "offer/kind")
       (not= "compute" (:work-kind offer)) (conj "offer/work-kind")
       (not (did? (:provider offer))) (conj "offer/provider")
       (not (did? (:node offer))) (conj "offer/node")
       (and (did? (:node offer)) (= (:node offer) (:provider offer))) (conj "offer/node-as-payee")
       (not (text? (:asset offer))) (conj "offer/asset")
       (not (positive-digits? (:amount offer))) (conj "offer/amount")
       (not (contains? value-classes (:value-class offer))) (conj "offer/value-class")
       (= "live" (:value-class offer)) (conj "offer/live-not-approved")
       (not (pinned-model? (:model offer))) (conj "offer/model")
       (not (pinned-engine? (:engine offer))) (conj "offer/engine")
       (not (positive-int? (:max-tokens offer))) (conj "offer/max-tokens")
       (not (limits-ok? (:limits offer))) (conj "offer/limits")
       (not (positive-int? (:expires-at offer))) (conj "offer/expires-at")
       (not (text? (:nonce offer))) (conj "offer/nonce")))))

;; The person turns the offer on and off. Withdrawal is final for this offer: a new offer starts
;; again from draft. A running order is not cut off; admit-order refuses new ones.
(def ^:private offer-transitions
  {"draft" {"publish" "offered" "withdraw" "withdrawn"}
   "offered" {"pause" "paused" "withdraw" "withdrawn" "expire" "expired"}
   "paused" {"resume" "offered" "withdraw" "withdrawn" "expire" "expired"}
   "withdrawn" {}
   "expired" {}})

(defn offer-transition
  "The offer's next state, or an error that leaves the state unchanged. Publishing and resuming
  need a fact the host can only get from the person: that they chose to offer this device."
  [state event facts]
  (let [next-state (get-in offer-transitions [state event])]
    (cond
      (not (contains? offer-transitions state)) {:state state :error "offer/unknown-state"}
      (nil? next-state) {:state state :error "offer/not-allowed"}
      (and (contains? #{"publish" "resume"} event) (not (true? (:person-chose facts))))
      {:state state :error "offer/person-did-not-choose"}
      :else {:state next-state})))

(defn- fact-error
  "The first device fact that is missing or the wrong type. The order of the checks is fixed."
  [facts]
  (cond
    (not (map? facts)) "device/unknown-facts"
    (not (positive-int? (:now facts))) "device/unknown-time"
    (not (int-between? 0 100 (:battery-percent facts))) "device/unknown-battery"
    (not (boolean? (:charging facts))) "device/unknown-charging"
    (not (int-between? 0 highest-thermal-status (:thermal-status facts))) "device/unknown-thermal"
    (not (boolean? (:metered facts))) "device/unknown-network"
    (not (and (count-int? (:active-orders facts)) (>= (:active-orders facts) 0)))
    "device/unknown-active-orders"
    (not (and (count-int? (:orders-today facts)) (>= (:orders-today facts) 0)))
    "device/unknown-orders-today"
    :else nil))

(defn- mismatch
  "The first field where the order asks for something the offer does not give."
  [offer order]
  (cond
    (not= (:provider offer) (:provider order)) "device/other-provider"
    (not= (:node offer) (:node order)) "device/other-node"
    (not= (:asset offer) (:asset order)) "device/other-asset"
    (not (same-amount? (:amount offer) (:amount order))) "device/other-amount"
    (not= (:value-class offer) (:value-class order)) "device/other-value-class"
    (not= (:model offer) (:model order)) "device/other-model"
    (> (:max-tokens order) (:max-tokens offer)) "device/too-many-tokens"
    :else nil))

(defn admit-order
  "Whether this device takes the order now, and if not, the first reason. Only one order runs at
  a time, so a phone never shares its engine between buyers."
  [offer offer-state order facts]
  (let [limits (:limits offer)
        refuse (fn [reason] {:admit false :reason reason})]
    (cond
      (not (:ok (check-offer offer))) (refuse "device/offer-invalid")
      (not (:ok (core/check-order order))) (refuse "device/order-invalid")
      (not= "offered" offer-state) (refuse "device/not-offered")
      :else
      (if-let [reason (or (mismatch offer order) (fact-error facts))]
        (refuse reason)
        (cond
          (>= (:now facts) (:expires-at offer)) (refuse "device/offer-expired")
          (>= (:now facts) (:expires-at order)) (refuse "device/order-expired")
          (and (:require-charging limits) (not (:charging facts))) (refuse "device/not-charging")
          (< (:battery-percent facts) (:min-battery-percent limits)) (refuse "device/low-battery")
          (> (:thermal-status facts) (:max-thermal-status limits)) (refuse "device/too-hot")
          (and (:metered facts) (not (:allow-metered limits))) (refuse "device/metered-network")
          (pos? (:active-orders facts)) (refuse "device/busy")
          (>= (:orders-today facts) (:max-orders-per-day limits)) (refuse "device/daily-cap")
          :else {:admit true})))))

(defn receipt-body
  "The receipt the host signs after one admitted order ran. The host passes what it measured and
  the hashes it took; the signer and signature are added by the host. It refuses a receipt that
  would claim more than the order allowed or a different engine than the offer named."
  [offer order order-cid run]
  (let [measured (:measured run)]
    (cond
      (not (map? run)) {:ok false :error "receipt/unknown-run"}
      (not= (:engine offer) (:engine run)) {:ok false :error "receipt/other-engine"}
      (not (map? measured)) {:ok false :error "receipt/measured"}
      (not (count-int? (:completion-tokens measured))) {:ok false :error "receipt/measured"}
      (> (:completion-tokens measured) (:max-tokens order)) {:ok false :error "receipt/over-max-tokens"}
      :else
      {:ok true
       :receipt {:kind "awai.work-receipt/1"
                 :work-kind "compute"
                 :order order-cid
                 :provider (:provider order)
                 :node (:node order)
                 :input (:input run)
                 :output (:output run)
                 :engine (:engine offer)
                 :model (:model order)
                 :measured measured
                 :ledger-head (:ledger-head run)
                 :demand (:demand order)
                 :nonce (:nonce order)}})))
