;; Safe projection configuration from existing operator-owned manifests.
(require '[clojure.edn :as edn] '[cheshire.core :as json]
         '[itonami.otehon.etcd :as e] '[itonami.otehon.recurring-host :as h])
(let [[catalog-path static-artifact] *command-line-args*
      home (System/getProperty "user.home") base (str home "/.itonami/bot-fleet/")
      root (str base "awai-2795-fleet-observer-v1")
      _ (assert (and static-artifact (.endsWith static-artifact "/nixos/otehon/shell/dist/soshiki-runtime/fleet-state.json")))
      _ (assert (not (.exists (java.io.File. root))) "reconcile existing publisher state")
      catalog (slurp catalog-path) _ (h/private-dir! root)
      bindings
      (vec (mapcat (fn [[mode deployment]]
       (let [cfg (edn/read-string (slurp (str base deployment "/worker.edn")))]
        (map (fn [job] (let [en (:enrollment job) pin (:source-profile job)]
          {:mode mode :botId (:catalog-bot-id job) :jobId (:job-id en)
           :sourceJobId (or (:source-job-id job) (:job-id en)) :issueId (:issue-id en)
           :projectId (:project-id en) :profileCommit (:commit pin) :profileChecksum (:checksum pin)
           :provider (:provider en) :model (:model en) :owner "jun-control"
           :capabilities (:capabilities en) :grantCid (:grant-cid en)
           :service (first (distinct (keep :origin (get-in en [:grant :operations]))))})) (:jobs cfg))))
       [["readiness" "awai-2795-readiness-v1"] ["original" "awai-2795-original-jobs-v1"]]))
      bindings-text (json/generate-string bindings)
      _ (h/durable! (str root "/catalog.json") catalog)
      _ (h/durable! (str root "/bindings.json") bindings-text)
      cfg {:schema "awai.fleet-projector.v1" :stateRoot root :staticArtifact static-artifact
           :catalogSha256 (e/binary-sha (str root "/catalog.json"))
           :bindingsSha256 (e/binary-sha (str root "/bindings.json"))}
      path (str root "/worker.json")]
 (h/durable! path (json/generate-string cfg))
 (prn {:prepared true :manifest path :sha256 (e/binary-sha path) :bindings (count bindings)}))
