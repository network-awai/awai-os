(ns fake-provider
  "What C1b-3's Murakumo will do with one sealed order, without a device or a model: open it with
  the offer's key, ask sanka.device, make the receipt, sign it with the node's Ed25519 key, and seal
  the result to the order's reply key. The output is given, not inferred. Tests only."
  (:require ["node:crypto" :as crypto]
            [sanka.device :as device]
            [sanka.hpke :as hpke]
            [sanka.wire :as wire]))

(def engine {:name "llama.cpp" :version "b6000" :digest (str "sha256:" (apply str (repeat 64 "e")))})
(def model {:revision "rev-1" :digest (str "sha256:" (apply str (repeat 64 "a")))})
(def ledger-head (str "b" (apply str (repeat 58 "e"))))

(defn make-offer
  "An offer and its private seal key, for a node key and a buyer, on the given mailbox origin."
  [{:keys [node buyer origin now-seconds]}]
  (let [seal-private (hpke/generate-private)]
    {:seal-private seal-private
     :offer {:kind "awai.compute-offer/1" :work-kind "compute"
             :provider (:did (wire/ed25519-key)) :node (:did node)
             :asset "native/engi/EN" :amount "1" :value-class "devnet" :model model :engine engine
             :max-tokens 128
             :limits {:min-battery-percent 50 :require-charging true :max-thermal-status 2
                      :allow-metered false :max-orders-per-day 20}
             :expires-at (+ now-seconds 86400) :nonce "offer-1"
             :mailbox {:origin origin :topic (.toString (crypto/randomBytes 16) "hex")}
             :seal-key (wire/seal-key-text (hpke/raw-public (hpke/private-key seal-private)))
             :buyers [(:did buyer)]}}))

(defn make-order [{:keys [offer buyer now-seconds]}]
  {:kind "awai.order/1" :work-kind "compute" :buyer (:did buyer) :provider (:provider offer)
   :node (:node offer) :asset "native/engi/EN" :amount "1" :value-class "devnet" :model model
   :max-tokens 64 :expires-at (+ now-seconds 1800) :data-categories ["prompt"]
   :policy (str "sha256:" (apply str (repeat 64 "b"))) :demand "owner-internal"
   :nonce (str "n-" now-seconds)})

(def good-facts
  {:battery-percent 80 :charging true :thermal-status 1 :metered false :active-orders 0
   :orders-today 3 :already-run false})

(defn serve
  "The result to post for one mailbox message, as {:url :headers :body}, or nil when the message
  does not open for this offer. `tamper` changes the receipt or output after signing, for the
  negative controls."
  [{:keys [offer seal-private node facts output now-seconds tamper] :or {tamper identity}} message]
  (let [offer-cid (wire/cid-of (wire/canonical offer))]
    (when-let [{:keys [document context]} (wire/open seal-private (wire/order-info offer-cid) message)]
      (let [{:keys [order order-cid prompt reply]} document
            admitted (if (:ok (device/check-order-envelope offer offer-cid document))
                       (device/admit-order offer "offered" order (assoc facts :now now-seconds))
                       {:admit false :reason "device/envelope-invalid"})
            outcome (if-not (:admit admitted)
                      admitted
                      (let [run {:engine engine
                                 :input (wire/input-hash (wire/input-key context) prompt)
                                 :output (wire/output-cid output)
                                 :ledger-head ledger-head
                                 :measured {:prompt-tokens 12 :completion-tokens 40
                                            :started-at (inc now-seconds) :finished-at (+ 3 now-seconds)}}
                            body (:receipt (device/receipt-body offer order order-cid run))]
                        (tamper {:output output :receipt (wire/sign-document node body)})))
            result (:envelope (device/result-envelope offer-cid order-cid outcome))
            {:keys [message]} (wire/seal (:seal-key reply) (wire/result-info offer-cid order-cid) result)]
        {:url (str (get-in offer [:mailbox :origin]) "/" (:topic reply))
         :headers {"content-type" "text/plain"}
         :body message}))))
