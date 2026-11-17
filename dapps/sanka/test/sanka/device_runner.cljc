(ns sanka.device-runner
  "Runs test/device_cases.json against sanka.device. Each platform only parses the JSON and exits."
  (:require [sanka.core :as core]
            [sanka.device :as device]))

(defn- receipt-roundtrip
  "Builds the receipt body, adds the signer and signature the host would add, and runs the
  verifier's own check on it."
  [offer order order-cid run]
  (let [built (device/receipt-body offer order order-cid run)]
    (if-not (:ok built)
      {:ok false :errors [(:error built)]}
      (core/check-receipt (assoc (:receipt built) :signer (:node order) :signature "host-signature")
                          {:order-cid order-cid
                           :provider (:provider order)
                           :node (:node order)
                           :model-digest (get-in order [:model :digest])
                           :demand (:demand order)
                           :nonce (:nonce order)}))))

(def functions
  {"check-offer" device/check-offer
   "offer-transition" device/offer-transition
   "admit-order" device/admit-order
   "receipt-body" device/receipt-body
   "receipt-roundtrip" receipt-roundtrip})

(defn- plain [value]
  (cond
    (map? value) (into {} (map (fn [[k v]] [(name k) (plain v)]) value))
    (sequential? value) (mapv plain value)
    (keyword? value) (name value)
    :else value))

(defn- case-failure [c]
  (let [got (plain (apply (get functions (:fn c)) (:args c)))
        want (plain (:expect c))]
    (when-not (= got want)
      (str (:fn c) " " (pr-str (:args c)) " got " (pr-str got) " want " (pr-str want)))))

(defn run
  "Returns the failure messages and the number of checks."
  [cases]
  {:failures (vec (keep case-failure cases)) :checks (count cases)})
