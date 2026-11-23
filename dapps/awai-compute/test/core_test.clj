;; AWAI-3115: awai-compute core tests. Mirrors the awai-support core tests.
;; bb --classpath src:../en-devnet/src test/core_test.clj
(require '[clojure.test :refer [deftest is testing run-tests]]
         '[awai-compute.core :as c]
         '[en-devnet.core :as en])

(def chain "awai-en-devnet/awai-3115-test")
(def operator "did:key:zOperator")
(def sponsor "did:key:zSponsor")
(def bot "did:key:zBot")
(def provider "did:key:zComputeProvider")
(def now 1000)

(defn ledger []
  (:ledger (en/genesis (en/adr0027-genesis chain operator sponsor bot provider))))

(defn funded
  "The sponsor funds the bot first (the support path): the bot has a 0
  floor, so it cannot fund a compute order until its balance is 1."
  [ledger]
  (let [tx {:chain-id chain :value-class :devnet :kind :funding
            :transfer-id "support-fund-01"
            :spender sponsor :receiver bot :amount 1 :fee 0
            :nonce "n-fund" :expires-ms 600000}
        payload (en/signing-payload tx)
        tx (assoc tx :signatures [{:signer sponsor :verified true :payload payload}
                                  {:signer bot :verified true :payload payload}])]
    (first (en/apply-transfer ledger tx now))))

(def request {:route :en-devnet :chain-id chain :provider provider :consumer bot
              :amount c/provisional-credit-per-order
              :order-id "compute-0123456789abcdef01234567" :expires-ms 600000})

(defn signed
  "Both parties' signatures as the host reports them after verifying
  Ed25519 over the signing payload."
  [tx]
  (let [tx (assoc tx :nonce "n-1")
        payload (en/signing-payload tx)]
    (assoc tx :signatures [{:signer (:spender tx) :verified true :payload payload}
                           {:signer (:receiver tx) :verified true :payload payload}])))

(deftest the-provisional-credit-is-one-in-one-place
  (let [card (c/offer-card request)]
    (is (= 1 c/provisional-credit-per-order))
    (is (= 1 (:amount card)))))

(deftest signed-offer-only-on-the-devnet-route
  (let [card (c/offer-card request)]
    (is (= :provide (:wording card)))
    (is (= :devnet (:value-class card)))
    (is (= c/provisional-credit-per-order (:amount card))))
  (is (= :route-unavailable (:cause (c/offer-card (assoc request :route :crypto)))))
  (is (= :route-unavailable (:cause (c/offer-card (assoc request :route :card)))))
  (is (= :bad-order-id (:cause (c/offer-card (assoc request :order-id "order-1")))))
  (let [bad (c/offer-card (assoc request :amount 0))]
    (is (= :bad-amount (:cause bad)))))

(deftest approved-order-finalizes-and-reads-back
  (let [card (c/offer-card request)
        c (c/decide card {:approved true :card card} now)
        l0 (funded (ledger))
        before (en/balance l0 provider)
        [l1 decision] (en/apply-transfer l0 (signed (:funding c)) now)
        r (c/receipt card {:decision decision :before before
                           :after (en/balance l1 provider) :journal (en/journal l1)})]
    (is (:order? c))
    (is (:finalized decision))
    (is (:received r))
    (is (= provider (:provider r)))
    (is (= 1 (:amount r)))
    (is (= :single-operator-devnet (:finality r)))
    (is (en/net-zero? l1))))

(deftest nothing-is-sent-without-acceptance-of-this-card
  (let [card (c/offer-card request)]
    (testing "denied"
      (is (= {:order? false :cause :denied} (c/decide card {:approved false :card card} now))))
    (testing "no answer"
      (is (= :no-answer (:cause (c/decide card nil now)))))
    (testing "approval of a different amount"
      (is (= :card-mismatch
             (:cause (c/decide card {:approved true :card (assoc card :amount 2)} now)))))
    (testing "approval of a different provider"
      (is (= :card-mismatch
             (:cause (c/decide card {:approved true :card (assoc card :provider bot)} now)))))
    (testing "expired card"
      (is (= :expired (:cause (c/decide card {:approved true :card card} 600000)))))))

(deftest the-ledger-still-decides
  (let [card (c/offer-card (assoc request :amount 3))
        c (c/decide card {:approved true :card card} now)
        [l decision] (en/apply-transfer (ledger) (signed (:funding c)) now)]
    (testing "an accepted card over the consumer's credit floor is refused by the ledger"
      (is (:order? c))
      (is (= :below-floor (:cause decision)))
      (is (= 0 (:height l))))))

(deftest an-offer-lives-at-most-24h
  (testing "ADR 0051 D5: the offer lifetime cap"
    (let [day c/longest-offer-ms
          at (fn [exp] (c/decide (c/offer-card (assoc request :expires-ms exp))
                                 {:approved true :card (c/offer-card (assoc request :expires-ms exp))}
                                 now))]
      ;; Exactly 24h is accepted.
      (is (:order? (at (+ now day))))
      ;; One millisecond over is refused.
      (is (= :offer-too-long (:cause (at (+ now day 1)))))
      (is (= 86400000 day)))))
(deftest receipt-does-not-trust-a-bad-readback
  (let [card (c/offer-card request)
        c (c/decide card {:approved true :card card} now)
        l0 (funded (ledger))
        [l1 decision] (en/apply-transfer l0 (signed (:funding c)) now)
        good {:decision decision :before (en/balance l0 provider)
              :after (en/balance l1 provider) :journal (en/journal l1)}]
    (is (= :balance-mismatch (:cause (c/receipt card (assoc good :after (en/balance l0 provider))))))
    (is (= :journal-mismatch (:cause (c/receipt card (assoc good :journal [])))))
    (is (= :balance-unknown (:cause (c/receipt card (assoc good :after {:known? false})))))
    (is (= :not-finalized (:cause (c/receipt card (assoc good :decision {:refused true})))))))

(let [{:keys [fail error]} (run-tests)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
