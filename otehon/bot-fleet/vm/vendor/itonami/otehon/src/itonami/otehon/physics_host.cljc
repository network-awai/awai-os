(ns itonami.otehon.physics-host
 "One pinned Otehon simulation process. No old backend, tools or actuation."
 (:require [clojure.edn :as edn] [cheshire.core :as json] [itonami.otehon.occurrence :as o]
  [itonami.otehon.etcd :as e] [itonami.otehon.job-contract :as c] [itonami.otehon.job-host :as artifacts]
  [itonami.otehon.recurring-host :as d] [itonami.otehon.physics.runner :as runner] [itonami.otehon.bundle :as bundle])
 (:import [java.util.concurrent TimeUnit]))
(defn spec! [job]
 (let [en (:enrollment job) bot (:bot-id en) home (System/getProperty "user.home")
       _ (when-not (re-matches #"[a-zA-Z0-9._-]+" (str bot)) (throw (ex-info "bounded bot identity required" {})))
       digest (:physics-spec-sha job) path (str home "/.itonami/profiles/" bot "/workspace/physics/" digest ".edn")
       anchor (.getCanonicalPath (java.io.File. (str home "/.itonami")))
       _ (when-not (and (= (:profile-cid en) (bundle/bundle-cid (bundle/bundle-files (str home "/.itonami/profiles/" bot) {})))
                        (re-matches #"[a-f0-9]{64}" (str digest))
                        (= (str anchor "/profiles/" bot "/workspace/physics/" digest ".edn") (.getCanonicalPath (java.io.File. path)))
                        (<= (.length (java.io.File. path)) 65536) (= digest (e/binary-sha path)))
           (throw (ex-info "owned pinned physics input required" {})))
       spec (edn/read-string {:readers {} :default (fn [_ _] (throw (ex-info "tagged spec refused" {})))} (slurp path))]
  (runner/validate! spec (:physics-repository job)) path))
(defn runtime! [job]
 (let [root (:runtime-root job) expected (str (System/getProperty "user.home") "/github/workspaces/codex/")]
  (when-not (and (string? root) (.startsWith root expected) (= root (.getCanonicalPath (java.io.File. root)))
                 (= (:bb-sha job) (e/binary-sha (:bb job)))
                 (vector? (:runtime-pins job)) (<= 1 (count (:runtime-pins job)) 256)
                 (every? (fn [[path digest]]
                           (and (re-matches #"otehon/src/[a-zA-Z0-9_./-]+\.cljc" path)
                                (not (.contains path "..")) (= digest (e/binary-sha (str root "/" path))))) (:runtime-pins job)))
   (throw (ex-info "pinned Otehon runtime capsule required" {}))) true))
(defn simulate! [job request directory]
 (let [input (spec! job) _ (runtime! job) output (str directory "/simulation.edn")
       _ (when (.exists (java.io.File. output)) (throw (ex-info "existing simulation requires recovery" {})))
       _ (d/durable! (str directory "/simulation-intent.edn") (pr-str {:request-sha (o/digest request) :state "single-start-intended"}))
       args [(:bb job) "-cp" (str (:runtime-root job) "/otehon/src") "-m" "itonami.otehon.physics.runner"
             input (:physics-spec-sha job) (:physics-repository job) output (o/digest request)]
       p (.start (doto (ProcessBuilder. ^java.util.List args)
                   (.directory (java.io.File. directory))
                   (.redirectOutput (java.io.File. (str directory "/simulation.stdout.txt")))
                   (.redirectError (java.io.File. (str directory "/simulation.stderr.txt")))))
       done (.waitFor p 30 TimeUnit/SECONDS)]
  (when-not done (.destroyForcibly p))
  (when-not (and done (zero? (.exitValue p))) (throw (ex-info "simulation outcome uncertain; no automatic restart" {})))
  (d/saved output)))
(defn publish! [job request directory measurement]
 (when-not (and (= "itonami.otehon.physics-measurement.v1" (:schema measurement))
                (= (:physics-spec-sha job) (:spec-sha measurement)) (= (o/digest request) (:request-sha measurement))
                (= (:physics-repository job) (get-in measurement [:probe :repo])))
  (throw (ex-info "original simulation result binding required" {})))
 (let [domain (-> measurement (dissoc :request-sha) (assoc :kind "physical-simulation" :source-commit (get-in job [:source-profile :commit])))
       workspace (str (System/getProperty "user.home") "/.itonami/profiles/" (get-in job [:enrollment :bot-id]) "/workspace")
       events (str workspace "/measurements")
       anchor (.getCanonicalPath (java.io.File. (str (System/getProperty "user.home") "/.itonami")))
       _ (when-not (= (str anchor "/profiles/" (get-in job [:enrollment :bot-id]) "/workspace/measurements")
                       (.getCanonicalPath (java.io.File. events)))
           (throw (ex-info "owned physics event workspace required" {})))
       _ (d/private-dir! events)
       event (str events "/" (o/digest request) ".edn") prior (d/saved event)
       _ (when (and prior (not= prior measurement)) (throw (ex-info "simulation event changed" {})))
       _ (when-not prior (d/durable! event (pr-str measurement)))
       payload (json/generate-string {:request request :domain-result domain})
       original (when (.exists (java.io.File. (str directory "/artifact.json"))) (slurp (str directory "/artifact.json")))
       _ (when (and original (not= original payload)) (throw (ex-info "original physics artifact bytes changed" {})))]
  (d/durable! (str directory "/domain-result.edn") (pr-str domain))
  (d/durable! (str directory "/artifact.json") payload)
  (let [artifact (artifacts/publish-artifact! payload)
        metadata (assoc (dissoc domain :probe) :probe-summary (select-keys (:probe domain) [:count :expected]))
        result {:state "completed" :provider "none" :model "deterministic" :binding request
                :text (json/generate-string {:domain-result metadata :artifact artifact})}]
   (d/durable! (str directory "/result.edn") (pr-str result)) result)))
(defn execute! [client job request directory]
 (let [en (:enrollment job)]
  (when-not (and (= "physical-simulation" (get-in en [:grant :job-kind])) (c/valid-grant? (:grant en))
                 (= (:grant-cid request) (c/grant-cid (:grant en))) (= (:input-sha request) (o/digest job)))
   (throw (ex-info "typed physics grant/job required" {})))
  (spec! job) (runtime! job)
  (o/dispatch! (assoc client :invoke-once
    (fn [] (d/private-dir! directory)
     (d/durable! (str directory "/request.edn") (pr-str request)) (d/durable! (str directory "/job.edn") (pr-str job))
     (publish! job request directory (simulate! job request directory)))) request (:authenticated-node client) (System/currentTimeMillis))))
(defn recover! [client job request directory]
 ;; Reuse the original saved child result only; never start another child.
 (let [ks (o/keys-for (:bot-id request) (:job-id request) (:slot request)) claim ((:read client) (:occurrence ks))]
  (when-not (and claim (= (:authenticated-node client) (:node claim)) (= (:request claim) request)
                 (= request (d/saved (str directory "/request.edn"))) (= (o/digest job) (:input-sha request)))
   (throw (ex-info "original physics owner/request required" {})))
  (if (= "completed" (:state claim)) {:state "already-completed" :record claim :invoked false}
   (let [result (or (d/saved (str directory "/result.edn"))
                    (publish! job request directory (d/saved (str directory "/simulation.edn"))))]
     (when-not (= request (:binding result)) (throw (ex-info "physics result/request mismatch" {})))
     (o/reconcile! client request claim result)))))
