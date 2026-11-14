;; Hosted fixture: verify persisted signed proof at the bound query entry.
(load-file "nixos/otehon/storage/oracle/proof_location_common.clj")
(defn guard-for [location-value proof-transform expected-policy events]
  (fn [{m :manifest r :request}]
    (swap! events conj :basis)
    (verify-location! m location-value signed-proof-cid signed-basis expected-policy)
    (assert (= (:base/commit r) signed-basis))
    (let [proof-bytes (catalog/get-group-block h signed-proof-cid)
          _ (when-not proof-bytes (throw (ex-info "missing proof" {:type :missing-proof})))
          _ (writer/validate-ipld-block {:cid signed-proof-cid :bytes proof-bytes})
          proof (proof-transform (clojure.edn/read-string (String. ^bytes proof-bytes "UTF-8")))
          verdict (frontier/accept-head {:candidate-root (:root proof) :path [proof]
                                        :verify-entry #(verify-proof % checkpoint expected-policy)})]
      (= :initialized (:status verdict)))))
(defn negative! [loc transform expected-policy]
  (let [events (atom [])
        probe (-> opts
                  (assoc-in [:authority :consume-nonce!] (fn [_] (swap! events conj :nonce) true))
                  (assoc :authorize! (fn [_] (swap! events conj :authorize))
                         :evaluate! (fn [& _] (swap! events conj :evaluate))
                         :commit! (fn [_] (swap! events conj :commit))))
        refused (try (governed/execute-bound! probe (guard-for loc transform expected-policy events)) false
                     (catch Exception _ true))]
    (assert refused)
    (assert (= [:basis] @events))))
(negative! (assoc location :basis/proof "different-proof") identity signed-policy)
(negative! location #(assoc-in % [:commit :logical-checkpoint-root] "tampered") signed-policy)
(negative! location identity "different-policy")
(let [actual-get catalog/get-group-block]
  (with-redefs [catalog/get-group-block (fn [handle cid]
                                         (when-not (= cid signed-proof-cid) (actual-get handle cid)))]
    (negative! location identity signed-policy))
  (with-redefs [catalog/get-group-block (fn [handle cid]
                                         (if (= cid signed-proof-cid) (.getBytes "wrong" "UTF-8")
                                             (actual-get handle cid)))]
    (negative! location identity signed-policy)))
(def accepted (atom []))
(def admit! (guard-for location identity signed-policy accepted))
(def csrc (slurp "nixos/otehon/storage/oracle/causal_forest_receipt.clj"))
(assert (clojure.string/includes? csrc "@stage-blocks)]"))
(assert (= 2 (count (re-seq #"\(governed/execute! \(assoc opts :commit! actual-sink\)\)" csrc))))
(def csrc (-> csrc
  (clojure.string/replace "@stage-blocks)]" "@stage-blocks) blocks (into blocks [(block request) (block manifest) (block location)])]")
  (clojure.string/replace "(governed/execute! (assoc opts :commit! actual-sink))"
                          "(governed/execute-bound! (assoc opts :commit! actual-sink) admit!)")))
(load-string (subs csrc (inc (clojure.string/index-of csrc "\n"))))
(assert (= [:basis :basis] @accepted))
