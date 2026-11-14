;; Hosted reference composition; no Native or production key-custody claim.
(require '[clojure.string :as str] '[kotoba.value.codec :as value] '[kotobase.engine.identity :as ident])
(load-string (first (str/split (slurp "nixos/otehon/storage/oracle/postgres_witness_receipt.clj") #"\(case \(first \*command-line-args\*\)" 2)))
(let [s (slurp "nixos/otehon/storage/oracle/postgres_witness_signed_basis.clj")]
 (load-string (first (str/split (subs s (.indexOf s "(def seed")) #"\(case \(first \*command-line-args\*\)" 2))))
;; This policy fixture used the Prolly engine's SHA-256 hex reference digest.
(defn basis-engine [put! get-block]
 (prolly/prolly-engine {:put! put! :get-fn get-block :blind-fn #(str "blind-fixture:" %) :encrypt-fn identity :decrypt-fn identity :digest-fn sha}))
(defn build-envelope [db policy-cid]
 (let [get-block #(storage/get-block db %) eng (basis-engine (fn [& _] (throw (ex-info "read only" {}))) get-block)
       state (engine/restore-state eng policy-basis) checkpoint (engine/checkpoint eng (engine/open-snapshot eng state)) request (:current-request state)
       commit (ident/logical-commit {:format ident/logical-commit-format :database-id (:database-id checkpoint) :epoch (:epoch checkpoint) :parents [] :tx-root (:tx-root request) :logical-checkpoint-root (:logical-checkpoint-root checkpoint) :schema-root "fixture-schema" :model-contract-root "fixture-model" :admission-policy-root policy-cid})
       logical (cid-str (ident/logical-commit-string commit))
       publication (ident/physical-publication {:format ident/physical-publication-format :logical-commit-root logical :engine-profile :prolly :engine-format 3 :physical-root policy-basis})
       payload (ident/signature-payload {:logical-commit-root logical :issuer "fixture-issuer" :key-id "fixture-key"})]
  {:commit commit :publication publication :signature (ed/sign (ed/secret-key! seed) (ubytes payload))}))
(defn admit-signed! [db envelope opts expected-key]
 (let [result (validate-basis! #(storage/get-block db %) envelope expected-key)
       request (:request opts)]
  (ensure! (= (:physical-root result) (:base/commit request) (:cid (storage/-read-ref db "policy"))) "signed basis does not match request")
  (ensure! (= (:admission-policy-root (:commit envelope)) (:authority/policy request)) "signed policy mismatch")
  true))
(defn execute-signed! [db envelope opts expected-key]
 (admit-signed! db envelope opts expected-key)
 (governed/execute! opts))
(case (first *command-line-args*)
 "write"
 (do (ensure! (.mkdir (java.io.File. staging)) "staging exists") (store/init! store-path)
  (let [initial (:root (store/read-store store-path)) _ (#'pg/query! psql service (str "INSERT INTO awai_witness.root(store_id,root) VALUES ('" store-id "',decode('" (#'pg/wire initial) "','hex'));\n"))
        db (backend (verifier nil limits)) _ (storage/-put-blocks! db (fixture-blocks))
        _ (ensure! (:published? (storage/-compare-and-set-ref! db "policy" nil policy-basis)) "policy basis publication failed")
        opts (ctx db) policy-cid (get-in opts [:request :authority/policy]) envelope (build-envelope db policy-cid) b (encode-block envelope) tx (blocks/open-transaction db)]
   ((:put! tx) (:cid b) (:bytes b))
   (ensure! (:published? ((:publish! tx) "signed-policy-basis" nil (:cid b)
       (fn [get-block cid] (validate-basis! get-block (load-envelope get-block cid) public-key) true))) "signed basis publication failed")
   (spit (str base "/signed-policy.edn") (pr-str {:basis (:cid b) :policy policy-cid}))
   (prn {:mode :write :basis (:cid b) :policy policy-cid :pass true})))
 "read"
 (let [db (backend (verifier nil limits)) ids (edn/read-string (slurp (str base "/signed-policy.edn"))) cid (:cid (storage/-read-ref db "signed-policy-basis"))
       envelope (load-envelope #(storage/get-block db %) cid) opts (ctx db) evaluations (atom 0) commits (atom 0) actual-evaluate (:evaluate! opts)
       wrapped (assoc opts :evaluate! (fn [& args] (swap! evaluations inc) (apply actual-evaluate args))
                          :commit! (fn [& _] (swap! commits inc) (throw (ex-info "unexpected commit" {}))))]
  (ensure! (= cid (:basis ids)) "basis ref mismatch")
  (ensure! (denied? #(execute-signed! db (assoc envelope :signature (vec (repeat 64 0))) wrapped public-key)) "bad signature accepted")
  (ensure! (denied? #(execute-signed! db (assoc-in envelope [:publication :physical-root] cid) wrapped public-key)) "wrong physical root accepted")
  (ensure! (denied? #(execute-signed! db envelope (assoc-in wrapped [:request :authority/policy] "wrong-policy") public-key)) "wrong policy accepted")
  (ensure! (and (zero? @evaluations) (zero? @commits)) "invalid basis reached evaluation or commit")
  (let [ack (atom nil) result (execute-signed! db envelope (assoc opts :commit! (sink db "signed-receipt" ack (:request opts) (:manifest opts))) public-key)]
   (ensure! (= 1 (count (:rows result))) "query result missing")
   (spit (str base "/signed-receipt.edn") (pr-str @ack))
   (prn {:mode :read :basis cid :policy (:policy ids) :invalid-evaluations @evaluations :invalid-commits @commits :rows (count (:rows result)) :receipt (:receipt/cid @ack) :pass true})))
 "verify"
 (let [db (backend (verifier nil limits)) ids (edn/read-string (slurp (str base "/signed-policy.edn")))
       ack (edn/read-string (slurp (str base "/signed-receipt.edn"))) envelope (load-envelope #(storage/get-block db %) (:cid (storage/-read-ref db "signed-policy-basis")))
       opts (ctx db) commit (:cid (storage/-read-ref db "signed-receipt"))
       receipt (first (:receipt/records (causal/receipt-at (open-db db) commit (:receipt/cid ack))))]
  (ensure! (= (:basis ids) (:cid (storage/-read-ref db "signed-policy-basis"))) "basis ref changed")
  (ensure! (= commit (:receipt/commit-cid ack)) "receipt ref changed")
  (admit-signed! db envelope opts public-key)
  (ensure! (= (id/value-cid (:request opts)) (:request/digest receipt)) "request not bound to receipt")
  (ensure! (= (id/value-cid (:manifest opts)) (:execution/manifest receipt)) "manifest not bound to receipt")
  (ensure! (= :allow (:authority/decision receipt)) "receipt is not allow")
  (verify-bundle! #(storage/get-block db %) receipt policy-basis)
  (ensure! (true? (verify-signature {:record :execution-receipt :tenant "test" :epoch 7 :payload-cid (id/payload-cid receipt) :signature (:signature receipt)})) "invalid recovered receipt signature")
  (prn {:mode :verify :basis (:basis ids) :receipt (:receipt/cid ack) :signature :verified :pass true}))
 (throw (ex-info "write, read or verify required" {})))
(shutdown-agents)
