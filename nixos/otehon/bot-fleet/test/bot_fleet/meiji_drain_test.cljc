(require '[clojure.test :refer [deftest is run-tests]]
         '[clojure.edn :as edn] '[meiji.fleet-drain :as drain])
(def original {:vm-executor "awai-vm-physics-v1" :nodes ["vm-levi" "vm-benjamin"]
               :job-id "same-original-job" :schedule {:every-ms 86400000}})
(def cursor {:state "completed" :slot 123})
(def entries [{:key "en" :cursor-key "cursor" :old original :cursor cursor}])
(defn fixture []
  (let [state (atom {"en" original "cursor" cursor}) writes (atom 0)]
    {:state state :writes writes
     :client {:read #(get @state %)
              :transact (fn [{:keys [compare put]}]
                          (swap! writes inc)
                          (let [matches (every? (fn [[key value]] (= (get @state key) (when value (edn/read-string value)))) compare)]
                            (when matches (swap! state merge (into {} (map (fn [[key value]] [key (edn/read-string value)]) put))))
                            {:succeeded matches}))}}))
(deftest pause-and-restore-original-without-new-slot
  (let [{:keys [client state writes]} (fixture)]
    (is (= "held" (:state (first (drain/apply-plan! client entries "pin" false)))))
    (is (= [] (get-in @state ["en" :nodes])))
    (is (= (:schedule original) (get-in @state ["en" :schedule])))
    (is (= "already-applied" (:state (first (drain/apply-plan! client entries "pin" false)))))
    (is (= 1 @writes))
    (is (= "restored" (:state (first (drain/apply-plan! client entries "pin" true)))))
    (is (= original (get @state "en")))
    (is (= cursor (get @state "cursor")))))
(deftest uncertain-and-raced-admission-never-paused
  (let [{:keys [client state writes]} (fixture)]
    (swap! state assoc "cursor" {:state "admitted" :slot 456})
    (is (thrown? Exception (drain/apply-plan! client entries "pin" false)))
    (is (zero? @writes))
    (is (= original (get @state "en"))))
  (let [{:keys [client state]} (fixture)
        raced (assoc client :transact (fn [transaction]
                                       (swap! state assoc "cursor" {:state "admitted" :slot 456})
                                       ((:transact client) transaction)))]
    (is (thrown? Exception (drain/apply-plan! raced entries "pin" false)))
    (is (= original (get @state "en")))))
(let [result (run-tests)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
