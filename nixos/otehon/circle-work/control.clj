(ns circle-work.control
 (:require [cheshire.core :as j] [clojure.edn :as edn] [itonami.otehon.etcd :as e] [itonami.otehon.occurrence :as o]))
(let [{:keys [op config enrollment request result budgetKey dailyCap]} (j/parse-string (slurp *in*) true)
      c (e/client (edn/read-string (slurp config)))
      ks (when request (o/keys-for (:bot-id request) (:job-id request) (:slot request)))
      emit #(println (j/generate-string %))]
 (case op
  "register" (let [en enrollment _ (assert (and (= "root" (:authenticated-node c)) (o/enrollment-valid? en) (clojure.string/starts-with? (:job-id en) "goal-")))
                   k (:enrollment (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en))) old ((:read c) k)]
               (if old (assert (= old en) "enrollment differs")
                (assert (:succeeded ((:transact c) {:compare {k nil} :put {k (o/encode en)}}))))
               (emit {:registered (= en ((:read c) k))}))
  "budget" (emit (or ((:read c) budgetKey) {:entries []}))
  "read" (emit {:enrollment ((:read c) (:enrollment ks)) :cursor ((:read c) (:cursor ks)) :record ((:read c) (:occurrence ks))})
  "admit" (let [en ((:read c) (:enrollment ks)) cursor ((:read c) (:cursor ks)) prior ((:read c) (:occurrence ks))
                budget ((:read c) budgetKey) _ (assert (and (<= 1 dailyCap 4) (clojure.string/starts-with? budgetKey "/itonami/occurrence/v1/cursor/")))
                entries (or (:entries budget) []) plan (o/admit-plan en cursor request (:authenticated-node c) (System/currentTimeMillis))]
            (cond prior (emit {:state (if (= "completed" (:state prior)) "already-completed" "unknown") :record prior})
             (:error plan) (emit {:state "held" :reason (:error plan)})
             (>= (count entries) dailyCap) (emit {:state "budget-held"})
             :else (let [txn (:transaction plan) next {:schema "itonami.circle-budget.v1" :entries (conj entries (:run-id request))}
                         tx (-> txn (assoc-in [:compare budgetKey] (when budget (o/encode budget))) (assoc-in [:put budgetKey] (o/encode next)))]
                     (emit {:state (if (true? (:succeeded ((:transact c) tx))) "admitted" "unknown")}))))
  "verify" (let [en ((:read c) (:enrollment ks)) claim ((:read c) (:occurrence ks)) pos ((:read c) (:cursor ks))]
             (emit {:verified (and (= "admitted" (:state claim)) (= request (:request claim)) (= (:authenticated-node c) (:node claim))
                              (= (o/digest en) (:enrollment-sha claim)) (= pos {:state "admitted" :slot (:slot request) :attempt-id (:attempt-id request) :occurrence (:occurrence ks)}))}))
  "complete" (let [en ((:read c) (:enrollment ks)) claim ((:read c) (:occurrence ks)) pos ((:read c) (:cursor ks)) p (o/completion-plan en claim pos result)]
               (emit {:completed (and (nil? (:error p)) (true? (:succeeded ((:transact c) (:transaction p)))))}))
  (throw (ex-info "unsupported circle control operation" {}))))
