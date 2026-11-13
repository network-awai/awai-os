;; Owner-approved Otehon peer pilot. No scheduler, shell, tools or provider fallback.
(require '[cheshire.core :as j] '[clojure.edn :as edn] '[clojure.java.io :as io]
 '[itonami.otehon.io :as hio] '[itonami.otehon.peer-talk :as peer]
 '[itonami.otehon.occurrence :as o] '[itonami.otehon.etcd :as e]
 '[itonami.otehon.recurring-host :as h] '[itonami.otehon.bundle :as bundle])
(let [[cfg-file digest] *command-line-args* _ (assert (= digest (e/binary-sha cfg-file)) "pinned peer manifest required")
 cfg (j/parse-string (slurp cfg-file) true) grant (:grant cfg) _ (assert (peer/valid-grant? grant)) _ (assert (= (:initial-slot grant) (:initialSlot cfg)))
 _ (assert (= "itonami.peer-pilot.v1" (:schema cfg))) root (:stateRoot cfg) _ (h/private-dir! root)
 _ (assert (= (:clientSha256 cfg) (e/binary-sha (:clientScript cfg))))
 _ (assert (= (:reportSha256 cfg) (e/binary-sha (:reportScript cfg))))
 transport (e/client (edn/read-string (slurp (:etcdConfig cfg)))) node (:authenticated-node transport)
 enrollment {:schema "itonami.occurrence-enrollment.v1" :bot-id (:leader cfg) :job-id (str "peer-cycle-" (:cycle-id grant))
  :issue-id (:issue-id grant) :project-id (:projectId cfg) :initiative-id (:initiativeId cfg)
  :profile-cid (:leaderProfileCid cfg) :schedule-cid (bundle/cid-raw (o/encode {:source "operator-one-cycle" :cycle (:cycle-id grant) :max-turns (:max-turns grant)}))
  :provider "meta" :model (:model grant) :executor "peer-conversation-v1" :grant grant :grant-cid (peer/grant-cid grant)
  :data-class "public-fleet-review-only" :capabilities ["inference_muse"] :nodes [node]
  :schedule {:type "interval" :every-ms 1000} :initial-slot (:initialSlot cfg)}
 _ (assert (o/enrollment-valid? enrollment)) ks (o/keys-for (:bot-id enrollment) (:job-id enrollment) (:initial-slot enrollment))
 prior ((:read transport) (:enrollment ks))
 _ (if prior (assert (= prior enrollment) "existing peer enrollment differs")
      (assert (true? (:succeeded ((:transact transport) {:compare {(:enrollment ks) nil} :put {(:enrollment ks) (o/encode enrollment)}}))) "peer enrollment CAS unconfirmed"))
 call! (fn [op body tag]
   (let [file (str root "/request-" tag ".json") text (j/generate-string {:operation op :body body})
         _ (h/durable! file text) r (hio/spawn-sync! [(:nodeBinary cfg) (:clientScript cfg) cfg-file digest file (hio/sha256-utf8 text)] {:timeout-ms 155000 :input ""})]
    (when-not (zero? (:exit r)) (throw (ex-info "private Agent result unconfirmed; no automatic retry" {})))
    (j/parse-string (:stdout r) true)))
 leader (get-in grant [:participants 0 :bot-id]) session (:session-id grant)
 _ (call! "sessions" {:botId leader :action "create" :sessionId session :title "Fleet信頼性 · Peer"} (str "session-" (java.util.UUID/randomUUID)))
 summary! (fn [state turns]
  (let [summary {:schema "itonami.peer-cycle-result.v1" :cycle-key (hio/sha256-utf8 (:cycle-id grant)) :issueId (:issue-id grant)
    :trackingIssue "AWAI-2861" :goal (:goal grant) :state state :maxTurns (:max-turns grant) :completedTurns (count turns)
    :observedAt (str (java.time.Instant/now)) :participants (mapv :bot-id (:participants grant))
    :turns (mapv #(select-keys % [:turn :speaker :state :runId :usage :usageCoverage]) turns)}]
   (h/durable! (str root "/summary.json") (j/generate-string summary))
   (hio/spawn-sync! [(:nodeBinary cfg) (:reportScript cfg) cfg-file digest (str root "/summary.json")] {:timeout-ms 10000 :input ""})
   (println (j/generate-string (select-keys summary [:state :completedTurns :maxTurns :issueId :cycle-key]))) summary))]
 (loop [turns []]
  (let [plan (peer/turn-plan grant turns)]
   (if (not= "ready" (:state plan)) (summary! (:state plan) turns)
    (let [n (:turn plan) slot (+ (:initial-slot enrollment) (* 1000 n))
     _ (when (> slot (System/currentTimeMillis)) (Thread/sleep (- slot (System/currentTimeMillis))))
     hex (hio/sha256-utf8 (str (:cycle-id grant) ":" n))
     id (str (subs hex 0 8) "-" (subs hex 8 12) "-" (subs hex 12 16) "-" (subs hex 16 20) "-" (subs hex 20 32))
     req (merge (select-keys enrollment [:bot-id :job-id :issue-id :project-id :initiative-id :profile-cid :schedule-cid :provider :model :executor :grant-cid])
      {:slot slot :attempt-id (str (java.util.UUID/randomUUID)) :run-id (str "peer-" (:cycle-id grant) "-" n) :input-sha (:input-sha plan)})
     keys (o/keys-for (:bot-id req) (:job-id req) slot)
     saved-file (str root "/result-" n ".edn") existing ((:read transport) (:occurrence keys))
     _ (when (and (= "admitted" (:state existing)) (not (.isFile (io/file saved-file))))
         ;; Read-only original-session reconciliation; never resubmit an uncertain turn.
         (let [history (call! "history" {:botId leader :sessionId session} (str "recovery-" n))
               reply (some #(when (and (= "assistant" (:role %)) (= id (:parentId %))
                          (= "meta" (:provider %)) (= (:model grant) (:model %))
                          (= (:speaker plan) (:speakerBotId %)) (= n (get-in % [:peer :turn]))) %) (:messages history))]
          (when reply
           (h/durable! saved-file (pr-str {:state "completed" :provider "meta" :model (:model grant) :text (:text reply)
            :muse-run-id (:runId reply) :binding (:request existing) :usage (:usage reply) :usageCoverage (:usageCoverage reply)})))))
     _ (when (and (= "admitted" (:state existing)) (.isFile (io/file saved-file)))
          (o/reconcile! transport (:request existing) existing (edn/read-string (slurp saved-file))))
     invoke (fn []
      (let [result (call! "turn" {:schema "awai.bot-chat-request.v1" :botId leader :sessionId session :requestId id
                     :model (:model grant) :text (:prompt plan) :peer {:cycleId (:cycle-id grant) :turn n :admission req}} (str "turn-" n))
            _ (assert (and (= "completed" (:state result)) (= (:speaker plan) (:speakerBotId result))
                           (= (:cycle-id grant) (get-in result [:peer :cycleId]))))
            value {:state "completed" :provider "meta" :model (:model grant) :text (:text result) :muse-run-id (:runId result)
                   :binding req :usage (:usage result) :usageCoverage (:usageCoverage result)}]
       (h/durable! (str root "/agent-result-" n ".json") (j/generate-string result))
       (h/durable! saved-file (pr-str value)) value))
     outcome (o/dispatch! (assoc transport :invoke-once invoke) req node (System/currentTimeMillis))]
     (if (contains? #{"completed" "already-completed"} (:state outcome))
      (let [record (:record outcome) saved (when (.isFile (io/file saved-file)) (edn/read-string (slurp saved-file)))
            turn {:turn n :speaker (:speaker plan) :state "completed" :text (get-in record [:result :text])
                  :runId (get-in record [:result :muse-run-id]) :usage (:usage saved) :usageCoverage (:usageCoverage saved)}
            next (conj turns turn)]
        (summary! (if (= (count next) (:max-turns grant)) "completed" "progress") next)
        (recur next))
      (summary! "unknown" turns)))))))
