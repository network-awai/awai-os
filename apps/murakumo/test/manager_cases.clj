;; Shared model manager cases on Babashka. usage (from apps/murakumo):
;;   bb --classpath contracts/src test/manager_cases.clj
(ns manager-cases
  (:require [awai.inference.manager :as m]
            [cheshire.core :as json]
            [clojure.walk :as walk]))

(def functions
  {"catalog-problems" m/catalog-problems "estimate-bytes" m/estimate-bytes "budget-bytes" m/budget-bytes
   "fit" m/fit "recommend" m/recommend "usage-problems" m/usage-problems "freshness" m/freshness
   "device-view" m/device-view})

(defn plain [v] (walk/postwalk (fn [x] (if (map? x) (into {} (map (fn [[k y]] [(if (keyword? k) (name k) k) y]) x)) x)) v))

(let [cases (json/parse-string (slurp "test/manager-cases.json"))
      failures (keep (fn [{:strs [name fn args expect]}]
                       (let [got (plain (apply (get functions fn) (walk/keywordize-keys args)))]
                         (when (not= got expect) (str name ": got " (pr-str got) " want " (pr-str expect)))))
                     cases)]
  (doseq [f failures] (println "FAIL" f))
  (println "babashka manager cases" (count cases) "failures" (count failures))
  (System/exit (if (seq failures) 1 0)))
