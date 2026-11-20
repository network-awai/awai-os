(ns meiji.fleet-drain
  "CAS-fenced maintenance hold for the two existing VM owners. Job identity,
   grants, schedules and completed results are restored byte-for-byte."
  (:require [clojure.edn :as edn] [cheshire.core :as json]
            [meiji.fleet-audit :as audit] [meiji.host :as host]
            [meiji.policy :as p] [meiji.recovery :as recovery]
            [itonami.otehon.etcd :as etcd] [itonami.otehon.occurrence :as occurrence]))

(defn held-value [enrollment digest]
  (p/require! (and (= "awai-vm-physics-v1" (:vm-executor enrollment))
                   (seq (:nodes enrollment))
                   (every? #{"vm-levi" "vm-benjamin"} (:nodes enrollment))) "fixed-vm-owners-required")
  (assoc enrollment :nodes [] :meiji-recovery-hold (str "AWAI-2820:" digest)))

(defn apply-plan! [client entries digest restore?]
  (mapv
    (fn [{:keys [key cursor-key old cursor]}]
      (let [held (held-value old digest) expected (if restore? held old) replacement (if restore? old held)
            live ((:read client) key) position ((:read client) cursor-key)]
        (p/require! (and (or (nil? cursor) (= "completed" (:state cursor)))
                         (= position cursor)) "cursor-changed-or-uncertain-preserve-owner")
        (if (= live replacement)
          {:job (:job-id old) :state "already-applied"}
          (do (p/require! (= live expected) "enrollment-changed-preserve")
              (p/require! (:succeeded ((:transact client)
                            {:compare {key (occurrence/encode expected)
                                       cursor-key (when cursor (occurrence/encode cursor))}
                             :put {key (occurrence/encode replacement)}})) "drain-cas-conflict")
              (p/require! (= replacement ((:read client) key)) "drain-readback-unconfirmed")
              {:job (:job-id old) :state (if restore? "restored" "held")})))) entries))

(defn -main [& [phase config-path plan-path expected-digest]]
  (p/require! (contains? #{"prepare" "hold" "restore"} phase) "fixed-drain-phase-required")
  (let [cfg (edn/read-string (slurp config-path)) client (etcd/client cfg)]
    (p/require! (and (= "root" (:authenticated-node cfg)) (= "15997540139816619698" (:cluster-id cfg))) "original-root-authority-required")
    (if (= "prepare" phase)
      (let [enrollments (audit/rows (audit/read-prefix! cfg "/itonami/occurrence/v1/enrollment/"))
            entries (->> enrollments
                      (filter (fn [[_ value]] (= "awai-vm-physics-v1" (:vm-executor value))))
                      (sort-by key)
                      (mapv (fn [[key old]]
                              (held-value old "preparation")
                              (let [cursor-key (:cursor (occurrence/keys-for (:bot-id old) (:job-id old) (:initial-slot old)))
                                    cursor ((:read client) cursor-key)]
                                (p/require! (or (nil? cursor) (= "completed" (:state cursor))) "unknown-original-run-preserve")
                                {:key key :cursor-key cursor-key :old old :cursor cursor}))))]
        (p/require! (= 5 (count entries)) "original-five-vm-jobs-required")
        (recovery/private-write! plan-path (pr-str {:schema "meiji.fenced-drain.v1" :entries entries}))
        (println (json/generate-string {:prepared true :jobs (count entries) :sha256 (host/sha256 plan-path)})))
      (let [_ (p/require! (= expected-digest (host/sha256 plan-path)) "drain-plan-pin-mismatch")
            plan (edn/read-string (slurp plan-path))
            _ (p/require! (and (= "meiji.fenced-drain.v1" (:schema plan)) (= 5 (count (:entries plan)))) "invalid-drain-plan")]
        (println (json/generate-string {:phase phase :jobs (apply-plan! client (:entries plan) expected-digest (= phase "restore"))}))))))
