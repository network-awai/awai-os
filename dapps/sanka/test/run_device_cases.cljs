;; Runs the device cases on ClojureScript. usage: nbb --classpath src:test test/run_device_cases.cljs
(ns run-device-cases
  (:require ["fs" :as fs]
            [sanka.device-runner :as runner]))

(let [{:keys [failures checks]} (runner/run (js->clj (js/JSON.parse (fs/readFileSync "test/device_cases.json" "utf8"))
                                                     :keywordize-keys true))]
  (doseq [failure failures] (println "FAIL" failure))
  (println "cljs device checks" checks "failures" (count failures))
  (js/process.exit (if (seq failures) 1 0)))
