(ns reservation-test
  (:require [clojure.test :refer [deftest is run-tests]]
            [d1.reservation :as r]))

(def ledger0 {})
(def now 1700000000000)
(def ttl 60000)
(def digest-a "digest-a")
(def digest-b "digest-b")
(def receipt-a {:receipt "a"})

(deftest fresh-key-admits
  (let [[ledger decision] (r/reserve ledger0 "k1" digest-a now ttl)]
    (is (= {:admit true :key "k1" :fence 0 :superseded false} decision))
    (is (= :reserved (get-in ledger [:reservations "k1" :state])))))

(deftest same-key-same-digest-replays-without-change
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 decision] (r/reserve ledger1 "k1" digest-a (+ now 1) ttl)]
    (is (= {:replay true :key "k1" :state :reserved} decision))
    (is (= ledger1 ledger2))))

(deftest same-key-different-digest-conflicts
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 decision] (r/reserve ledger1 "k1" digest-b (+ now 1) ttl)]
    (is (= {:refused true :cause :conflict :key "k1"} decision))
    (is (= ledger1 ledger2))))

(deftest in-flight-answers-retry-later
  (let [ledger1 (assoc-in ledger0 [:reservations "k1"]
                          {:digest digest-a :expires (+ now ttl)
                           :state :in-flight :fence 0 :receipt nil})
        [ledger2 decision] (r/reserve ledger1 "k1" digest-a (+ now 1) ttl)]
    (is (= {:retry-later true :key "k1"} decision))
    (is (= ledger1 ledger2))))

(deftest expired-key-refuses-and-keeps-prior-receipt
  (let [ledger1 (assoc-in ledger0 [:reservations "k1"]
                          {:digest digest-a :expires now
                           :state :completed :fence 0 :receipt receipt-a})
        [ledger2 decision] (r/reserve ledger1 "k1" digest-b (+ now 1) ttl)]
    (is (= {:admit true :key "k1" :fence 1 :superseded true} decision))
    (is (= receipt-a (get-in ledger2 [:reservations "k1" :prior-receipt])))))

(deftest settle-completes-and-replays-receipt
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 decision] (r/settle ledger1 "k1" digest-a 0 :ok receipt-a)]
    (is (= {:state :completed :key "k1" :receipt receipt-a} decision))
    (let [[ledger3 redelivery] (r/reserve ledger2 "k1" digest-a (+ now 1) ttl)]
      (is (= {:replay true :key "k1" :receipt receipt-a} redelivery))
      (is (= ledger2 ledger3)))))

(deftest settle-refuses-unknown-key-and-double-settle
  (let [[ledger1 decision] (r/settle ledger0 "missing" digest-a 0 :ok receipt-a)]
    (is (= {:refused true :cause :not-live :key "missing"} decision))
    (is (= ledger0 ledger1)))
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 _] (r/settle ledger1 "k1" digest-a 0 :ok receipt-a)
        [ledger3 decision] (r/settle ledger2 "k1" digest-a 0 :ok receipt-a)]
    (is (= {:refused true :cause :not-live :key "k1"} decision))
    (is (= ledger2 ledger3))))

(deftest fence-ratchets-upward-never-rewinds
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 decision] (r/raise-fence ledger1 "k1" 5)]
    (is (= {:fenced true :key "k1" :fence 5} decision))
    (is (= 5 (get-in ledger2 [:reservations "k1" :fence])))
    (let [[ledger3 rewound] (r/raise-fence ledger2 "k1" 5)]
      (is (= {:refused true :cause :fence-rewind :key "k1"} rewound))
      (is (= ledger2 ledger3)))
    (let [[ledger4 backdated] (r/raise-fence ledger2 "k1" 3)]
      (is (= {:refused true :cause :fence-rewind :key "k1"} backdated))
      (is (= ledger2 ledger4))))
  (let [[ledger1 missing] (r/raise-fence ledger0 "missing" 1)]
    (is (= {:refused true :cause :not-live :key "missing"} missing))
    (is (= ledger0 ledger1)))
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 _] (r/settle ledger1 "k1" digest-a 0 :ok receipt-a)
        [ledger3 frozen] (r/raise-fence ledger2 "k1" 9)]
    (is (= {:refused true :cause :not-live :key "k1"} frozen))
    (is (= ledger2 ledger3))))

(deftest raised-fence-refuses-stale-settle-and-admits-current
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 _] (r/raise-fence ledger1 "k1" 5)
        [ledger3 stale] (r/settle ledger2 "k1" digest-a 4 :ok receipt-a)]
    (is (= {:refused true :cause :stale-writer :key "k1"} stale))
    (is (= ledger2 ledger3))
    (let [[_ current] (r/settle ledger3 "k1" digest-a 5 :ok receipt-a)]
      (is (= {:state :completed :key "k1" :receipt receipt-a} current)))))

(deftest reconcile-moves-only-unknown-to-authoritative-outcome
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 _] (r/settle ledger1 "k1" digest-a 0 :unverified nil)
        [ledger3 decision] (r/reconcile ledger2 "k1" digest-a :completed receipt-a)]
    (is (= {:state :completed :key "k1" :receipt receipt-a} decision))
    (is (= :completed (get-in ledger3 [:reservations "k1" :state])))
    (let [[ledger4 replay] (r/reserve ledger3 "k1" digest-a (+ now 1) ttl)]
      (is (= {:replay true :key "k1" :receipt receipt-a} replay))
      (is (= ledger3 ledger4))))
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 _] (r/settle ledger1 "k1" digest-a 0 :unverified nil)
        [ledger3 decision] (r/reconcile ledger2 "k1" digest-a :failed receipt-a)]
    (is (= {:state :failed :key "k1"} decision))
    (is (= receipt-a (get-in ledger3 [:reservations "k1" :receipt]))))
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 _] (r/settle ledger1 "k1" digest-a 0 :unverified nil)]
    (let [[ledger3 conflict] (r/reconcile ledger2 "k1" digest-b :completed receipt-a)]
      (is (= {:refused true :cause :conflict :key "k1"} conflict))
      (is (= ledger2 ledger3)))
    (let [[ledger4 vague] (r/reconcile ledger2 "k1" digest-a :maybe receipt-a)]
      (is (= {:refused true :cause :unknown-outcome :key "k1"} vague))
      (is (= ledger2 ledger4))))
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 live] (r/reconcile ledger1 "k1" digest-a :completed receipt-a)]
    (is (= {:refused true :cause :not-unknown :key "k1"} live))
    (is (= ledger1 ledger2)))
  (let [[ledger1 missing] (r/reconcile ledger0 "gone" digest-a :completed receipt-a)]
    (is (= {:refused true :cause :not-unknown :key "gone"} missing))
    (is (= ledger0 ledger1))))

(deftest settle-refuses-digest-mismatch-and-stale-writer
  (let [ledger1 (assoc-in ledger0 [:reservations "k1"]
                          {:digest digest-a :expires (+ now ttl)
                           :state :reserved :fence 2 :receipt nil})]
    (let [[_ decision] (r/settle ledger1 "k1" digest-b 2 :ok receipt-a)]
      (is (= {:refused true :cause :conflict :key "k1"} decision)))
    (let [[ledger2 decision] (r/settle ledger1 "k1" digest-a 1 :ok receipt-a)]
      (is (= {:refused true :cause :stale-writer :key "k1"} decision))
      (is (= ledger1 ledger2)))))

(deftest unverified-effect-is-recorded-never-success
  (let [[ledger1 _] (r/reserve ledger0 "k1" digest-a now ttl)
        [ledger2 decision] (r/settle ledger1 "k1" digest-a 0 :unverified nil)]
    (is (= {:unknown true :key "k1"} decision))
    (is (= :unknown (get-in ledger2 [:reservations "k1" :state])))
    (let [[ledger3 redelivery] (r/settle ledger2 "k1" digest-a 0 :ok receipt-a)]
      (is (= {:refused true :cause :not-live :key "k1"} redelivery))
      (is (= ledger2 ledger3)))))

(deftest expired-reuse-never-resets-a-writer-fence
  (let [[a _] (r/reserve {} "k" digest-a 0 10)
        [b _] (r/raise-fence a "k" 5)
        [c d] (r/reserve b "k" digest-a 11 10)]
    (is (= 6 (:fence d)))
    (doseq [epoch [0 5 7 nil 6.0]]
      (let [[unchanged refused] (r/settle c "k" digest-a epoch :ok receipt-a)]
        (is (= :stale-writer (:cause refused)))
        (is (= c unchanged))))
    (is (= :completed (:state (second (r/settle c "k" digest-a 6 :ok receipt-a)))))))

(deftest unresolved-effects-do-not-reenter-on-expiry
  (doseq [state [:unknown :in-flight]]
    (let [a {:reservations {"k" {:digest digest-a :expires 10 :state state :fence 5}}}
          [b d] (r/reserve a "k" digest-a 11 10)]
      (is (= a b))
      (is (= {:retry-later true :key "k"} d)))))

(deftest reconciliation-is-bound-to-the-current-reservation-fence
  (let [[a _] (r/reserve {} "k" digest-a 0 10)
        [b _] (r/settle a "k" digest-a 0 :ok receipt-a)
        [c _] (r/reserve b "k" digest-a 11 10)
        [d _] (r/settle c "k" digest-a 1 :unverified nil)]
    (doseq [[unchanged refusal] [(r/reconcile d "k" digest-a :completed receipt-a)
                                 (r/reconcile d "k" digest-a 0 :completed receipt-a)
                                 (r/reconcile d "k" digest-a 2 :completed receipt-a)]]
      (is (= d unchanged))
      (is (= :stale-writer (:cause refusal))))
    (is (= :completed (:state (second (r/reconcile d "k" digest-a 1 :completed receipt-a)))))))

(let [result (run-tests)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
