(ns itonami.otehon.occurrence
  "Crash-fault occurrence protocol for an authenticated, linearizable KV adapter.
  Plans are not authority: only a successful backend transaction admits work.
  No expiring claims, takeover, automatic retry, or external-effect tools."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]
            [itonami.otehon.job-contract :as job]
            [itonami.otehon.bundle :as bundle]))

(defn encode [v] (bundle/sorted-edn v))
(defn digest [v] (hio/sha256-utf8 (encode v)))
(defn keys-for [bot job slot]
  (let [scope (digest [bot job])]
    {:enrollment (str "/itonami/occurrence/v1/enrollment/" scope)
     :cursor (str "/itonami/occurrence/v1/cursor/" scope)
     ;; Source revisions and run IDs cannot make the same job/slot a new event.
     :occurrence (str "/itonami/occurrence/v1/run/" (digest [bot job slot]))}))
(defn- text? [s] (and (string? s) (not (str/blank? s)) (<= (count s) 160)))
(defn- sha? [s] (and (string? s) (boolean (re-matches #"[a-f0-9]{64}" s))))
(defn enrollment-valid? [e]
  (and (= "itonami.occurrence-enrollment.v1" (:schema e))
       (every? #(text? (get e %)) [:bot-id :job-id :issue-id :project-id :initiative-id :profile-cid :schedule-cid :model])
       (if (= "bounded-job-v1" (:executor e))
         (and (= "none" (:provider e)) (= "deterministic" (:model e))
              (= "job-result-metadata-only" (:data-class e))
              (job/valid-grant? (:grant e)) (= (:grant-cid e) (job/grant-cid (:grant e)))
              (= (:capabilities e) (get-in e [:grant :capabilities])))
         (and (contains? #{nil "muse"} (:executor e))
              (= "meta" (:provider e)) (= ["inference_muse"] (:capabilities e))
              (contains? #{"public-test-only" "public-readiness-only"} (:data-class e))))
       (contains? #{nil "skip-completed-only"} (:missed-slot-policy e))
       (vector? (:nodes e)) (seq (:nodes e))
       (= (count (:nodes e)) (count (distinct (:nodes e))))
       (every? text? (:nodes e))
       ;; Interval scheduling only: no implicit timezone or per-bot defaults.
       (= "interval" (get-in e [:schedule :type]))
       (integer? (get-in e [:schedule :every-ms]))
       (<= 1000 (get-in e [:schedule :every-ms]) 31536000000)
       (integer? (:initial-slot e)) (<= 0 (:initial-slot e) 9007199254740991)))

(defn admit-plan [enrollment cursor request authenticated-node now-ms]
  (let [{:keys [bot-id job-id slot attempt-id input-sha]} request
        ks (keys-for bot-id job-id slot)
        previous (:slot cursor)
        period (get-in enrollment [:schedule :every-ms] 0)
        expected (if cursor (+ (or previous 0) period) (:initial-slot enrollment))
        aligned? (and (integer? slot) (pos? period) (<= expected slot)
                      (zero? (mod (- slot (:initial-slot enrollment 0)) period)))
        acceptable-slot? (or (= slot expected)
                             (and (= "skip-completed-only" (:missed-slot-policy enrollment)) aligned?))
        bound [:bot-id :job-id :issue-id :project-id :initiative-id :profile-cid :schedule-cid :provider :model :executor :grant-cid]]
    (cond
      (not (enrollment-valid? enrollment)) {:error "enrollment-invalid"}
      (not (some #{authenticated-node} (:nodes enrollment))) {:error "node-not-enrolled"}
      (not= (select-keys enrollment bound) (select-keys request bound)) {:error "binding-mismatch"}
      (not (and (text? attempt-id) (sha? input-sha))) {:error "attempt-invalid"}
      (and cursor (not= "completed" (:state cursor))) {:error "previous-outcome-unknown-no-retry"}
      (not (and (integer? slot) acceptable-slot? (<= 0 slot now-ms 9007199254740991))) {:error "slot-not-due-or-out-of-order"}
      :else
      (let [claim {:schema "itonami.occurrence.v1" :state "admitted" :request request
                   :node authenticated-node :enrollment-sha (digest enrollment)}
            position {:state "admitted" :slot slot :attempt-id attempt-id :occurrence (:occurrence ks)}]
        {:claim claim :position position :keys ks
         :transaction {:compare {(:enrollment ks) (encode enrollment)
                                 (:cursor ks) (when cursor (encode cursor))
                                 (:occurrence ks) nil}
                       :put {(:occurrence ks) (encode claim) (:cursor ks) (encode position)}}}))))

(defn completion-plan [enrollment claim position result]
  (let [req (:request claim) ks (keys-for (:bot-id req) (:job-id req) (:slot req))]
    (cond
      (not= "admitted" (:state claim)) {:error "claim-not-admitted"}
      (or (not= (:enrollment-sha claim) (digest enrollment))
          (not= position {:state "admitted" :slot (:slot req) :attempt-id (:attempt-id req) :occurrence (:occurrence ks)}))
      {:error "fence-mismatch"}
      (not (and (= "completed" (:state result)) (= (:provider req) (:provider result)) (= (:model req) (:model result))
                (every? #(= (get req %) (get-in result [:binding %]))
                        [:attempt-id :input-sha :run-id :slot :bot-id :job-id :profile-cid :schedule-cid :issue-id :project-id :initiative-id :executor :grant-cid])
                (string? (:text result)) (<= 1 (count (:text result)) 32768)))
      {:error "outcome-unknown-no-retry"}
      :else
      (let [value {:state "completed" :text (:text result) :sha256 (hio/sha256-utf8 (:text result))
                   :cid (bundle/cid-raw (:text result)) :muse-run-id (:muse-run-id result)}
            done (assoc claim :state "completed" :result value)
            cursor {:state "completed" :slot (:slot req) :occurrence (:occurrence ks) :result-sha (:sha256 value)}]
        {:completed done :transaction {:compare {(:enrollment ks) (encode enrollment)
                                                (:occurrence ks) (encode claim) (:cursor ks) (encode position)}
                                      :put {(:occurrence ks) (encode done) (:cursor ks) (encode cursor)}}}))))

(defn dispatch!
  "Trusted host supplies :read (linearizable), :transact (atomic CAS) and
  :invoke-once (gated real adapter). Never calls inference after uncertain txn.
  A durable admission survives client/node restart; unknown remains frozen."
  [{:keys [read transact invoke-once]} request authenticated-node now-ms]
  (let [ks (keys-for (:bot-id request) (:job-id request) (:slot request))]
    (try
      (let [existing (read (:occurrence ks))]
        (if existing
          (if (not= (dissoc request :attempt-id) (dissoc (:request existing) :attempt-id))
            {:state "refused" :reason "occurrence-input-conflict" :invoked false}
            {:state (if (= "completed" (:state existing)) "already-completed" "unknown") :record existing :invoked false})
          (let [enrollment (read (:enrollment ks)) cursor (read (:cursor ks))
                plan (admit-plan enrollment cursor request authenticated-node now-ms)]
            (if (:error plan) {:state "refused" :reason (:error plan) :invoked false}
              (if-not (true? (:succeeded (transact (:transaction plan))))
                {:state "unknown" :reason "admission-not-confirmed" :invoked false}
                (let [result (invoke-once)
                      final (completion-plan enrollment (:claim plan) (:position plan) result)]
                  (if (:error final)
                    {:state "unknown" :reason (:error final) :invoked true}
                    (if (true? (:succeeded (transact (:transaction final))))
                      {:state "completed" :record (:completed final) :invoked true}
                      {:state "unknown" :reason "publication-not-confirmed" :invoked true}))))))))
      (catch #?(:lpy python/Exception :clj Exception :cljs :default) _
        {:state "unknown" :reason "transport-or-executor-uncertain-no-retry" :invoked "unknown"}))))

(defn reconcile!
  "Publish a recovered completed result under the ORIGINAL claim/token.
  Never invokes a model, releases a claim, changes owner or advances on unknown."
  [{:keys [read transact authenticated-node]} request original-claim recovered-result]
  (let [ks (keys-for (:bot-id request) (:job-id request) (:slot request))]
    (try
      (let [current (read (:occurrence ks))]
        (cond
          (or (not= request (:request original-claim)) (not= authenticated-node (:node original-claim)))
          {:state "unknown" :reason "original-owner-and-request-required" :invoked false}
          (= "completed" (:state current)) {:state "already-completed" :record current :invoked false}
          (not= current original-claim) {:state "unknown" :reason "original-claim-required" :invoked false}
          :else (let [p (completion-plan (read (:enrollment ks)) current (read (:cursor ks)) recovered-result)]
                  (if (or (:error p) (not (true? (:succeeded (transact (:transaction p))))))
                    {:state "unknown" :reason (or (:error p) "publication-not-confirmed") :invoked false}
                    {:state "completed" :record (:completed p) :invoked false}))))
      (catch #?(:lpy python/Exception :clj Exception :cljs :default) _
        {:state "unknown" :reason "reconciliation-unavailable" :invoked false}))))
