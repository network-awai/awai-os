(ns meiji.coordinator
  "Owner-side cron wake and recording; all physics computation remains in the
   enrolled Meiji guests. The original ledger schedule decides admission."
  (:require [clojure.edn :as edn] [cheshire.core :as json]
            [bot-fleet.vm-host :as worker] [meiji.policy :as p]
            [itonami.otehon.etcd :as etcd]
            [itonami.otehon.recurring-host :as durable]
            [org.httpkit.client :as http]))

(defn tick! [cfg client now]
  {:schema "awai.meiji-production.v1" :observedAt (str (java.time.Instant/ofEpochMilli now))
   :scheduler "owner-control; original ledger cron" :compute "enrolled Meiji VMs"
   :jobs (mapv (fn [job]
                 (try (assoc (worker/tick-job! cfg client job now)
                             :issue-id (get-in job [:binding :issue-id])
                             :preferred-node (:preferred-node job)
                             :period-ms (get-in job [:enrollment :schedule :every-ms]))
                      (catch Exception _
                        {:catalog-bot-id (:catalog-bot-id job)
                         :issue-id (get-in job [:binding :issue-id])
                         :job-id (get-in job [:enrollment :job-id])
                         :state "unknown" :reason "original-outcome-or-publication-unconfirmed"}))) (:jobs cfg))})

(defn publish! [cfg report]
  (let [text (json/generate-string report)
        url "http://127.0.0.1:8586/.itonami/runtime/meiji-current.json"
        request (fn [method]
                  @(http/request {:url url :method method :as :text :timeout 30000
                                  :follow-redirects false :headers {"Content-Type" "application/json"}
                                  :body (when (= method :put) text)}))]
    (durable/durable! (str (:state-root cfg) "/public-status.json") text)
    (p/require! (contains? #{200 201 204} (:status (request :put))) "report-write-unconfirmed")
    (let [readback (request :get)]
      (p/require! (and (= 200 (:status readback)) (= text (:body readback))) "report-readback-unconfirmed"))
    ;; Update the UI only after the persistent public report's exact readback.
    (durable/durable! (str (:reports-dir cfg) "/meiji-production.json") text)))

(defn -main [& [manifest digest]]
  (p/require! (= digest (etcd/binary-sha manifest)) "coordinator-config-pin-mismatch")
  (let [cfg (edn/read-string (slurp manifest))]
    (p/require! (and (= "meiji.recovered-coordinator.v1" (:schema cfg))
                     (= 2 (count (:jobs cfg)))
                     (= (:orca-sha cfg) (etcd/binary-sha (:orca cfg)))) "coordinator-binding-required")
    (with-open [file (java.io.RandomAccessFile. (str (:state-root cfg) "/coordinator.lock") "rw")
                channel (.getChannel file)]
      ;; Closing the enclosing channel releases the OS lock on every exit,
      ;; including exceptions; no unsupported FileLock implementation reflection.
      (if (.tryLock channel)
        (let [client (etcd/client (edn/read-string (slurp (:etcd-config cfg))))
                report (tick! cfg client (System/currentTimeMillis))]
            (publish! cfg report)
            (println (json/generate-string (select-keys report [:schema :observedAt])))
            (println (json/generate-string {:states (frequencies (map :state (:jobs report)))})))
        (println "coordinator already active; no second dispatch")))))
