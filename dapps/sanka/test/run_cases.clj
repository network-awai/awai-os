;; Runs the shared cases on Babashka. usage: bb --classpath src:test test/run_cases.clj
(ns run-cases
  (:require [cheshire.core :as json]
            [sanka.runner :as runner]))

(defn- read-json [path]
  (json/parse-string (slurp path) true))

(let [{:keys [failures checks]} (runner/run (read-json "test/cases.json")
                                            (read-json "test/scenarios.json"))]
  (doseq [failure failures] (println "FAIL" failure))
  (println "babashka checks" checks "failures" (count failures))
  (System/exit (if (seq failures) 1 0)))
