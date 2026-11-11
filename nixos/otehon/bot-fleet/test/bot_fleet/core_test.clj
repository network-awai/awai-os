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
    (is (= "linear-unresolved" (:error (fleet/bind-run (bot []) binding))))))

(let [result (run-tests 'bot-fleet.core-test)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
