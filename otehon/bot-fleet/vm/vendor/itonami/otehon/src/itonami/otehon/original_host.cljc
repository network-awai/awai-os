(ns itonami.otehon.original-host
  "Original bounded jobs, with live work binding and per-operation receipts.
  A completed observation is not completion of its business mission."
  (:require [clojure.edn :as edn] [cheshire.core :as json]
            [itonami.otehon.etcd :as e] [itonami.otehon.occurrence :as o]
            [itonami.otehon.recurring :as recurring] [itonami.otehon.recurring-host :as d]
            [itonami.otehon.job-host :as jobs] [itonami.otehon.physics-host :as physics]))
(defn physics? [job] (= "physical-simulation" (get-in job [:enrollment :grant :job-kind])))
(defn run-directory [cfg job slot]
  (str (:state-root cfg) "/runs/" (o/digest [(get-in job [:enrollment :bot-id]) (get-in job [:enrollment :job-id])]) "/" slot))
(defn post-result! [cfg job request directory result]
  (let [metadata (when (get-in result [:record :result :text])
                   (json/parse-string (get-in result [:record :result :text]) true))
        local-result (d/saved (str directory "/result.edn"))
        metadata (or metadata (when (:text local-result) (json/parse-string (:text local-result) true)))
        bound-job (assoc job :run-id (:run-id request) :record-prefix "itonami-original-job")]
    (when-not (and metadata (contains? #{"completed" "already-completed"} (:state result)))
      (throw (ex-info "original result is not confirmed" {})))
    (when-not (d/publish-comment! cfg bound-job directory "result"
                (str "Original bounded job observation completed. Bot " (:catalog-bot-id job)
                     "; job " (:job-id request) "; run " (:run-id request) "; source " (:revision request) ".\n"
                     "Provider none / model deterministic, no inference process; token counters not applicable to this executor (global/coding usage unknown).\n"
                     "One actual measurement/ledger/proposal unit; not registration/deployment success, no outbound email or public proposal POST.\n"
                     (json/generate-string metadata {:pretty true})))
      (throw (ex-info "Linear result publication held" {})))
    {:catalog-bot-id (:catalog-bot-id job) :job-id (:job-id request) :run-id (:run-id request)
     :state (:state result) :domain-result (:domain-result metadata) :artifact (:artifact metadata)
     :provider "none" :model "deterministic" :linear-result-confirmed true}))
(defn tick-job! [cfg client job now]
  (let [en (:enrollment job) ks (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en))
        actual ((:read client) (:enrollment ks))
        _ (when-not (= actual en) (throw (ex-info "operator enrollment mismatch" {})))
        cursor ((:read client) (:cursor ks))
        prior (when cursor
                (let [dir (run-directory cfg job (:slot cursor)) request (d/saved (str dir "/request.edn"))
                      original-job (d/saved (str dir "/job.edn"))]
                  (when (and request original-job)
                    (let [r (if (= "completed" (:state cursor))
                              {:state "already-completed" :record ((:read client) (:occurrence (o/keys-for (:bot-id en) (:job-id en) (:slot cursor))))}
                              ((if (physics? original-job) physics/recover! jobs/recover!) client original-job request dir))]
                      (post-result! cfg original-job request dir r)))))
        cursor ((:read client) (:cursor ks)) plan (recurring/plan en cursor now)]
    (if-not (= "due" (:state plan))
      (merge {:catalog-bot-id (:catalog-bot-id job) :job-id (:job-id en) :last-result prior} plan)
      (let [_ (d/issue-context! cfg job (str (:state-root cfg) "/issue-reads/" (:bot-id en)))
            slot (:slot plan) dir (run-directory cfg job slot)
            _ (d/private-dir! dir)
            request (or (d/saved (str dir "/request.edn"))
                        (merge (select-keys en [:bot-id :job-id :issue-id :project-id :initiative-id :profile-cid :schedule-cid :provider :model :executor :grant-cid])
                               {:slot slot :attempt-id (str (random-uuid)) :run-id (str "original-" (:bot-id en) "-" slot)
                                :revision (get-in job [:binding :revision]) :input-sha (o/digest job)}))
            bound-job (assoc job :run-id (:run-id request) :record-prefix "itonami-original-job")]
        (when-not (d/saved (str dir "/request.edn")) (d/durable! (str dir "/request.edn") (pr-str request)))
        (when-not (d/publish-comment! cfg bound-job dir "forecast"
                    (str "Original bounded job planned; run " (:run-id request) "; source " (:revision request)
                         "; exact grant " (:grant-cid request) "; original source interval " (:source-interval-minutes job) " minutes.\n"
                         "Provider none/model deterministic (no inference dispatcher); token forecast not applicable. Goal: one real service observation and the declared local ledger/proposal output.\n"
                         "Unknown outcome freezes; no mail send/registration POST/arbitrary scripts or merge."))
          (throw (ex-info "forecast publication unconfirmed" {})))
        (let [r ((if (physics? job) physics/execute! jobs/execute!) client job request dir)]
          (if (contains? #{"completed" "already-completed"} (:state r))
            (post-result! cfg job request dir r)
            (merge {:catalog-bot-id (:catalog-bot-id job) :job-id (:job-id en) :run-id (:run-id request)} (select-keys r [:state :reason :invoked]))))))))
(defn tick! [cfg]
  (when-not (and (= "itonami.original-job-worker.v1" (:schema cfg))
                 (= (:orca-sha cfg) (e/binary-sha (:orca cfg)))
                 (vector? (:jobs cfg)) (<= 1 (count (:jobs cfg)) 16))
    (throw (ex-info "pinned bounded original-job worker required" {})))
  (let [client (e/client (edn/read-string (slurp (:etcd-config cfg))))
        rows (mapv (fn [job]
                     (try (tick-job! cfg client job (System/currentTimeMillis))
                       (catch Exception _ {:catalog-bot-id (:catalog-bot-id job) :state "held" :reason "executor-or-record-unconfirmed"}))) (:jobs cfg))
        report {:schema "awai.original-job-observation.v1" :observedAt (str (java.time.Instant/now))
                :worker (:authenticated-node client) :scope "original-bounded-jobs" :jobs rows}]
    (d/durable! (str (:state-root cfg) "/status.json") (json/generate-string report {:pretty true}))
    report))
(defn -main [& [manifest digest]]
  (when-not (= digest (e/binary-sha manifest)) (throw (ex-info "manifest pin mismatch" {})))
  (println (json/generate-string (tick! (edn/read-string (slurp manifest))))))
