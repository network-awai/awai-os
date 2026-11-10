(ns run-cases
  "Runs the shared cases on ClojureScript in Node."
  (:require ["fs" :as fs]
            [saifu.core :as core]))

(def functions
  {"valid-address?" core/valid-address?
   "hex->decimal" core/hex->decimal
   "format-units" core/format-units
   "balance-request" core/balance-request
   "balance-request-for" core/balance-request-for
   "read-balance" core/read-balance
   "operation-gate" core/operation-gate})

(defn- plain [value]
  (cond
    (map? value) (into {} (map (fn [[k v]] [(name k) (plain v)]) value))
    (vector? value) (mapv plain value)
    (keyword? value) (name value)
    :else value))

(defn ^:export main []
  (let [cases (js->clj (js/JSON.parse (fs/readFileSync "test/cases.json" "utf8")) :keywordize-keys true)
        failures (keep (fn [{:keys [args expect] :as case}]
                         (let [run (get functions (:fn case))
                               got (plain (apply run args))
                               want (plain expect)]
                           (when (not= got want)
                             (str (:fn case) " " args " got " got " want " want))))
                       cases)]
    (doseq [failure failures] (println "FAIL" failure))
    (println "cljs cases" (count cases) "failures" (count failures))
    (js/process.exit (if (seq failures) 1 0))))
