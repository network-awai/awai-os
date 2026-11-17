;; Runs the shared cases on nbb (ClojureScript). usage: nbb --classpath src test/run_cases.cljs
(ns run-cases
  (:require ["node:fs" :as fs]
            [en-devnet.core :as core]))

(def functions {"run-scenario" core/run-scenario})

(defn from-json [v]
  (cond (array? v) (mapv from-json v)
        (object? v) (into {} (map (fn [k] [(keyword k) (from-json (aget v k))]) (js/Object.keys v)))
        :else v))

(defn keywordize [v]
  (cond (map? v) (into {} (map (fn [[k x]] [k (keywordize x)]) v))
        (vector? v) (mapv keywordize v)
        (and (string? v) (pos? (count v)) (= ":" (subs v 0 1))) (keyword (subs v 1))
        :else v))

(defn plain [v]
  (cond (map? v) (into {} (map (fn [[k x]] [(if (keyword? k) (name k) k) (plain x)]) v))
        (vector? v) (mapv plain v)
        :else v))

(defn enc [v]
  (cond (map? v) (into {} (map (fn [[k x]] [(if (keyword? k) (name k) k) (enc x)]) v))
        (sequential? v) (mapv enc v)
        (keyword? v) (str ":" (name v))
        :else v))

(let [cases (from-json (js/JSON.parse (fs/readFileSync "test/cases.json" "utf8")))
      failures (keep (fn [{:keys [fn args expect]}]
                       (let [got (enc (apply (get functions fn) (keywordize args)))
                             want (plain expect)]
                         (when (not= got want) (str fn " got " (pr-str got) " want " (pr-str want)))))
                     cases)]
  (doseq [f failures] (println "FAIL" f))
  (println "nbb cases" (count cases) "failures" (count failures))
  (js/process.exit (if (seq failures) 1 0)))
