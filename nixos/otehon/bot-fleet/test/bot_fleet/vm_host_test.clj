(require '[clojure.test :refer [deftest is run-tests]] '[bot-fleet.vm-host :as host]
 '[bot-fleet.vm-client :as transport] '[itonami.otehon.recurring-host :as h]
 '[itonami.otehon.physics-host :as pinned] '[itonami.otehon.job-contract :as g]
 '[itonami.otehon.occurrence :as o] '[itonami.otehon.io :as hash])
(defn fixture []
 (let [root (str ".agent-output/vm-host-test-" (random-uuid)) _ (h/private-dir! root)
       text "{}" file (str root "/spec.edn") _ (h/durable! file text)
       grant {:schema "itonami.job-grant.v1" :owner-decision "AWAI-2795" :execution "deterministic"
              :job-kind "physical-simulation" :authority-source "operator-enrollment"
              :capabilities (g/capabilities "physical-simulation") :operations []
              :model-tools false :mail-send false :git-merge false}
       en {:schema "itonami.occurrence-enrollment.v1" :bot-id "bot" :job-id "vm" :issue-id "AWAI-2820"
           :project-id "p" :initiative-id "i" :profile-cid "profile" :schedule-cid "schedule"
           :provider "none" :model "deterministic" :executor "bounded-job-v1" :grant grant :grant-cid (g/grant-cid grant)
           :capabilities (:capabilities grant) :data-class "job-result-metadata-only" :nodes ["vm-levi" "vm-benjamin"]
           :schedule {:type "interval" :every-ms 86400000} :initial-slot 1000 :missed-slot-policy "skip-completed-only"
           :vm-spec-sha (hash/sha256-utf8 text)}
       key (:enrollment (o/keys-for "bot" "vm" 1000))]
  {:cfg {:state-root root} :job {:enrollment en :binding {:revision "test"} :preferred-node "vm-levi"}
   :client {:read #(when (= key %) en)} :file file}))
(deftest changed-enrollment-or-closed-issue-cannot-dispatch-vm
 (let [{:keys [cfg job client]} (fixture) calls (atom 0)]
  (with-redefs [transport/call! (fn [& _] (swap! calls inc))]
   (is (thrown? Exception (host/tick-job! cfg (assoc client :read (constantly nil)) job 1000)))
   (with-redefs [h/issue-context! (fn [& _] (throw (ex-info "closed" {})))]
    (is (thrown? Exception (host/tick-job! cfg client job 1000))))
   (is (zero? @calls)))))
(deftest lost-dispatch-without-visible-claim-never-redispatches
 (let [{:keys [cfg job client file]} (fixture) calls (atom 0)]
  (with-redefs [h/issue-context! (fn [& _] true) pinned/spec! (fn [& _] file)
                h/publish-comment! (fn [& _] true)
                transport/call! (fn [& _] (swap! calls inc) (throw (ex-info "transport unknown" {})))]
   (is (thrown? Exception (host/tick-job! cfg client job 1000)))
   (is (thrown? Exception (host/tick-job! cfg client job 1000)))
   (is (= 1 @calls)))))
(let [r (run-tests)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1)))
