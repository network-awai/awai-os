(ns bot-fleet.daily-test (:require [clojure.test :refer [deftest is run-tests]] [bot-fleet.daily :as d]))
(def job {:timezone "Asia/Tokyo" :schedule {:kind "cron" :expr "46 0 * * *"}})
(deftest source-daily-phase-is-preserved-with-one-latest-catchup
 (let [now (.toEpochMilli (java.time.Instant/parse "2026-11-12T07:00:00Z")) v (d/compile-daily job now)]
  (is (= "2026-11-11T15:46:00Z" (str (java.time.Instant/ofEpochMilli (:initial-slot v)))))
  (is (= 86400000 (get-in v [:schedule :every-ms])))
  (is (= "2026-11-12T15:46:00Z" (str (java.time.Instant/ofEpochMilli (+ (:initial-slot v) 86400000)))))
  (is (<= 0 (- now (:initial-slot v)) 86399999))))
(deftest unsupported-calendar-input-never-becomes-a-default-interval
 (doseq [j [(assoc job :timezone nil) (assoc job :timezone "America/New_York")
            (assoc-in job [:schedule :expr] "* * * * *") (assoc-in job [:schedule :expr] "46 0 23 * *")
            (assoc-in job [:schedule :expr] "60 24 * * *")]]
  (is (thrown? Exception (d/compile-daily j 0)))))
(deftest exact-hourly-phase-does-not-invent-an-interval
 (let [j (assoc-in job [:schedule :expr] "11 * * * *")
       now (.toEpochMilli (java.time.Instant/parse "2026-11-13T02:03:00Z")) v (d/compile-hourly j now)]
  (is (= "2026-11-13T01:11:00Z" (str (java.time.Instant/ofEpochMilli (:initial-slot v)))))
  (is (= 3600000 (get-in v [:schedule :every-ms])))
  (is (= "2026-11-13T02:11:00Z" (str (java.time.Instant/ofEpochMilli (+ (:initial-slot v) 3600000))))))
 (doseq [expr ["* * * * *" "11 */2 * * *" "60 * * * *" "11 * * * 1"]]
  (is (thrown? Exception (d/compile-hourly (assoc-in job [:schedule :expr] expr) 0)))))
(let [v (run-tests)] (when (pos? (+ (:fail v) (:error v))) (System/exit 1)))
