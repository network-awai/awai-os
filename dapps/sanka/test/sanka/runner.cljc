(ns sanka.runner
  "Runs the shared cases and scenarios. Each platform only parses the JSON and exits."
  (:require [sanka.core :as core]))

(def functions
  {"check-order" core/check-order
   "check-receipt" core/check-receipt
   "check-acceptance" core/check-acceptance
   "transition" core/transition
   "reservation" core/reservation
   "terminal?" core/terminal?
   "walk" core/walk
   "balance-view" core/balance-view
   "total" core/total})

(defn- plain [value]
  (cond
    (map? value) (into {} (map (fn [[k v]] [(name k) (plain v)]) value))
    (sequential? value) (mapv plain value)
    (keyword? value) (name value)
    :else value))

(defn- subset-of?
  "True when every key the case states has the stated value. A case need not state them all."
  [want got]
  (and (map? got)
       (every? (fn [[k v]] (= v (get got k))) want)))

(defn- case-failure [c]
  (let [got (plain (apply (get functions (:fn c)) (:args c)))
        want (plain (:expect c))]
    (when-not (= got want)
      (str (:fn c) " " (pr-str (:args c)) " got " (pr-str got) " want " (pr-str want)))))

(defn- scenario-failure [s side]
  (let [walked (plain (core/walk (get-in s [side :events])))
        want (plain (get-in s [side :expect]))]
    (when-not (subset-of? want walked)
      (str (:name s) " " (name side) " got " (pr-str walked) " want " (pr-str want)))))

(defn- full-walk-failures
  "Every state the table can reach has to be reached by some scenario."
  [scenarios]
  (let [visit (fn [states step]
                (conj states (:state (core/transition (peek states) (:event step) (:facts step)))))
        reached (set (mapcat (fn [s]
                               (mapcat (fn [side]
                                         (reduce visit ["proposed"] (get-in s [side :events])))
                                       [:ok :refused]))
                             scenarios))
        all ["proposed" "approved" "denied" "refused" "reserved" "executing" "expired" "receipted"
             "failed" "accepted" "rejected" "released" "submitted" "finalized" "ambiguous"
             "recorded"]]
    (keep (fn [state] (when-not (contains? reached state) (str "no scenario reaches " state))) all)))

(defn run
  "Returns the failure messages and the number of checks."
  [cases scenarios]
  (let [failures (concat (keep case-failure cases)
                         (keep #(scenario-failure % :ok) scenarios)
                         (keep #(scenario-failure % :refused) scenarios)
                         (full-walk-failures scenarios))]
    {:failures (vec failures)
     :checks (+ (count cases) (* 2 (count scenarios)))}))
