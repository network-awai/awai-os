;; Writes test/device_cases.json for sanka.device from one good offer, order, facts and run.
;;
;; Each negative control changes one field of a good document, so a case cannot pass for a reason
;; other than the one it names. Expectations are written here by hand; the core only runs them.
;; usage: bb test/gen_device_cases.clj
(ns gen-device-cases
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

(defn- times [text size] (apply str (repeat size text)))

(def provider "did:key:zProvider")
(def node "did:key:zNode")
(def sha-a (str "sha256:" (times "a" 64)))
(def sha-b (str "sha256:" (times "b" 64)))
(def sha-e (str "sha256:" (times "e" 64)))
(def hmac (str "hmac-sha256:" (times "c" 64)))
(def order-cid (str "b" (times "a" 58)))
(def output-cid (str "b" (times "d" 58)))
(def head-cid (str "b" (times "e" 58)))

(def model {"revision" "rev-1" "digest" sha-a})
(def engine {"name" "llama.cpp" "version" "b6000" "digest" sha-e})

(def limits
  {"min-battery-percent" 50 "require-charging" true "max-thermal-status" 2
   "allow-metered" false "max-orders-per-day" 20})

(def offer
  {"kind" "awai.compute-offer/1" "work-kind" "compute" "provider" provider "node" node
   "asset" "native/engi/EN" "amount" "1" "value-class" "devnet" "model" model "engine" engine
   "max-tokens" 128 "limits" limits "expires-at" 2000000000 "nonce" "offer-1"})

(def order
  {"kind" "awai.order/1" "work-kind" "compute" "buyer" "did:key:zBuyer" "provider" provider
   "node" node "asset" "native/engi/EN" "amount" "1" "value-class" "devnet" "model" model
   "max-tokens" 64 "expires-at" 1900000000 "data-categories" ["prompt"] "policy" sha-b
   "demand" "owner-internal" "nonce" "n-1"})

(def facts
  {"now" 1800000000 "battery-percent" 80 "charging" true "thermal-status" 1 "metered" false
   "active-orders" 0 "orders-today" 3})

(def run
  {"engine" engine "input" hmac "output" output-cid "ledger-head" head-cid
   "measured" {"prompt-tokens" 12 "completion-tokens" 40 "started-at" 1800000001
               "finished-at" 1800000003}})

(def receipt
  {"kind" "awai.work-receipt/1" "work-kind" "compute" "order" order-cid "provider" provider
   "node" node "input" hmac "output" output-cid "engine" engine "model" model
   "measured" (get run "measured") "ledger-head" head-cid "demand" "owner-internal" "nonce" "n-1"})

(defn- c [f args expect] {"fn" f "args" args "expect" expect})
(defn- bad [field] {"ok" false "errors" [field]})
(defn- refuse [reason] {"admit" false "reason" reason})
(def admit {"admit" true})

(defn- admit-case [& {:keys [o state r f] :or {o offer state "offered" r order f facts}} ]
  [o state r f])

(def offer-cases
  (concat
   [(c "check-offer" [offer] {"ok" true})
    (c "check-offer" [(assoc offer "extra" 1)] (bad "offer/unknown-field"))]
   (for [[field value error] [["kind" "awai.offer/1" "offer/kind"]
                              ["work-kind" "storage" "offer/work-kind"]
                              ["provider" "zProvider" "offer/provider"]
                              ["node" "zNode" "offer/node"]
                              ["node" provider "offer/node-as-payee"]
                              ["asset" "" "offer/asset"]
                              ["amount" "0" "offer/amount"]
                              ["amount" 1 "offer/amount"]
                              ["value-class" "mainnet" "offer/value-class"]
                              ["value-class" "live" "offer/live-not-approved"]
                              ["model" {"revision" "rev-1"} "offer/model"]
                              ["engine" {"name" "llama.cpp" "version" "b6000"} "offer/engine"]
                              ["max-tokens" 0 "offer/max-tokens"]
                              ["max-tokens" true "offer/max-tokens"]
                              ["expires-at" "2000000000" "offer/expires-at"]
                              ["nonce" "" "offer/nonce"]]]
     (c "check-offer" [(assoc offer field value)] (bad error)))
   (for [[field value] [["min-battery-percent" 101] ["min-battery-percent" -1]
                        ["require-charging" "yes"] ["max-thermal-status" 7]
                        ["allow-metered" 0] ["max-orders-per-day" 0]]]
     (c "check-offer" [(assoc-in offer ["limits" field] value)] (bad "offer/limits")))
   [(c "check-offer" [(update offer "limits" dissoc "allow-metered")] (bad "offer/limits"))
    (c "check-offer" [(assoc-in offer ["limits" "extra"] 1)] (bad "offer/limits"))]))

(def transition-cases
  (let [chose {"person-chose" true}
        none {}]
    [(c "offer-transition" ["draft" "publish" chose] {"state" "offered"})
     (c "offer-transition" ["draft" "publish" none] {"state" "draft" "error" "offer/person-did-not-choose"})
     (c "offer-transition" ["draft" "publish" {"person-chose" "true"}] {"state" "draft" "error" "offer/person-did-not-choose"})
     (c "offer-transition" ["offered" "pause" none] {"state" "paused"})
     (c "offer-transition" ["paused" "resume" chose] {"state" "offered"})
     (c "offer-transition" ["paused" "resume" none] {"state" "paused" "error" "offer/person-did-not-choose"})
     (c "offer-transition" ["draft" "withdraw" none] {"state" "withdrawn"})
     (c "offer-transition" ["offered" "withdraw" none] {"state" "withdrawn"})
     (c "offer-transition" ["paused" "withdraw" none] {"state" "withdrawn"})
     (c "offer-transition" ["offered" "expire" none] {"state" "expired"})
     (c "offer-transition" ["withdrawn" "publish" chose] {"state" "withdrawn" "error" "offer/not-allowed"})
     (c "offer-transition" ["expired" "resume" chose] {"state" "expired" "error" "offer/not-allowed"})
     (c "offer-transition" ["offered" "publish" chose] {"state" "offered" "error" "offer/not-allowed"})
     (c "offer-transition" ["draft" "pause" none] {"state" "draft" "error" "offer/not-allowed"})
     (c "offer-transition" ["running" "pause" none] {"state" "running" "error" "offer/unknown-state"})]))

(def admit-cases
  (concat
   [(c "admit-order" (admit-case) admit)
    (c "admit-order" (admit-case :o (assoc offer "value-class" "live")) (refuse "device/offer-invalid"))
    (c "admit-order" (admit-case :r (assoc order "value-class" "live")) (refuse "device/order-invalid"))
    (c "admit-order" (admit-case :state "paused") (refuse "device/not-offered"))
    (c "admit-order" (admit-case :state "withdrawn") (refuse "device/not-offered"))
    (c "admit-order" (admit-case :state "draft") (refuse "device/not-offered"))
    (c "admit-order" (admit-case :r (assoc order "provider" "did:key:zOther")) (refuse "device/other-provider"))
    (c "admit-order" (admit-case :r (assoc order "node" "did:key:zOtherNode")) (refuse "device/other-node"))
    (c "admit-order" (admit-case :r (assoc order "asset" "native/kumo")) (refuse "device/other-asset"))
    (c "admit-order" (admit-case :r (assoc order "amount" "2")) (refuse "device/other-amount"))
    (c "admit-order" (admit-case :r (assoc order "amount" "01")) admit)
    (c "admit-order" (admit-case :r (assoc order "value-class" "simulation")) (refuse "device/other-value-class"))
    (c "admit-order" (admit-case :r (assoc order "model" {"revision" "rev-2" "digest" sha-a})) (refuse "device/other-model"))
    (c "admit-order" (admit-case :r (assoc order "max-tokens" 129)) (refuse "device/too-many-tokens"))
    (c "admit-order" (admit-case :r (assoc order "max-tokens" 128)) admit)]
   (for [[field value reason] [["now" nil "device/unknown-time"]
                               ["now" "1800000000" "device/unknown-time"]
                               ["battery-percent" nil "device/unknown-battery"]
                               ["battery-percent" 101 "device/unknown-battery"]
                               ["battery-percent" true "device/unknown-battery"]
                               ["charging" nil "device/unknown-charging"]
                               ["charging" 1 "device/unknown-charging"]
                               ["thermal-status" nil "device/unknown-thermal"]
                               ["thermal-status" 7 "device/unknown-thermal"]
                               ["metered" nil "device/unknown-network"]
                               ["active-orders" nil "device/unknown-active-orders"]
                               ["active-orders" -1 "device/unknown-active-orders"]
                               ["orders-today" nil "device/unknown-orders-today"]]]
     (c "admit-order" (admit-case :f (if (nil? value) (dissoc facts field) (assoc facts field value)))
        (refuse reason)))
   [(c "admit-order" (admit-case :f "facts") (refuse "device/unknown-facts"))
    (c "admit-order" (admit-case :o (assoc offer "expires-at" 1800000000)) (refuse "device/offer-expired"))
    (c "admit-order" (admit-case :f (assoc facts "now" 1900000000)) (refuse "device/order-expired"))
    (c "admit-order" (admit-case :f (assoc facts "charging" false)) (refuse "device/not-charging"))
    (c "admit-order" (admit-case :o (assoc-in offer ["limits" "require-charging"] false)
                                 :f (assoc facts "charging" false)) admit)
    (c "admit-order" (admit-case :f (assoc facts "battery-percent" 49)) (refuse "device/low-battery"))
    (c "admit-order" (admit-case :f (assoc facts "battery-percent" 50)) admit)
    (c "admit-order" (admit-case :f (assoc facts "thermal-status" 3)) (refuse "device/too-hot"))
    (c "admit-order" (admit-case :f (assoc facts "thermal-status" 2)) admit)
    (c "admit-order" (admit-case :f (assoc facts "metered" true)) (refuse "device/metered-network"))
    (c "admit-order" (admit-case :o (assoc-in offer ["limits" "allow-metered"] true)
                                 :f (assoc facts "metered" true)) admit)
    (c "admit-order" (admit-case :f (assoc facts "active-orders" 1)) (refuse "device/busy"))
    (c "admit-order" (admit-case :f (assoc facts "orders-today" 20)) (refuse "device/daily-cap"))
    (c "admit-order" (admit-case :f (assoc facts "orders-today" 19)) admit)
    ;; Several problems at once: the first in the fixed order is named.
    (c "admit-order" (admit-case :r (assoc order "amount" "2")
                                 :f (assoc facts "battery-percent" 10 "metered" true))
       (refuse "device/other-amount"))
    (c "admit-order" (admit-case :f (assoc facts "battery-percent" 10 "thermal-status" 5))
       (refuse "device/low-battery"))]))

(def receipt-cases
  [(c "receipt-body" [offer order order-cid run] {"ok" true "receipt" receipt})
   (c "receipt-body" [offer order order-cid (assoc run "engine" (assoc engine "digest" sha-b))]
      {"ok" false "error" "receipt/other-engine"})
   (c "receipt-body" [offer order order-cid (assoc-in run ["measured" "completion-tokens"] 65)]
      {"ok" false "error" "receipt/over-max-tokens"})
   (c "receipt-body" [offer order order-cid (assoc-in run ["measured" "completion-tokens"] 64)]
      {"ok" true "receipt" (assoc-in receipt ["measured" "completion-tokens"] 64)})
   (c "receipt-body" [offer order order-cid (dissoc run "measured")] {"ok" false "error" "receipt/measured"})
   (c "receipt-body" [offer order order-cid "run"] {"ok" false "error" "receipt/unknown-run"})
   ;; The body, once the host adds its signer and signature, passes the verifier's check.
   (c "receipt-roundtrip" [offer order order-cid run] {"ok" true})
   (c "receipt-roundtrip" [offer order order-cid (assoc run "input" (str "sha256:" (times "c" 64)))]
      {"ok" false "errors" ["receipt/input"]})])

(def cases (vec (concat offer-cases transition-cases admit-cases receipt-cases)))

(spit "test/device_cases.json"
      (str "[\n" (str/join ",\n" (map json/generate-string cases)) "\n]\n"))
(println "wrote" (count cases) "cases")
