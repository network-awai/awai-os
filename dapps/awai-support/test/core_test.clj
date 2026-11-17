;; AWAI-3169: awai-support core against the EN devnet ledger core.
;; bb --classpath src:../en-devnet/src test/core_test.clj
(require '[clojure.test :refer [deftest is testing run-tests]]
         '[awai-support.core :as s]
         '[en-devnet.core :as en])

(def chain "awai-en-devnet/awai-3169-test")
(def operator "did:key:zOperator")
(def sponsor "did:key:zSponsor")
(def bot "did:key:zAwaiSupportBot")
(def provider "did:key:zProvider")
(def now 1000)

(defn ledger []
  (:ledger (en/genesis (en/adr0027-genesis chain operator sponsor bot provider))))

(def request {:route :en-devnet :chain-id chain :sponsor sponsor :bot bot
              :amount 1 :transfer-id "support-1" :expires-ms 600000})

(defn signed
  "Both parties' signatures as the host reports them after verifying
  Ed25519 over the signing payload."
  [tx]
  (let [tx (assoc tx :nonce "n-1")
        payload (en/signing-payload tx)]
    (assoc tx :signatures [{:signer (:spender tx) :verified true :payload payload}
                           {:signer (:receiver tx) :verified true :payload payload}])))

(deftest card-shows-recipient-and-devnet
  (let [card (s/consent-card request)]
    (is (= "Awai Network LLC" (get-in card [:recipient :legal-name])))
    (is (= :support (:wording card)))
    (is (= :devnet (:value-class card)))
    (is (some #{:not-tax-deductible} (:notices card)))
    (is (= 1 (:amount card)))))

(deftest only-the-devnet-route-is-open
  (doseq [route [:crypto :card :compute]]
    (is (= :route-unavailable (:cause (s/consent-card (assoc request :route route))))))
  (is (= :unknown-route (:cause (s/consent-card (assoc request :route :cash))))))

(deftest approved-support-finalizes-and-reads-back
  (let [card (s/consent-card request)
        d (s/decide card {:approved true :card card} now)
        l0 (ledger)
        before (en/balance l0 bot)
        [l1 decision] (en/apply-transfer l0 (signed (:funding d)) now)
        r (s/receipt card {:decision decision :before before
                           :after (en/balance l1 bot) :journal (en/journal l1)})]
    (is (:send? d))
    (is (:finalized decision))
    (is (:received r))
    (is (= "Awai Network LLC" (get-in r [:recipient :legal-name])))
    (is (= :single-operator-devnet (:finality r)))
    (is (en/net-zero? l1))))

(deftest nothing-is-sent-without-approval-of-this-card
  (let [card (s/consent-card request)]
    (testing "denied"
      (is (= {:send? false :cause :denied} (s/decide card {:approved false :card card} now))))
    (testing "no answer"
      (is (= :no-answer (:cause (s/decide card nil now)))))
    (testing "approval of a different amount"
      (is (= :card-mismatch
             (:cause (s/decide card {:approved true :card (assoc card :amount 2)} now)))))
    (testing "approval of a different recipient bot"
      (is (= :card-mismatch
             (:cause (s/decide card {:approved true :card (assoc card :bot provider)} now)))))
    (testing "expired card"
      (is (= :expired (:cause (s/decide card {:approved true :card card} 600000)))))
    (testing "a refused card cannot be approved"
      (let [bad (s/consent-card (assoc request :amount 0))]
        (is (= :bad-amount (:cause (s/decide bad {:approved true :card bad} now))))))))

(deftest the-ledger-still-decides
  (let [card (s/consent-card (assoc request :amount 3))
        d (s/decide card {:approved true :card card} now)
        [l decision] (en/apply-transfer (ledger) (signed (:funding d)) now)]
    (testing "an approved card over the sponsor's credit floor is refused by the ledger"
      (is (:send? d))
      (is (= :below-floor (:cause decision)))
      (is (= 0 (:height l))))))

(deftest receipt-does-not-trust-a-bad-readback
  (let [card (s/consent-card request)
        d (s/decide card {:approved true :card card} now)
        l0 (ledger)
        [l1 decision] (en/apply-transfer l0 (signed (:funding d)) now)
        good {:decision decision :before (en/balance l0 bot)
              :after (en/balance l1 bot) :journal (en/journal l1)}]
    (is (= :balance-mismatch (:cause (s/receipt card (assoc good :after (en/balance l0 bot))))))
    (is (= :journal-mismatch (:cause (s/receipt card (assoc good :journal [])))))
    (is (= :balance-unknown (:cause (s/receipt card (assoc good :after {:known? false})))))
    (is (= :not-finalized (:cause (s/receipt card (assoc good :decision {:refused true})))))))

(let [{:keys [fail error]} (run-tests)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
