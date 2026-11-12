(require '[clojure.test :refer [deftest is run-tests]] '[clojure.edn :as edn]
 '[bot-fleet.vm-worker :as vm] '[itonami.otehon.occurrence :as o]
 '[itonami.otehon.job-contract :as grant] '[itonami.otehon.io :as hash]
 '[itonami.otehon.physics.runner :as physics] '[itonami.otehon.recurring-host :as d] '[otehon.storage :as storage])
(defn fixture []
 (let [root (str ".agent-output/vm-worker-test-" (random-uuid))
       spec {:physics/schema "itonami.physical-ai.spec.v1" :repo "cloud-itonami/test"
             :cases [{:id :pipe :kind :pipe-flow :procedure "bounded pipe test" :params {}
                      :sweep {:param :flow-m3-s :values [0.001]} :quantity :pump-power-w
                      :limit {:max 1000000 :basis "test estimate"}}]}
       text (pr-str spec) rev (apply str (repeat 40 "a"))
       g {:schema "itonami.job-grant.v1" :owner-decision "AWAI-2795" :execution "deterministic"
          :job-kind "physical-simulation" :authority-source "operator-enrollment"
          :capabilities (grant/capabilities "physical-simulation") :operations []
          :model-tools false :mail-send false :git-merge false}
       en {:schema "itonami.occurrence-enrollment.v1" :bot-id "bot" :job-id "vm-job" :issue-id "AWAI-2820"
           :project-id "p" :initiative-id "i" :profile-cid "profile" :schedule-cid "schedule"
           :provider "none" :model "deterministic" :executor "bounded-job-v1" :grant g :grant-cid (grant/grant-cid g)
           :capabilities (:capabilities g) :data-class "job-result-metadata-only" :nodes ["vm-a" "vm-b"]
           :schedule {:type "interval" :every-ms 86400000} :initial-slot 1000
           :vm-executor "awai-vm-physics-v1" :vm-runtime-revision rev
           :vm-spec-sha (hash/sha256-utf8 text) :vm-repository (:repo spec)}
       req (merge (select-keys en [:bot-id :job-id :issue-id :project-id :initiative-id :profile-cid :schedule-cid :provider :model :executor :grant-cid])
                  {:slot 1000 :attempt-id "attempt" :run-id "vm-run" :input-sha (vm/input-sha en)})
       state (atom {(:enrollment (o/keys-for "bot" "vm-job" 1000)) en})
       transact (fn [txn]
                  (loop []
                   (let [old @state]
                    (if-not (every? (fn [[k v]] (= v (when-let [x (get old k)] (o/encode x)))) (:compare txn))
                      {:succeeded false}
                      (if (compare-and-set! state old (merge old (update-vals (:put txn) edn/read-string)))
                        {:succeeded true} (recur))))))
       cfg {:state-root root :node "vm-a" :runtime-revision rev}
       _ (d/private-dir! root) _ (storage/init! (str root "/packs"))]
  {:cfg cfg :state state :en en :req req :packet {:op "run" :request req :spec-text text}
   :client {:authenticated-node "vm-a" :read #(get @state %) :transact transact}}))
(deftest pins-and-operation-refuse-before-admission
 (let [{:keys [cfg client packet state]} (fixture) initial @state]
  (doseq [p [(assoc packet :op "shell") (assoc packet :spec-text "{}")
             (assoc packet :path "/etc/shadow") (assoc-in packet [:request :input-sha] (apply str (repeat 64 "b")))]]
   (is (thrown? Exception (vm/handle! cfg client p))))
  (is (= initial @state))
  (is (thrown? Exception (vm/read-data "{} {}")))
  (is (thrown? Exception (vm/read-data "#unsafe {}")))))
(deftest one-admitted-result-is-durable-replicable-and-not-resimulated
 (let [{:keys [cfg client packet req]} (fixture) calls (atom 0) simulate physics/simulate]
  (with-redefs [physics/simulate (fn [& args] (swap! calls inc) (apply simulate args))]
   (is (= "completed" (:state (vm/handle! cfg client packet))))
   (is (= "already-completed" (:state (vm/handle! cfg client packet))))
   (is (= "already-completed" (:state (vm/handle! cfg client {:op "recover" :request req}))))
   (is (= 1 @calls))
   (let [export (vm/handle! cfg client {:op "export" :request req})
         replica (assoc cfg :state-root (str (:state-root cfg) "-replica") :node "vm-b")
         _ (d/private-dir! (:state-root replica)) _ (storage/init! (str (:state-root replica) "/packs"))
         b (assoc client :authenticated-node "vm-b")
         result (vm/handle! replica b {:op "replicate" :request req :car (:car export)})]
    (is (= "replicated" (:state result))) (is (:readback result))
    (is (= (:ref export) (:ref result)))
    (is (thrown? Exception (vm/handle! replica b {:op "replicate" :request req :car "AAAA"})))
    (is (= "exported" (:state (vm/handle! replica b {:op "export" :request req}))))))))
(deftest saved-result-recovers-lost-completion-ack-without-child
 (let [{:keys [cfg client packet req state]} (fixture)
       transmit (:transact client) n (atom 0)
       flaky (assoc client :transact (fn [tx] (if (= 2 (swap! n inc)) {:succeeded false} (transmit tx))))]
  (is (= "unknown" (:state (vm/handle! cfg flaky packet))))
  (with-redefs [physics/simulate (fn [& _] (throw (ex-info "must not simulate" {})))]
   (is (= "completed" (:state (vm/handle! cfg client {:op "recover" :request req})))))
  (is (= "already-completed" (:state (vm/handle! cfg client packet))))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
