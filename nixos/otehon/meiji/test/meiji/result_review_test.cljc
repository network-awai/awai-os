(require '[clojure.test :refer [deftest is run-tests]] '[clojure.edn :as edn]
         '[meiji.result-review :as review] '[itonami.otehon.recurring-host :as durable])
;; Canonical encoding rather than pr-str is required in CAS comparisons.
(defn canonical-ledger []
  (let [raw (atom {})]
    {:authenticated-node "review-owner" :read #(some-> (get @raw %) edn/read-string)
     :transact (fn [{:keys [compare put]}]
                 (locking raw
                   (if (every? (fn [[k v]] (= v (get @raw k))) compare)
                     (do (swap! raw merge put) {:succeeded true}) {:succeeded false})))}))
(defn config []
  (let [root (str ".agent-output/review-test-" (random-uuid))]
    (durable/private-dir! root) {:state-root root}))
(deftest uncertain-inference-never-replays
  (let [cfg (config) client (canonical-ledger) calls (atom 0)
        invoke (fn [_] (swap! calls inc) (throw (ex-info "lost terminal" {})))]
    (is (thrown? Exception (review/once! cfg client {:public "a"} invoke)))
    (is (= "unknown" (:state (review/once! cfg client {:public "a"} invoke))))
    (is (= 1 @calls))))
(deftest completed-input-is-reused-without-new-model-call
  (let [cfg (config) client (canonical-ledger) calls (atom 0)
        invoke (fn [_] (swap! calls inc) {:text "report" :provider "kapitsa"})
        first (review/once! cfg client {:public "b"} invoke)]
    (is (= "completed" (:state first)))
    (is (= first (review/once! cfg client {:public "b"} invoke)))
    (is (= 1 @calls))))
(deftest uncertain-admission-never-calls-model
  (let [cfg (config) calls (atom 0)]
    (is (thrown? Exception
          (review/once! cfg {:authenticated-node "review-owner" :read (constantly nil)
                            :transact (fn [_] {:succeeded false})}
                        {} (fn [_] (swap! calls inc)))))
    (is (zero? @calls))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
