(ns bot-fleet.vm-host
 "Recurring host gate and Linear recorder; computation and Pack persistence run
 in the explicitly enrolled VMs. Unknown never moves to another compute owner."
 (:require [clojure.edn :as edn] [clojure.string :as str] [cheshire.core :as json]
  [bot-fleet.vm-client :as transport] [bot-fleet.vm-worker :as vm]
  [itonami.otehon.etcd :as e] [itonami.otehon.occurrence :as o]
  [itonami.otehon.physics-host :as pinned-source] [itonami.otehon.recurring :as recurring]
  [itonami.otehon.recurring-host :as h] [itonami.otehon.original-host :as original]))
(defn ensure! [ok & [message]]
 (when-not ok (throw (ex-info (or message "VM proof unconfirmed") {}))))
(defn publish-car! [ref encoded]
 (let [bytes (.decode (java.util.Base64/getDecoder) ^String encoded)
       sha (apply str (map #(format "%02x" (bit-and 255 %))
                     (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes)))
       _ (ensure! (= sha (:car-sha ref)))
       url (str "http://127.0.0.1:8586/itonami-vm-results-AWAI-2820-v1/" sha ".car")
       open (fn [method] (doto ^java.net.HttpURLConnection (.openConnection (.toURL (java.net.URI. url)))
                          (.setRequestMethod method) (.setInstanceFollowRedirects false)
                          (.setConnectTimeout 3000) (.setReadTimeout 30000)))]
  (let [^java.net.HttpURLConnection c (open "PUT")]
   (try (.setDoOutput c true) (.setRequestProperty c "Content-Type" "application/vnd.ipld.car")
     (.setRequestProperty c "If-None-Match" "*")
     (with-open [out (.getOutputStream c)] (.write out bytes))
     (ensure! (contains? #{200 201 204 412} (.getResponseCode c))) (finally (.disconnect c))))
  (let [^java.net.HttpURLConnection c (open "GET")]
   (try (ensure! (= 200 (.getResponseCode c)))
     (ensure! (java.util.Arrays/equals bytes (with-open [in (.getInputStream c)] (.readNBytes in 1048577))))
     (finally (.disconnect c))))
  {:cid (:root-cid ref) :format "awai.otehon-store/pack-v1" :sha256 sha :readback true :url url}))
(defn workflow! [cfg job dir]
 (let [file (str dir "/workflow-intent.edn") read #(h/issue-context! cfg job (str dir "/workflow-read"))
       state #(get-in % [:result :issue :state :type])]
  (if (= "started" (state (read))) true
   (when-not (h/saved file)
    (h/durable! file (pr-str {:target "In Progress" :single-write true}))
    (h/call-json! [(:orca cfg) "linear" "status" "set" (get-in job [:binding :issue-id])
                  "--to" "In Progress" "--workspace" (:workspace cfg) "--json"] (str dir "/workflow-write"))
    (= "started" (state (read)))))))
(defn finish! [cfg client job request dir]
 (let [claim ((:read client) (:occurrence (o/keys-for (:bot-id request) (:job-id request) (:slot request))))
       _ (ensure! (and (= "completed" (:state claim)) (= request (:request claim))))
       metadata (vm/read-data (get-in claim [:result :text])) owner (:node claim)
       peer (if (= "vm-levi" owner) "vm-benjamin" "vm-levi")
       saved (h/saved (str dir "/vm-export.edn"))
       export (or saved (transport/call! (:client cfg) owner {:op "export" :request request} (str dir "/export")))
       _ (ensure! (and (= "exported" (:state export)) (= (:pack metadata) (:ref export))))
       _ (when-not saved (h/durable! (str dir "/vm-export.edn") (pr-str export)))
       replica (or (h/saved (str dir "/vm-replica.edn"))
                   (let [r (transport/call! (:client cfg) peer {:op "replicate" :request request :car (:car export)} (str dir "/replicate"))]
                    (ensure! (and (= "replicated" (:state r)) (:readback r) (= (:ref export) (:ref r))))
                    (h/durable! (str dir "/vm-replica.edn") (pr-str r)) r))
       artifact (or (h/saved (str dir "/published-car.edn"))
                    (let [r (publish-car! (:ref export) (:car export))]
                     (h/durable! (str dir "/published-car.edn") (pr-str r)) r))
       domain {:schema "itonami.otehon.physics-measurement.v1" :status (:status metadata) :scope (:scope metadata)
               :probe-summary (:probe-summary metadata) :native-tests "unmeasured" :actuation "disabled" :growth "held"
               :compute "awai-network-vm" :execution-node owner :replica-node peer :replicas 2
               :source-commit (get-in job [:source-profile :commit]) :spec-sha (get-in job [:enrollment :vm-spec-sha])}
       result {:catalog-bot-id (:catalog-bot-id job) :job-id (:job-id request) :run-id (:run-id request)
               :state "completed" :provider "none" :model "deterministic" :domain-result domain :artifact artifact
               :linear-result-confirmed true}
       body (str "Itonami VM App-physics result; same original daily JST phase.\n"
                 (json/generate-string result {:pretty true})
                 "\nProvider none/model deterministic; model input/cache/output/reasoning tokens not applicable, not measured zero.\n"
                 "Acceptance unit: one pinned Otehon physics probe plus two VM Pack/CAR replicas, AwaiFS byte readback and this owning Issue record. Native tests, growth/merge and actuation remain unqualified.")
       bound (assoc job :run-id (:run-id request) :record-prefix "itonami-vm-job")
       _ (ensure! (h/publish-comment! cfg bound dir "result" body))
       live (h/issue-context! cfg job (str dir "/result-readback"))
       marker (str "itonami-vm-job:" (:run-id request) ":result\n\n" body)
       _ (ensure! (and (not (get-in live [:result :meta :partial]))
                      (= false (get-in live [:result :meta :sections :comments :hasMore]))
                      (some #(= marker (:body %)) (get-in live [:result :comments]))))
       _ (ensure! (workflow! cfg job dir) "Linear workflow update unconfirmed; no redispatch")]
  (h/durable! (str dir "/host-result.edn") (pr-str result)) result))
(defn tick-job! [cfg client job now]
 (let [en (:enrollment job) ks (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en))
       _ (ensure! (= en ((:read client) (:enrollment ks))) "VM enrollment changed")
       cursor ((:read client) (:cursor ks))
       prior (when cursor
               (let [dir (original/run-directory cfg job (:slot cursor)) req (h/saved (str dir "/request.edn"))]
                (ensure! req "original VM request missing")
                (when-not (= "completed" (:state cursor))
                 (let [claim ((:read client) (:occurrence (o/keys-for (:bot-id en) (:job-id en) (:slot cursor))))]
                  (ensure! (= req (:request claim)))
                  (transport/call! (:client cfg) (:node claim) {:op "recover" :request req} (str dir "/recover"))))
                (or (h/saved (str dir "/host-result.edn")) (finish! cfg client job req dir))))
       cursor ((:read client) (:cursor ks)) plan (recurring/plan en cursor now)]
  (if-not (= "due" (:state plan))
   (let [health (when prior
                 (let [dir (original/run-directory cfg job (:slot cursor)) req (h/saved (str dir "/request.edn"))
                       original-export (h/saved (str dir "/vm-export.edn"))]
                  (mapv (fn [node]
                           (try (let [r (transport/call! (:client cfg) node {:op "export" :request req} (str dir "/health/" node))]
                                  {:node node :readback (= (:car original-export) (:car r))})
                             (catch Exception _ {:node node :readback false}))) (:nodes en))))]
    {:catalog-bot-id (:catalog-bot-id job) :job-id (:job-id en)
     :state (if (and prior (every? :readback health)) "waiting" "held")
     :reason (when-not (and prior (every? :readback health)) "vm-replica-readback-unconfirmed")
     :next-slot (:next-slot plan) :last-result prior :vm-health health})
   (let [_ (h/issue-context! cfg job (str (:state-root cfg) "/issue-reads/" (:bot-id en)))
         spec-file (pinned-source/spec! (assoc job :physics-spec-sha (:vm-spec-sha en) :physics-repository (:vm-repository en)))
         text (slurp spec-file)
         _ (ensure! (= (:vm-spec-sha en) (itonami.otehon.io/sha256-utf8 text)))
         dir (original/run-directory cfg job (:slot plan)) _ (h/private-dir! dir)
         req (or (h/saved (str dir "/request.edn"))
                 (merge (select-keys en [:bot-id :job-id :issue-id :project-id :initiative-id :profile-cid :schedule-cid :provider :model :executor :grant-cid])
                        {:slot (:slot plan) :attempt-id (str (random-uuid)) :run-id (str "vm-" (:bot-id en) "-" (:slot plan))
                         :input-sha (vm/input-sha en) :revision (get-in job [:binding :revision])}))
         _ (when-not (h/saved (str dir "/request.edn")) (h/durable! (str dir "/request.edn") (pr-str req)))
         bound (assoc job :run-id (:run-id req) :record-prefix "itonami-vm-job")
         _ (ensure! (h/publish-comment! cfg bound dir "forecast"
                    (str "VM App-physics forecast; run " (:run-id req) "; source " (get-in job [:binding :revision]) ".\n"
                         "Provider none/model deterministic; token forecast not applicable. One pinned public App spec executed in enrolled Awai VM, canonical Pack/CAR saved and read back on both VM nodes, public AwaiFS CAR and owning Linear record. Original daily JST phase preserved; no Native tests/growth/merge/actuation. Unknown stays on original owner; no alternate computation.")))
         _ (ensure! (not (h/saved (str dir "/dispatch-intent.edn"))) "VM dispatch outcome unknown; original reconciliation required")
         _ (h/durable! (str dir "/dispatch-intent.edn") (pr-str {:single-start true :request req}))
         r (transport/call! (:client cfg) (:preferred-node job) {:op "run" :request req :spec-text text} (str dir "/dispatch"))]
    (ensure! (contains? #{"completed" "already-completed"} (:state r)) "VM execution unconfirmed; retain original request")
    {:catalog-bot-id (:catalog-bot-id job) :job-id (:job-id en) :state "waiting"
     :last-result (finish! cfg client job req dir) :next-slot (+ (:slot plan) (get-in en [:schedule :every-ms]))}))))
