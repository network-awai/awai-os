(ns otehon-c1.reliability-test
  (:require [clojure.test :refer [deftest is run-tests]] [awai.fs.reliability :as r]))
(def at "2026-11-12T01:00:00Z")
(def data {:rootCid "bafyreibmkwfu2zj3s5l56ahflfwz7rn3w5g6gt4duxzcqnwraiff6a7owa"
           :carSha (apply str (repeat 64 "a")) :payloadSha (apply str (repeat 64 "b")) :bytes 131109})
(def evidence {:schema r/schema :scope "public-fixture-host-storage" :expectedNodes ["a" "b"]
               :dataset data :observedAt at :observations (mapv #(merge data {:node % :status "read" :degraded false}) ["a" "b"])
               :historicalTests {:observedAt at :corruptCloneRefused true :stagedArchiveRestore true}})
(def now (+ 1000 (r/timestamp-ms at)))
(deftest counts-are-not-a-reliability-probability
  (let [s (r/summary (assoc evidence :production {:availability-percent 99.999}) now)]
    (is (= 2 (get-in s [:metrics 0 :value])))
    (is (= 1 (:age-seconds s)))
    (is (every? nil? (vals (:production s))))))
(deftest missing-future-and-mismatch-remain-explicit
  (is (nil? (get-in (r/summary (assoc evidence :observations []) now) [:metrics 0 :value])))
  (is (= 1 (get-in (r/summary (assoc evidence :observations [(first (:observations evidence))]) now) [:metrics 0 :unknown])))
  (is (nil? (get-in (r/summary evidence (dec (r/timestamp-ms at))) [:metrics 0 :value])))
  (is (= "mismatch" (get-in (r/summary (assoc-in evidence [:observations 0 :payloadSha] "bad") now) [:nodes 0 :state])))
  (is (false? (:valid? (r/summary (update evidence :observations conj (first (:observations evidence))) now)))))
(deftest absent-tests-are-not-zero-successes
  (is (nil? (get-in (r/summary (dissoc evidence :historicalTests) now) [:metrics 1 :value])))
  (is (= 0 (get-in (r/summary (assoc-in evidence [:historicalTests :corruptCloneRefused] false) now) [:metrics 1 :value]))))
(let [result (run-tests)] (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
