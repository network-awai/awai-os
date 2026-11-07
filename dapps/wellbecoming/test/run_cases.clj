;; Runs the shared cases on Babashka. usage: bb --classpath src test/run_cases.clj
(ns run-cases
  (:require [cheshire.core :as json]
            [wellbecoming.core :as core]))

(def functions
  {"dimension-delta" core/dimension-delta
   "direction" core/direction
   "local-index-milli" core/local-index-milli
   "assess" core/assess
   "confirm" core/confirm
   "validate-export" core/validate-export
   "export-record" core/export-record})

(defn plain [value]
  (cond
    (map? value) (into {} (map (fn [[k v]] [(name k) (plain v)]) value))
    (sequential? value) (mapv plain value)
    (keyword? value) (name value)
    :else value))

(let [cases (json/parse-string (slurp "test/cases.json") true)
      failures (remove nil?
                       (map (fn [{:keys [fn args expect note]}]
                              (let [got (plain (apply (get functions fn) args))
                                    want (plain expect)]
                                (when (not= got want)
                                  (str fn " [" note "] got " (pr-str got) " want " (pr-str want)))))
                            cases))]
  (doseq [failure failures] (println "FAIL" failure))
  (println "babashka cases" (count cases) "failures" (count failures))
  (System/exit (if (seq failures) 1 0)))
