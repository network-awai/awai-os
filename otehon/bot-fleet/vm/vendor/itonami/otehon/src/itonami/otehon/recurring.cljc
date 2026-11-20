(ns itonami.otehon.recurring
  "Pure recurring readiness planning. Original effectful jobs stay held.
  Sleep skips elapsed, unstarted slots; an admitted/unknown slot never moves."
  (:require [itonami.otehon.occurrence :as o]))
(defn plan [enrollment cursor now]
  (cond
    (not (o/enrollment-valid? enrollment)) {:state "held" :reason "invalid-enrollment"}
    (not (contains? #{"public-readiness-only" "job-result-metadata-only"} (:data-class enrollment)))
    {:state "held" :reason "supported-recurring-scope-required"}
    (not= "skip-completed-only" (:missed-slot-policy enrollment)) {:state "held" :reason "explicit-missed-slot-policy-required"}
    (and cursor (not= "completed" (:state cursor))) {:state "unknown" :slot (:slot cursor) :reason "original-owner-reconciliation-required"}
    (< now (:initial-slot enrollment)) {:state "waiting" :next-slot (:initial-slot enrollment)}
    :else
    (let [period (get-in enrollment [:schedule :every-ms])
          slot (+ (:initial-slot enrollment) (* period (quot (- now (:initial-slot enrollment)) period)))]
      (if (and cursor (<= slot (:slot cursor)))
        {:state "waiting" :next-slot (+ (:slot cursor) period)}
        {:state "due" :slot slot :skipped-unstarted (max 0 (dec (quot (- slot (if cursor (:slot cursor) (- (:initial-slot enrollment) period))) period)))}))))
