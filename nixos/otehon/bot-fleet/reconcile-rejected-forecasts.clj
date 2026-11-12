;; Operator reconciliation of a DEFINITIVELY UNSUBMITTED CLI target rejection.
;; Never use this for lost acknowledgements, unknown requests or admitted work.
(require '[clojure.edn :as edn] '[cheshire.core :as json]
         '[itonami.otehon.etcd :as e] '[itonami.otehon.occurrence :as o]
         '[itonami.otehon.recurring-host :as h])
(let [[manifest] *command-line-args* cfg (edn/read-string (slurp manifest))
      client (e/client (edn/read-string (slurp (:etcd-config cfg))))]
 (doseq [job (:jobs cfg)
         :let [en (:enrollment job) slot (:initial-slot en) dir (h/run-path cfg job slot)
               intent (str dir "/linear-forecast-intent.edn")]
         :when (h/saved intent)]
  (let [response (json/parse-string (slurp (str dir "/linear-write-forecast/stdout.json")) true)
        request (h/saved (str dir "/request.edn"))
        marker (str "itonami-readiness:" (:run-id request) ":forecast")
        issue (h/issue-context! cfg job (str dir "/operator-rejection-readback"))
        m (get-in issue [:result :meta]) comments (get-in issue [:result :comments])
        keys (o/keys-for (:bot-id en) (:job-id en) slot)]
   (assert (and (false? (:ok response)) (= "linear_issue_required" (get-in response [:error :code]))
                (false? (:partial m)) (false? (get-in m [:sections :comments :hasMore])) (vector? comments)
                (not-any? #(clojure.string/includes? (:body %) marker) comments)
                (nil? ((:read client) (:occurrence keys)))
                (not (.exists (java.io.File. (str dir "/model"))))
                (not (h/saved (str dir "/linear-forecast-confirmed.edn")))))
   (let [archive (java.io.File. (str dir "/definitive-preflight-rejection-v1"))]
    (assert (.mkdir archive) "preserve any earlier reconciliation")
    (doseq [name ["linear-forecast-intent.edn" "linear-forecast-body.md" "linear-write-forecast"]]
      (assert (.renameTo (java.io.File. (str dir "/" name)) (java.io.File. archive name))))
    (h/durable! (str dir "/operator-reconciled.edn")
      (pr-str {:reason "linear_issue_required: definitively unsubmitted UUID target"
               :complete-readback true :model-called false :admitted false :marker marker})))
   (println (:catalog-bot-id job) "definitive preflight rejection archived; retry can use verified issue key"))))
