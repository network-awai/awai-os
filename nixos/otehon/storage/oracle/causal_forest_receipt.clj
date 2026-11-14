(load-string (first (clojure.string/split (slurp "nixos/otehon/storage/oracle/governed_forest_receipt.clj") #"\(store/init! receipt-dir\)")))
(require '[kotobase.storage.core :as storage] '[kotobase.core :as core] '[kotobase.causal-commit :as causal])
(def stage-blocks (atom {}))
(def forest-handle (atom nil))
(def refs (atom {}))
(defn backend []
 (reify storage/IBlockStore
  (-put-blocks! [_ blocks] (doseq [{:keys [cid bytes]} blocks] (swap! stage-blocks assoc cid bytes)) (mapv :cid blocks))
  (-get-blocks [_ cids] (into {} (keep (fn [cid] (when-let [bytes (or (get @stage-blocks cid) (when @forest-handle (catalog/get-group-block @forest-handle cid)))] [cid bytes]))) cids))
 storage/IRefStore
  (-read-ref [_ name] (get @refs name))
  (-compare-and-set-ref! [_ name expected next] (locking refs (let [old (get @refs name)] (if (= expected (:cid old)) (let [value {:cid next :version (inc (or (:version old) 0))}] (swap! refs assoc name value) {:published? true :current next :version (:version value)}) {:published? false :current (:cid old) :version (:version old)}))))
 storage/IBackendCapabilities
  (-capabilities [_] #{:immutable-blocks :cid-addressed-read :conditional-ref :single-writer-ref})))
(defn db [] (core/open {:storage (backend) :encrypt-fn identity :decrypt-fn identity :blind-fn pr-str :visible? (constantly true)}))
(def database (db))
(def receipt-output (or (System/getenv "CAUSAL_RECEIPT_OUTPUT") ".agent-output/receipt-sink/output"))
(store/init! (str receipt-output "/store"))
(def recorded (atom nil))
(defn actual-sink [receipt]
 (let [ack ((causal/execution-receipt-sink database {:expected-basis-cid nil :receipt-cid-fn id/value-cid}) receipt)
       commit (:receipt/commit-cid ack)
       blocks (mapv (fn [[cid bytes]] {:cid cid :bytes (byte-array (map unchecked-byte bytes))}) @stage-blocks)]
  (writer/put-ipld-blocks! (str receipt-output "/store") "causal-receipt" commit blocks (str receipt-output "/stage") tool)
  (reset! forest-handle (catalog/recover-group (str receipt-output "/store") "causal-receipt"))
  (reset! stage-blocks {})
  (let [reread (causal/receipt-at (db) commit (:receipt/cid ack))]
   (assert (= [receipt] (:receipt/records reread)))
   (reset! recorded ack)
   ack)))
(def injected (with-redefs [writer/put-ipld-blocks! (fn [& _] (throw (ex-info "injected-publish-failure" {})))]
 (try (governed/execute! (assoc opts :commit! actual-sink)) :unexpected-return (catch Exception e (.getMessage e)))))
(assert (= "injected-publish-failure" injected))
(assert (nil? @recorded))
(reset! stage-blocks {})
(def result (governed/execute! (assoc opts :commit! actual-sink)))
(assert (= 1 (count (:rows result))))
(spit (str receipt-output "/ids.edn") (pr-str @recorded))
(prn {:receipt (:receipt/cid @recorded) :commit (:receipt/commit-cid @recorded) :rows (:rows result) :pass true})
(shutdown-agents)
