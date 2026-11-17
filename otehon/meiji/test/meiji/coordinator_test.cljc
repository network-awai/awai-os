(require '[clojure.test :refer [deftest is run-tests]]
         '[meiji.coordinator :as coordinator] '[bot-fleet.vm-host :as worker])

(deftest one-uncertain-job-does-not-fabricate-completion-or-stop-observation
  (let [calls (atom [])
        cfg {:jobs [{:catalog-bot-id "a" :binding {:issue-id "AWAI-1"}}
                    {:catalog-bot-id "b" :binding {:issue-id "AWAI-2"}}]}
        result (with-redefs [worker/tick-job!
                             (fn [_ _ job _]
                               (swap! calls conj (:catalog-bot-id job))
                               (if (= "a" (:catalog-bot-id job))
                                 (throw (ex-info "uncertain" {})) {:state "waiting"}))]
                 (coordinator/tick! cfg {} 1000))]
    (is (= ["a" "b"] @calls))
    (is (= ["unknown" "waiting"] (mapv :state (:jobs result))))
    (is (nil? (get-in result [:jobs 0 :last-result])))
    (is (= "AWAI-1" (get-in result [:jobs 0 :issue-id])))))

(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
