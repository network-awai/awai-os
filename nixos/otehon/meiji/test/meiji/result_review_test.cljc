(require '[clojure.test :refer [deftest is run-tests]] '[clojure.edn :as edn]
         '[meiji.result-review :as review] '[itonami.otehon.recurring-host :as durable]
         '[meiji.review-ledger :as ledger] '[itonami.otehon.occurrence :as occurrence]
         '[meiji.host :as host])
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
(deftest dedicated-ledger-cannot-write-occurrence-or-extra-keys
  (let [key (str "/awai/meiji/review/v1/" (apply str (repeat 64 "a")))]
    (is (string? (ledger/transaction-text {:compare {key nil} :put {key "{}"}})))
    (is (thrown? Exception (ledger/transaction-text {:compare {"/itonami/occurrence/v1/run/other" nil}
                                                    :put {"/itonami/occurrence/v1/run/other" "{}"}})))
    (is (thrown? Exception (ledger/transaction-text {:compare {key nil} :put {key "{}" "extra" "value"}})))))
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
(deftest explicitly-verified-pre-http-recovery-is-consumed-once
  (let [cfg (config) client (canonical-ledger) input {:public "preflight"}
        digest (occurrence/digest [review/model input]) path (str (:state-root cfg) "/proof.edn")
        _ (is (thrown? Exception (review/once! cfg client input (fn [_] (throw (ex-info "preflight" {}))))))
        _ (durable/durable! path (pr-str {:schema "meiji.verified-pre-http-failure.v1"
                                         :input-sha digest :owner-decision "AWAI-2820"
                                         :failure "missing-controller-overrides-before-tunnel"}))
        cfg (assoc cfg :verified-pre-http-recovery {:path path :sha256 (host/sha256 path)})
        calls (atom 0) invoke (fn [_] (swap! calls inc) (throw (ex-info "lost HTTP terminal" {})))]
    (is (thrown? Exception (review/once! cfg client input invoke)))
    (is (thrown? Exception (review/once! cfg client input invoke)))
    (is (= 1 @calls))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
