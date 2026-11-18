;; Runs the device cases on Babashka. usage: bb --classpath src:test test/run_device_cases.clj
(ns run-device-cases
  (:require [cheshire.core :as json]
            [sanka.device-runner :as runner]))

(let [{:keys [failures checks]} (runner/run (json/parse-string (slurp "test/device_cases.json") true))]
  (doseq [failure failures] (println "FAIL" failure))
  (println "babashka device checks" checks "failures" (count failures))
  (System/exit (if (seq failures) 1 0)))
