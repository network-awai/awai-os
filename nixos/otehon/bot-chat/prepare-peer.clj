;; Explicit owner registration only. Runtime worker credentials remain read-only for enrollment.
(require '[cheshire.core :as j] '[clojure.edn :as edn] '[clojure.java.io :as io]
 '[itonami.otehon.peer-talk :as p] '[itonami.otehon.occurrence :as o]
 '[itonami.otehon.etcd :as e] '[itonami.otehon.bundle :as bundle] '[itonami.otehon.recurring-host :as h])
(let [[file digest] *command-line-args* _ (assert (= digest (e/binary-sha file)))
 cfg (j/parse-string (slurp file) true) g (:grant cfg) _ (assert (p/valid-grant? g))
 worker-cfg (edn/read-string (slurp (:etcdConfig cfg))) worker (e/client worker-cfg)
 control (.getParent (io/file (:etcdConfig cfg)))
 admin (e/client (assoc worker-cfg :authenticated-node "root" :cert (str control "/root.pem") :key (str control "/root.key")))
 en {:schema "itonami.occurrence-enrollment.v1" :bot-id (:leader cfg) :job-id (str "peer-cycle-" (:cycle-id g))
     :issue-id (:issue-id g) :project-id (:projectId cfg) :initiative-id (:initiativeId cfg)
     :profile-cid (:leaderProfileCid cfg) :schedule-cid (bundle/cid-raw (o/encode {:source "operator-one-cycle" :cycle (:cycle-id g) :max-turns (:max-turns g)}))
     :provider "meta" :model (:model g) :executor "peer-conversation-v1" :grant g :grant-cid (p/grant-cid g)
     :data-class "public-fleet-review-only" :capabilities ["inference_muse"] :nodes [(:authenticated-node worker)]
     :schedule {:type "interval" :every-ms 1000} :initial-slot (:initialSlot cfg)}
 _ (assert (and (= (:initial-slot g) (:initial-slot en)) (o/enrollment-valid? en)))
 keys (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en)) prior ((:read admin) (:enrollment keys))
 _ (if prior (assert (= prior en) "existing enrollment differs; no overwrite")
      (assert (true? (:succeeded ((:transact admin)
       {:compare {(:enrollment keys) nil (:cursor keys) nil (:occurrence keys) nil} :put {(:enrollment keys) (o/encode en)}}))) "owner registration not confirmed"))
 _ (assert (= en ((:read worker) (:enrollment keys))) "worker enrollment readback differs")
 receipt {:schema "itonami.peer-enrollment-receipt.v1" :at (str (java.time.Instant/now)) :issueId (:issue-id g)
          :pilotConfigSha256 digest :grantCid (p/grant-cid g) :ownerRegistration true :workerReadback true
          :workerAuthorityExpanded false :modelInvoked false}]
 (h/durable! (str (:stateRoot cfg) "/owner-enrollment.json") (j/generate-string receipt))
 (println (j/generate-string receipt)))
