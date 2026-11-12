(ns bot-fleet.core-test
  (:require [clojure.test :refer [deftest is run-tests]] [bot-fleet.core :as fleet]))
(def revision (apply str (repeat 40 "a")))
(def manifest {:id "bot-a" :type "profile" :description "Observe"
               :profile {:repository "cloud-itonami/a" :commit revision
                         :checksum (str "sha256-tree:" (apply str (repeat 64 "b")))
                         :files [{:path "cron/jobs.json" :sha256 (apply str (repeat 64 "c"))}]}})
(def project {:uuid "p" :name "cloud-itonami/a" :initiatives [{:id "i"}]})
(def issue {:id "AWAI-1" :projectId "p"})
(defn bot [projects]
  (first (get-in (fleet/catalog [manifest] projects [issue] revision) [:organization :bots])))

(deftest pins-and-identities
  (is (thrown? Exception (fleet/catalog [(assoc-in manifest [:profile :commit] "main")] [] [] revision)))
  (is (thrown? Exception (fleet/catalog [manifest manifest] [] [] revision)))
  (is (= (fleet/catalog [manifest] [project] [issue] revision)
         (fleet/catalog [manifest] [project] [issue] revision))))

(deftest reconciliation-does-not-grant-authority
  (is (= "needs-reconciliation" (get-in (bot []) [:linear :state])))
  (is (= "needs-reconciliation" (get-in (bot [project project]) [:linear :state])))
  (is (= "needs-reconciliation" (get-in (bot [(assoc project :initiatives [])]) [:linear :state])))
  (is (= "not-started" (get-in (bot [project]) [:runtime :state])))
  (is (false? (fleet/schedule-eligible? (bot [project])))))

(deftest run-cannot-escape-project
  (let [b (bot [project]) binding {:issue-id "AWAI-1" :run-id "run-1" :revision revision :acceptance-unit "one verified fix"}]
    (is (= "p" (get-in (fleet/bind-run b binding) [:binding :project-id])))
    (is (= "issue-outside-project" (:error (fleet/bind-run b (assoc binding :issue-id "AWAI-2")))))
    (is (= "incomplete-binding" (:error (fleet/bind-run b (dissoc binding :acceptance-unit)))))
    (is (= "issue-already-closed" (:error (fleet/bind-run
                                           (assoc-in b [:linear :issues 0 :status] "Done") binding))))
    (is (= "linear-unresolved" (:error (fleet/bind-run (bot []) binding))))))

(deftest renames-need-explicit-evidence
  (let [renamed (assoc project :name "cloud-itonami/app-itonami-a")
        alias {:source "cloud-itonami/a" :repository (:name renamed) :githubId 123}]
    (is (= "needs-reconciliation" (:state (fleet/linear-binding "cloud-itonami/a" [renamed] [issue]))))
    (is (= "bound" (:state (fleet/linear-binding "cloud-itonami/a" [renamed] [issue] {(:source alias) alias}))))))

(deftest distributed-execution-is-required
  (let [b (-> (bot [project])
              (assoc-in [:schedule :state] "verified")
              (assoc-in [:schedule :enabled] true)
              (assoc-in [:runtime :owner] "node-a"))]
    (is (= "itonami.distributed-execution.v1" (:kind fleet/execution-contract)))
    ;; A compatible configuration still needs real node admission before execution.
    (is (true? (fleet/schedule-eligible? b)))
    (doseq [substrate [nil "vke" "mithril-vke" "local" "singleton"]]
      (is (false? (fleet/schedule-eligible? (assoc-in b [:runtime :substrate] substrate)))))
    (is (false? (fleet/schedule-eligible? (assoc-in b [:runtime :adapter] "local-sqlite"))))
    (is (false? (fleet/schedule-eligible? (assoc-in b [:runtime :authority] "process-pid"))))))

(let [result (run-tests 'bot-fleet.core-test)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
