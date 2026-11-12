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
    (is (= {:admit true :key "k1" :superseded false} decision))
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
    (is (= {:admit true :key "k1" :superseded true} decision))
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

(let [result (run-tests)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
