(ns itonami.gms.test-runner
  (:require [clojure.test :as test]
            [itonami.gms.core-test]))
(defn -main [& _]
  (let [{:keys [fail error]} (test/run-tests 'itonami.gms.core-test)]
    (when (pos? (+ fail error)) (System/exit 1))))
