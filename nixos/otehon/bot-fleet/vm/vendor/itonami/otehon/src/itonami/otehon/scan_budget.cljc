(ns itonami.otehon.scan-budget
  "Block/byte/match budgets for awai fs reads, decided pure.

  Counts, never wall clock: this repo is developed on a machine running
  many agents at once, so a timing figure describes the machine
  (ayatori.pack bench rule, ADR-2608160100). Every range or scan reports
  how many blocks were verified, how many bytes crossed, and how many
  round trips it cost (ayatori.remote/stats shape); this namespace is
  the gate that refuses a plan whose counts exceed the declared budget.

  A budget is a plain map so shared cases stay runner-identical:
  {\"max-blocks\" n, \"max-bytes\" n, \"max-matches\" n}. Stats are
  {\"blocks\" b, \"bytes\" y, \"matches\" m, \"round-trips\" r}.
  Limits are inclusive: reaching exactly the max still answers."
  (:require [clojure.string :as str]))

(defn make-budget
  "Declare a budget. Missing keys default to 0, which refuses any read."
  [max-blocks max-bytes max-matches]
  {"max-blocks" (long (or max-blocks 0))
   "max-bytes" (long (or max-bytes 0))
   "max-matches" (long (or max-matches 0))})

(defn empty-stats
  "No read yet: every counter is 0."
  []
  {"blocks" 0 "bytes" 0 "matches" 0 "round-trips" 0})

(defn- num [x]
  (cond (number? x) (long x)
        (string? x) (try (long (parse-long (str/trim (str x))))
                         (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ 0))
        :else 0))

(defn add-read
  "Add one verified read to stats: blocks (usually 1), bytes, and one
  round trip. Counts stay integers; a corrupt pack source failure is not
  counted here (the caller skips it, ayatori.pack rule)."
  [stats blocks bytes]
  (let [s (or stats (empty-stats))]
    (-> s
        (assoc "blocks" (+ (num (get s "blocks")) (num blocks)))
        (assoc "bytes" (+ (num (get s "bytes")) (num bytes)))
        (assoc "round-trips" (+ (num (get s "round-trips")) (if (pos? (num blocks)) 1 0))))))

(defn add-matches
  "Add n answer rows to stats."
  [stats n]
  (let [s (or stats (empty-stats))]
    (assoc s "matches" (+ (num (get s "matches")) (num n)))))

(defn over-budget?
  "True when any counter exceeds its budget max."
  [budget stats]
  (let [b (or budget (make-budget 0 0 0))
        s (or stats (empty-stats))]
    (or (> (num (get s "blocks")) (num (get b "max-blocks")))
        (> (num (get s "bytes")) (num (get b "max-bytes")))
        (> (num (get s "matches")) (num (get b "max-matches"))))))

(defn check
  "Gate one stats snapshot against a budget. Answers ok, or refused with
  the first exceeded dimension so the caller knows which bound to raise."
  [budget stats]
  (let [b (or budget (make-budget 0 0 0))
        s (or stats (empty-stats))
        blocks (num (get s "blocks"))
        bytes (num (get s "bytes"))
        matches (num (get s "matches"))]
    (cond (> blocks (num (get b "max-blocks")))
          {"ok" false "reason" "over-blocks" "stats" s}
          (> bytes (num (get b "max-bytes")))
          {"ok" false "reason" "over-bytes" "stats" s}
          (> matches (num (get b "max-matches")))
          {"ok" false "reason" "over-matches" "stats" s}
          :else {"ok" true "reason" "within-budget" "stats" s})))
