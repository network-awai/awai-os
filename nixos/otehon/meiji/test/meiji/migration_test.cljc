(require '[clojure.test :refer [deftest is run-tests]]
         '[meiji.vm-migration :as migration] '[meiji.fleet-audit :as audit])

(defn held-fixture []
  {:en (into {} (for [n (range 5)]
                  [(str "/enrollment/" n) {:vm-executor "awai-vm-physics-v1" :nodes [] :meiji-recovery-hold "AWAI-2820:pin"}]))
   :cursors (into {} (for [n (range 5)] [(str "/cursor/" n) {:state "completed"}]))})
(defn allowed? [{:keys [en cursors]}]
  (with-redefs [audit/rows identity
                audit/read-prefix! (fn [_ prefix] (if (.contains prefix "enrollment") en cursors))]
    (migration/held! {} "pin") true))
(deftest only-fully-fenced-idle-fleet-can-stop
  (let [state (held-fixture)]
    (is (allowed? state))
    (doseq [bad [(assoc-in state [:en "/enrollment/0" :nodes] ["vm-benjamin"])
                 (assoc-in state [:cursors "/cursor/0" :state] "admitted")
                 (assoc-in state [:en "/enrollment/0" :meiji-recovery-hold] "other")
                 (update state :en dissoc "/enrollment/0")]]
      (is (thrown? Exception (allowed? bad))))))
(let [result (run-tests)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
