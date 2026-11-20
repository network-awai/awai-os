;; Writes test/cases.json. usage: bb --classpath src:test test/gen_cases.clj
;; Expectations below are written by hand. The core is used only to build
;; inputs (signing-payload), never to compute an expected value.
(ns gen-cases
  (:require [en-devnet.core :as core]
            [cheshire.core :as json]))

(def chain "awai-en-devnet/adr0027-v3a")
(def operator "did:key:zOperator")
(def sponsor "did:key:zSponsor")
(def bot "did:key:zBot")
(def provider "did:key:zProvider")
(def node "did:key:zProviderNode")
(def params (core/adr0027-genesis chain operator sponsor bot provider))

(defn sign
  "Host-verified signatures over the exact payload. signers: dids;
  opts :unverified did, :payload-of tx for a signature over other bytes."
  ([tx signers] (sign tx signers {}))
  ([tx signers {:keys [unverified payload-of]}]
   (assoc tx :signatures
          (mapv (fn [did] {:signer did
                           :verified (not= did unverified)
                           :payload (core/signing-payload (or payload-of tx))})
                signers))))

(defn tx [m]
  (merge {:chain-id chain :value-class :devnet :fee 0 :expires-ms 2000 :demand :owner-internal
          :order nil :acceptance nil}
         m))

(def fund
  (sign (tx {:kind :funding :transfer-id "t-fund" :nonce "s1" :spender sponsor :receiver bot :amount 1})
        [sponsor bot]))

(defn settle [m]
  (let [t (tx (merge {:kind :settlement :transfer-id "t-settle" :nonce "b1" :spender bot
                      :receiver provider :amount 1 :reserved 1
                      :order "bafyOrder1" :acceptance "bafyAcceptance1"}
                     m))]
    (sign t [bot provider])))

(defn op-tx [t] {:op :transfer :tx t :now-ms 1000})

(def funded-balances [[bot 1] [provider 0] [sponsor -1]])
(def fund-journal [["t-fund" sponsor :credit-extended 1] ["t-fund" bot :credit-received 1]])
(def zero-earned {:value-class :devnet :external-earned-en 0 :owner-internal-excluded 0})
(def finalized-fund {:finalized true :transfer-id "t-fund" :height 1 :finality :single-operator-devnet})
(def genesis-ok {:ok true :chain-id chain :finality :single-operator-devnet})

(defn after-fund-refusal
  "Fund, then one refused transfer: the ledger stays at height 1."
  [name t cause]
  {:name name
   :fn "run-scenario"
   :args [params [(op-tx fund) (op-tx t)]]
   :expect {:genesis genesis-ok
            :results [finalized-fund {:refused true :cause cause :transfer-id (:transfer-id t)}]
            :final {:height 1 :balances funded-balances :net-zero true
                    :journal fund-journal :earned zero-earned}}})

(defn genesis-refusal [name p cause]
  {:name name :fn "run-scenario" :args [p []] :expect {:genesis {:refused true :cause cause}}})

(def settled (settle {}))

(def happy
  {:name "fund, settle, read back, reconcile"
   :fn "run-scenario"
   :args [params [(op-tx fund)
                  (op-tx settled)
                  {:op :balance :did provider}
                  {:op :balance :did node}
                  {:op :reconcile :signer [{:transfer-id "t-settle" :amount 1 :state :finalized}]}]]
   :expect {:genesis genesis-ok
            :results [finalized-fund
                      {:finalized true :transfer-id "t-settle" :height 2 :finality :single-operator-devnet}
                      {:known? true :balance 1 :floor 0 :value-class :devnet}
                      {:known? false}
                      {:match true :count 1 :height 2}]
            :final {:height 2
                    :balances [[bot 0] [provider 1] [sponsor -1]]
                    :net-zero true
                    :journal (into fund-journal
                                   [["t-settle" bot :provider-expense 1]
                                    ["t-settle" provider :earned-en 1]])
                    :earned {:value-class :devnet :external-earned-en 0 :owner-internal-excluded 1}}}})

(defn reconcile-case [name signer tamper cause]
  {:name name
   :fn "run-scenario"
   :args [params [(op-tx fund) (op-tx settled)
                  (cond-> {:op :reconcile :signer signer} tamper (assoc :tamper tamper))]]
   :expect {:genesis genesis-ok
            :results [finalized-fund
                      {:finalized true :transfer-id "t-settle" :height 2 :finality :single-operator-devnet}
                      {:cause cause :transfer-id (if (= cause :missing-on-ledger) "t-ghost" "t-settle") :stop true}]
            :final {:height 2
                    :balances [[bot 0] [provider 1] [sponsor -1]]
                    :net-zero true
                    :journal (into fund-journal
                                   [["t-settle" bot :provider-expense 1]
                                    ["t-settle" provider :earned-en 1]])
                    :earned {:value-class :devnet :external-earned-en 0 :owner-internal-excluded 1}}}})

(def sponsor-floor
  (let [f2 (sign (tx {:kind :funding :transfer-id "t-fund2" :nonce "s2" :spender sponsor :receiver bot :amount 1}) [sponsor bot])
        f3 (sign (tx {:kind :funding :transfer-id "t-fund3" :nonce "s3" :spender sponsor :receiver bot :amount 1}) [sponsor bot])]
    {:name "sponsor floor -2 admits two units and refuses the third"
     :fn "run-scenario"
     :args [params [(op-tx fund) (op-tx f2) (op-tx f3)]]
     :expect {:genesis genesis-ok
              :results [finalized-fund
                        {:finalized true :transfer-id "t-fund2" :height 2 :finality :single-operator-devnet}
                        {:refused true :cause :below-floor :transfer-id "t-fund3"}]
              :final {:height 2 :balances [[bot 2] [provider 0] [sponsor -2]] :net-zero true
                      :journal (into fund-journal [["t-fund2" sponsor :credit-extended 1]
                                                   ["t-fund2" bot :credit-received 1]])
                      :earned zero-earned}}}))

(def unfunded
  {:name "bot cannot pay before it is funded (floor 0)"
   :fn "run-scenario"
   :args [params [(op-tx settled)]]
   :expect {:genesis genesis-ok
            :results [{:refused true :cause :below-floor :transfer-id "t-settle"}]
            :final {:height 0 :balances [[bot 0] [provider 0] [sponsor 0]] :net-zero true
                    :journal [] :earned zero-earned}}})

(def replay-after-finality
  {:name "the same signed settlement twice finalizes once"
   :fn "run-scenario"
   :args [params [(op-tx fund) (op-tx settled) (op-tx settled)]]
   :expect {:genesis genesis-ok
            :results [finalized-fund
                      {:finalized true :transfer-id "t-settle" :height 2 :finality :single-operator-devnet}
                      {:refused true :cause :duplicate-nonce :transfer-id "t-settle"}]
            :final {:height 2 :balances [[bot 0] [provider 1] [sponsor -1]] :net-zero true
                    :journal (into fund-journal [["t-settle" bot :provider-expense 1]
                                                 ["t-settle" provider :earned-en 1]])
                    :earned {:value-class :devnet :external-earned-en 0 :owner-internal-excluded 1}}}})

(def cases
  (concat
   [happy sponsor-floor unfunded replay-after-finality
    (genesis-refusal "genesis refuses a non-devnet value class" (assoc params :value-class :live) :not-devnet)
    (genesis-refusal "genesis refuses a chain id outside the devnet prefix" (assoc params :chain-id "awai-l1") :bad-chain-id)
    (genesis-refusal "genesis refuses the bare prefix" (assoc params :chain-id "awai-en-devnet/") :bad-chain-id)
    (genesis-refusal "genesis refuses a non-zero fee cap" (assoc params :fee-cap 1) :bad-fee-cap)
    (genesis-refusal "genesis refuses a positive opening balance"
                     (assoc-in params [:accounts 1 :opening-balance] 1) :opening-balance-refused)
    (genesis-refusal "genesis refuses a positive floor" (assoc-in params [:accounts 1 :floor] 1) :bad-floor)
    (genesis-refusal "genesis refuses a duplicate account"
                     (assoc-in params [:accounts 2 :did] bot) :duplicate-account)
    (genesis-refusal "genesis refuses an unknown role" (assoc-in params [:accounts 2 :role] :node) :bad-role)]
   [(after-fund-refusal "wrong chain id" (settle {:chain-id "awai-en-devnet/other"}) :wrong-chain)
    (after-fund-refusal "live value class" (settle {:value-class :live}) :not-devnet)
    (after-fund-refusal "unknown kind" (settle {:kind :mint}) :bad-kind)
    (after-fund-refusal "zero amount" (settle {:amount 0}) :bad-amount)
    (after-fund-refusal "non-integer amount" (settle {:amount "1"}) :bad-amount)
    (after-fund-refusal "fee above cap 0" (settle {:fee 1}) :fee-over-cap)
    (after-fund-refusal "self transfer" (settle {:receiver bot}) :self-transfer)
    (after-fund-refusal "node id as receiver" (settle {:receiver node}) :unknown-account)
    (after-fund-refusal "receiver outside the allowlist" (settle {:receiver sponsor}) :receiver-not-allowlisted)
    (after-fund-refusal "expired at now" (settle {:expires-ms 1000}) :expired)
    (after-fund-refusal "a nonce is per spender; the floor still applies" (settle {:nonce "s1" :amount 2 :reserved 2}) :below-floor)
    (after-fund-refusal "duplicate transfer id" (settle {:transfer-id "t-fund"}) :duplicate-transfer)
    (after-fund-refusal "settlement without acceptance" (settle {:acceptance nil}) :missing-acceptance)
    (after-fund-refusal "settlement without reservation" (settle {:reserved nil}) :missing-reservation)
    (after-fund-refusal "amount above reservation" (settle {:amount 2 :reserved 1}) :over-reservation)
    (after-fund-refusal "provider signature missing (one-sided binding)"
                        (sign (tx (dissoc settled :signatures)) [bot]) :missing-receiver-signature)
    (after-fund-refusal "spender signature missing"
                        (sign (tx (dissoc settled :signatures)) [provider]) :missing-spender-signature)
    (after-fund-refusal "node signature in place of operator"
                        (sign (tx (dissoc settled :signatures)) [bot provider node]) :foreign-signature)
    (after-fund-refusal "signature the host could not verify"
                        (sign (tx (dissoc settled :signatures)) [bot provider] {:unverified provider}) :unverified-signature)
    (after-fund-refusal "signature over a different amount"
                        (sign (tx (dissoc settled :signatures)) [bot provider]
                              {:payload-of (assoc settled :amount 2)}) :payload-mismatch)
    (reconcile-case "signer finality missing on the ledger stops"
                    [{:transfer-id "t-settle" :amount 1 :state :finalized}
                     {:transfer-id "t-ghost" :amount 1 :state :finalized}] nil :missing-on-ledger)
    (reconcile-case "amount disagreement stops" [{:transfer-id "t-settle" :amount 2 :state :finalized}] nil :amount-mismatch)
    (reconcile-case "a dropped journal entry stops"
                    [{:transfer-id "t-settle" :amount 1 :state :finalized}] {:drop-transfer-id "t-settle"} :journal-mismatch)
    (reconcile-case "a settlement the signer never saw stops" [] nil :unexpected-on-ledger)]
   [{:name "journal entry without a ledger transfer stops"
     :fn "run-scenario"
     :args [params [(op-tx fund) (op-tx settled)
                    {:op :reconcile :signer [{:transfer-id "t-settle" :amount 1 :state :finalized}]
                     :tamper {:add {:transfer-id "t-extra" :account provider :entry :earned-en :amount 1}}}]]
     :expect (-> (:expect replay-after-finality)
                 (assoc :results [finalized-fund
                                  {:finalized true :transfer-id "t-settle" :height 2 :finality :single-operator-devnet}
                                  {:cause :journal-without-ledger :transfer-id "t-extra" :stop true}]))}]))

(defn enc [value]
  (cond (map? value) (into {} (map (fn [[k v]] [(if (keyword? k) (name k) k) (enc v)]) value))
        (sequential? value) (mapv enc value)
        (keyword? value) (str ":" (name value))
        :else value))

(spit "test/cases.json" (str (json/generate-string (enc (vec cases)) {:pretty true}) "\n"))
(println "wrote" (count cases) "cases")
