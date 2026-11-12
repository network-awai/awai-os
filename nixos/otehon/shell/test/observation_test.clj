(ns awai.bot.observation-test
 (:require [clojure.test :refer [deftest is run-tests]] [awai.bot.observation :as o]))
(def data {:schema o/schema :scope "public-integration-and-control-plane" :fleetCronActivated false
 :observedAt "2026-11-12T03:00:00Z" :nodes [{:node "levi" :status "healthy"} {:node "benjamin" :status "unobserved"}]
 :runs [{:runId "a" :museRunId "01a1cdce-1ff8-7b11-87db-f20cc4324df8" :model "muse-spark-1.3" :node "jun-control"
         :issueId "AWAI-2795" :provider "meta" :state "completed" :catalogMember false}]
 :recovery {:completed true :invoked false} :quorumLoss {:state "unknown" :modelCallbacks 0}})
(deftest facts-never-become-fleet-uptime
 (let [s (o/summary data (inc (o/timestamp (:observedAt data))))]
  (is (= 1 (:healthy s))) (is (= 1 (:completed s)))
  (is (= "unknown" (:fleetRunning s))) (is (:recoveryNoReinvoke s))))
(deftest future-and-duplicate-receipts-refuse-confidence
 (is (nil? (:healthy (o/summary data (dec (o/timestamp (:observedAt data)))))))
 (is (not (:valid? (o/summary (update data :nodes conj (first (:nodes data))) 0))))
 (is (not (:valid? (o/summary (update data :runs conj (first (:runs data))) 0))))
 (is (not (:valid? (o/summary (assoc data :fleetCronActivated true) 0)))))
(deftest missing-is-distinct-from-observed-failure
 (let [now (inc (o/timestamp (:observedAt data)))]
  (is (nil? (:healthy (o/summary (assoc data :nodes [{:node "levi" :status "unobserved"}]) now))))
  (is (nil? (:recoveryNoReinvoke (o/summary (dissoc data :recovery) now))))
  (is (false? (:recoveryNoReinvoke (o/summary (assoc-in data [:recovery :invoked] true) now))))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
