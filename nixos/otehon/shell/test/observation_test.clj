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
(def readiness {:schema o/readiness-schema :scope "public-readiness-only" :allOriginalJobsActivated false
 :observedAt "2026-11-12T03:00:00Z" :serviceLoaded true :invocation "launchd"
 :jobs [{:botId "profile:rule-kaizen" :name "rule-kaizen" :jobId "readiness" :issueId "AWAI-755" :worker "jun-control"
         :scope "public-readiness-only" :originalJobState "held-unported-effects" :configuredEnabled true
         :intervalMinutes 1440 :state "waiting" :lastRun {:provider "meta" :model "muse-spark-1.3" :runId "run"
          :museRunId "model-run" :state "completed" :completedAt "2026-11-12T03:00:00Z" :linearResultConfirmed true
          :inputTokens 20227 :outputTokens 792 :reasoningTokens 336 :rawCachedTokens 0}}]})
(deftest readiness-is-not-full-fleet-activation
 (let [now (inc (o/timestamp (:observedAt readiness))) s (o/readiness-summary readiness now)]
  (is (:valid? s)) (is (= 1 (:enabled s))) (is (= 1 (:completed s)))
  (is (nil? (:enabled (o/readiness-summary (assoc readiness :serviceLoaded false) now))))
  (is (not (:valid? (o/readiness-summary (assoc readiness :allOriginalJobsActivated true) now))))))
(deftest readiness-future-duplicates-and-missing-counters
 (let [now (inc (o/timestamp (:observedAt readiness)))]
  (is (not (:valid? (o/readiness-summary (update readiness :jobs conj (first (:jobs readiness))) now))))
  (is (nil? (:enabled (o/readiness-summary readiness 0))))
  (is (nil? (:completed (o/readiness-summary (assoc-in readiness [:jobs 0 :lastRun] nil) now))))
  (is (:valid? (o/readiness-summary (assoc-in readiness [:jobs 0 :lastRun :inputTokens] nil) now)))
  (is (not (:valid? (o/readiness-summary (assoc-in readiness [:jobs 0 :lastRun :inputTokens] -1) now))))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
