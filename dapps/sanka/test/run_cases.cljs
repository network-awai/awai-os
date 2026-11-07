;; Runs the shared cases on ClojureScript. usage: nbb --classpath src:test test/run_cases.cljs
(ns run-cases
  (:require ["fs" :as fs]
            [sanka.runner :as runner]))

(defn- read-json [path]
  (js->clj (js/JSON.parse (fs/readFileSync path "utf8")) :keywordize-keys true))

(let [{:keys [failures checks]} (runner/run (read-json "test/cases.json")
                                            (read-json "test/scenarios.json"))]
  (doseq [failure failures] (println "FAIL" failure))
  (println "cljs checks" checks "failures" (count failures))
  (js/process.exit (if (seq failures) 1 0)))
