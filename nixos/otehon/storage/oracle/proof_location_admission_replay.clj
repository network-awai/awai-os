;; Read-only replay against already published signed proof and causal receipt.
(require '[clojure.string :as str] '[clojure.edn :as edn])
(load-file "nixos/otehon/storage/oracle/proof_location_common.clj")
(def csrc (slurp "nixos/otehon/storage/oracle/causal_forest_receipt.clj"))
(load-string (first (str/split (subs csrc (inc (str/index-of csrc "\n"))) #"\(def receipt-output")))
(def receipt-dir (or (System/getenv "CAUSAL_RECEIPT_OUTPUT") (throw (ex-info "receipt output required" {}))))
(def ack (edn/read-string (slurp (str receipt-dir "/ids.edn"))))
(reset! forest-handle (catalog/recover-group (str receipt-dir "/store") "causal-receipt"))
(def stored (first (:receipt/records (causal/receipt-at (db) (:receipt/commit-cid ack) (:receipt/cid ack)))))
(assert (true? (verifier {:record :execution-receipt :tenant "test" :epoch 7
                          :payload-cid (id/payload-cid stored) :signature (:signature stored)})))
(defn guard [events change-proof]
  (fn [{m :manifest r :request}]
    (swap! events conj :basis)
    (verify-location! m location signed-proof-cid signed-basis signed-policy)
    (when-not (= (:base/commit r) signed-basis) (throw (ex-info "basis mismatch" {})))
    (let [raw (or (catalog/get-group-block h signed-proof-cid) (throw (ex-info "missing proof" {})))
          _ (writer/validate-ipld-block {:cid signed-proof-cid :bytes raw})
          proof (change-proof (edn/read-string (String. ^bytes raw "UTF-8")))
          verdict (frontier/accept-head {:candidate-root (:root proof) :path [proof]
                                        :verify-entry #(verify-proof % checkpoint signed-policy)})]
      (= :initialized (:status verdict)))))
(defn checked-options [events]
  (let [nonce (get-in opts [:authority :consume-nonce!]) auth (:authorize! opts) eval (:evaluate! opts)]
    (-> opts
        (assoc-in [:authority :consume-nonce!] (fn [n] (swap! events conj :nonce) (nonce n)))
        (assoc :authorize! (fn [q] (swap! events conj :authorize) (auth q))
               :evaluate! (fn [q d] (swap! events conj :evaluate) (eval q d))
               ;; No new receipt is written in this replay: only an already
               ;; recovered, signed and identical receipt is acknowledged.
               :commit! (fn [generated]
                          (swap! events conj :readback)
                          (when-not (= stored generated) (throw (ex-info "receipt mismatch" {})))
                          (when-not (= [stored] (:receipt/records (causal/receipt-at (db) (:receipt/commit-cid ack) (:receipt/cid ack))))
                            (throw (ex-info "receipt readback mismatch" {})))
                          ack)))))
(let [events (atom [])
      denied (try (governed/execute-bound! (checked-options events)
                     (guard events #(assoc-in % [:commit :logical-checkpoint-root] "changed")))
                  false (catch Exception _ true))]
  (assert denied) (assert (= [:basis] @events)))
(let [events (atom []) result (governed/execute-bound! (checked-options events) (guard events identity))]
  (assert (= [:basis :nonce :authorize :evaluate :readback] @events))
  (assert (= 1 (count (:rows result))))
  (assert (= (:receipt/cid ack) (id/value-cid (:execution/receipt result))))
  (prn {:source :existing-forest :new-publication false :events @events
        :proof signed-proof-cid :receipt (:receipt/cid ack) :tamper :refused :pass true}))
(shutdown-agents)
