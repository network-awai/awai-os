(ns itonami.otehon.collect
  "The outbox collector core (JUN-410's 2-layer shadow-write design):
  producers cannot hold signing keys, so they write UNSIGNED rows to an
  outbox; this pure core turns pending rows into signed, appended,
  receipted rows and reports every disagreement. Faithful port of
  itonami.agent.collect: the row shape is the contract with the producers
  ({:id ... :kind ... :canonical ... :status \"pending\" ...}, keyword keys)
  and the done form adds :transfer-id / :signed-by / :appended-at.

  Pure except for injected fns (`sign-fn`, `append-fn`): no I/O, no crypto,
  no key handling. Fail-closed rules, all of them load-bearing:
  - a row without a signature is never done;
  - a row whose append did not return a receipt is never done;
  - a failed row STAYS pending for the next round."
  (:require [clojure.string :as str]))

(defn- bad [reason & [extra]]
  (merge {:ok false :reason reason} extra))

(defn certify-row
  "Sign and append ONE pending row through the injected fns. Returns
  {:ok true :row <done row>} or a named refusal; a refusal leaves the input
  row untouched (still pending). A throwing signer/appender surfaces as
  :append-failed with the message, exactly as in the legacy."
  [row {:keys [sign-fn append-fn]}]
  (cond
    (not= "pending" (:status row)) (bad :not-pending)
    (not (and (string? (:id row)) (seq (:id row)))) (bad :bad-id)
    (not (and (string? (:canonical row)) (seq (:canonical row)))) (bad :bad-canonical)
    :else
    (try
      (let [sig (sign-fn (:canonical row))]
        (if (and (string? sig) (seq sig))
          (let [receipt (append-fn row sig)]
            (if (and (map? receipt)
                     (string? (:transfer-id receipt))
                     (seq (:transfer-id receipt)))
              {:ok true
               :row (assoc row
                           :status "done"
                           :transfer-id (:transfer-id receipt)
                           :signed-by [(:signed-by receipt "unknown")]
                           :appended-at (get receipt :appended-at nil))}
              (bad :no-receipt)))
          (bad :no-signature)))
      (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
        (bad :append-failed {:detail (str (ex-message e))})))))

(defn certify
  "Map certify-row over rows. Returns {:rows [...] :refusals [...]} where
  :rows is the input order with done rows replaced and refusals name the row
  and the reason. Refused rows stay in :rows unchanged (pending)."
  [rows opts]
  (reduce (fn [acc row]
            (let [r (certify-row row opts)]
              (if (:ok r)
                (update acc :rows conj (:row r))
                (-> acc
                    (update :rows conj row)
                    (update :refusals conj {:id (:id row) :reason (:reason r)})))))
          {:rows [] :refusals []}
          rows))

(defn reconcile
  "The shadow-period consistency check between what producers wrote (`rows`)
  and what landed (`appended`, each {:id :canonical :transfer-id}). Returns
  a vector of named problems (never silent): pending leftovers, unknown
  appends, canonical divergence, receipt divergence. An empty vector is clean."
  [rows appended]
  (let [by-id (into {} (map (juxt :id identity) rows))]
    (as-> [] probs
      (reduce (fn [p r] (cond-> p (not= "done" (:status r))
                          (conj {:id (:id r) :refusal :still-pending}))) probs rows)
      (reduce (fn [p a]
                (let [r (get by-id (:id a))]
                  (cond
                    (nil? r) (conj p {:id (:id a) :refusal :appended-but-unknown})
                    (not= (:canonical r) (:canonical a)) (conj p {:id (:id a) :refusal :canonical-mismatch})
                    (not= (:transfer-id r) (:transfer-id a)) (conj p {:id (:id a) :refusal :receipt-mismatch})
                    :else p)))
              probs appended))))
