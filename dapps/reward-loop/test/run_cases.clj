;; Runs the shared cases on Babashka. usage: bb --classpath src:test test/run_cases.clj
(ns run-cases
  (:require [reward-loop.core :as core]
            [cheshire.core :as json]
            [clojure.walk :as walk]))

(def functions
  {"fresh" core/fresh
   "fund" core/fund
   "inject" core/inject
   "assign" core/assign
   "execute" core/execute
   "accept" core/accept
   "settle" core/settle
   "totals" core/totals
   "bottleneck" core/bottleneck})

(defn keywordize [value]
  (walk/postwalk
   (fn [x]
     (if (and (string? x) (> (count x) 0) (= (subs x 0 1) ":"))
       (keyword (subs x 1))
       x))
   value))

(defn plain [value]
  (walk/postwalk
   (fn [x]
     (if (and (map? x))
       (into {} (map (fn [[k v]] [(if (keyword? k) (name k) k) v]) x))
       x))
   value))

(defn enc [value]
  (cond (map? value) (into {} (map (fn [[k v]] [(if (keyword? k) (name k) k) (enc v)]) value))
        (vector? value) (mapv enc value)
        (keyword? value) (str ":" (name value))
        :else value))

(defn -main []
  (let [cases (walk/keywordize-keys (json/parse-string (slurp "test/cases.json")))
        failures (remove nil?
                         (map (fn [{:keys [fn args expect]}]
                                (let [got (enc (apply (get functions fn) (keywordize args)))
                                      want (plain expect)]
                                  (when (not= got want)
                                    (str fn " " (pr-str args) " got " (pr-str got) " want " (pr-str want)))))
                              cases))]
    (doseq [failure failures] (println "FAIL" failure))
    (println "babashka cases" (count cases) "failures" (count failures))
    (System/exit (if (seq failures) 1 0))))

(-main)
