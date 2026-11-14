(require '[clojure.string :as str])
(load-string (first (str/split (slurp "nixos/otehon/storage/oracle/postgres_witness_policy.clj") #"\(case \(first \*command-line-args\*\)" 2)))
(require '[kotobase.governed-execution :as governed] '[kotobase.execution-identity :as id]
         '[kotobase.execution-keys :as keys] '[kotobase.core :as core] '[kotobase.causal-commit :as causal]
         '[kotoba.value.codec :as codec] '[otehon.forest-writer :as writer])
(def issuer (vec (repeat 32 3)))
(def executor (vec (repeat 32 4)))
(defn payload-bytes [s] (mapv #(bit-and 255 %) (.getBytes s "UTF-8")))
(defn sign [which seed record] {:key/id which :key/algorithm :ed25519 :signature/value (ed/sign (ed/secret-key! seed) (payload-bytes (id/payload-cid record)))})
(def verify-signature (keys/verifier {:registry (keys/static-registry {{:role :issuer :tenant "test" :epoch 7} [{:key/id "issuer" :key/algorithm :ed25519 :key/material (ed/public-key issuer)}] {:role :executor :tenant "test" :epoch 7} [{:key/id "executor" :key/algorithm :ed25519 :key/material (ed/public-key executor)}]}) :verify-with (fn [{:keys [key payload-cid signature-value]}] (ed/verify (:key/material key) (payload-bytes payload-cid) signature-value))}))
(defn open-db [backend] (core/open {:storage backend :encrypt-fn identity :decrypt-fn identity :blind-fn pr-str :visible? (constantly true)}))
(defn overlay [db tx] (reify storage/IBlockStore
  (-put-blocks! [_ items] (mapv (fn [{:keys [cid bytes]}] ((:put! tx) cid bytes)) items))
  (-get-blocks [_ cids] (into {} (keep (fn [cid] (when-let [v ((:get-fn tx) cid)] [cid v]))) cids))
 storage/IRefStore
  (-read-ref [_ name] (storage/-read-ref db name))
  (-compare-and-set-ref! [_ name expected next] (throw (ex-info "overlay ref CAS forbidden" {})))
 storage/IBackendCapabilities
  (-capabilities [_] #{:immutable-blocks :cid-addressed-read :conditional-ref :single-writer-ref})))
(defn ctx [db]
 (let [basis (:cid (storage/-read-ref db "policy"))
       eng (prolly/prolly-engine {:put! (fn [& _] (throw (ex-info "readonly" {}))) :get-fn #(storage/get-block db %) :blind-fn #(str "blind-fixture:" %) :encrypt-fn identity :decrypt-fn identity :digest-fn sha})
       snap (engine/open-snapshot eng (engine/restore-state eng basis))
       p (policy/policy-of (mapv (fn [{:keys [e a v]}] {:e e :a (str a) :v_edn (pr-str v)}) (engine/scan eng snap ["kotobase.policy/read" nil nil])))
       pcid (policy/policy-cid p) resource (str "kotoba://basis/" basis) seed (vec (repeat 32 1))
       token (chain/root {:issuer-seed seed :grant {:caps #{[:datom/read-protected resource]} :before 1800000000} :caveats [] :next-seed (vec (repeat 32 2))})
       decision (chain/verify (chain/present token) {:roots #{(ed/public-key seed)} :request {:req/kind :datom/read-protected :req/resource resource :req/now 1700000000}})
       q {:find [:file/root :chunk/cid] :where [[:query/id "forest-join-v1"]] :scope {:tenant "test" :resources #{resource} :purpose :audit :basis basis} :limit 10}
       request {:request/version 1 :principal "did:key:fixture" :tenant "test" :graph "forest" :operation :read :query/digest (id/value-cid q) :base/commit basis :authority/policy pcid :authority/epoch 7 :nonce "fixture-1" :expires-at "2026-09-02T15:00:00Z"}
       m {:execution/version 1 :data/commit basis :authority/policy pcid :authority/epoch 7 :location/manifest "fixture-location" :schema/root "fixture-schema" :parent nil :issued-at "2026-09-02T14:00:00Z"}
       manifest (assoc m :signature (sign "issuer" issuer m))
       evaluate (fn [_ _] (let [src (reify source/IPatternSource (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (engine/scan eng snap pattern)))) visible (policy/visible-for p #{policy/read-protected-capability})] (mapv (fn [[root cid]] {:file/root root :chunk/cid cid}) (datalog/q src query #(visible (update % :p str))))))]
  {:request request :manifest manifest :authority {:now "2026-09-02T14:30:00Z" :epoch 7 :consume-nonce! (fn [_] true)} :value-cid id/value-cid :verify verify-signature :plan-digest (fn [x] (id/value-cid (if x "fixture-plan" "no-plan"))) :cost (fn [] {:dependent-hops 0 :requests 0 :bytes 0 :cache-profile :unknown}) :implementation/build "hosted-reference-fixture" :sign #(sign "executor" executor %) :authorize! (fn [q] {:allowed? (:dango/allowed? decision) :projection (set (:find q)) :basis basis :policy-cid pcid}) :schema {:file/root {:class :public} :chunk/cid {:class :internal}} :grant {:granted #{:public :internal} :scopes #{}} :query q :evaluate! evaluate}))
(defn sink [db name captured]
 (fn [receipt]
  (let [tx (blocks/open-transaction db) staged (overlay db tx) ack ((causal/execution-receipt-sink (open-db staged) {:expected-basis-cid nil :receipt-cid-fn id/value-cid}) receipt)
        commit (:receipt/commit-cid ack)]
    (println :sink-staged ack)
    (ensure! (:published? ((:publish! tx) name nil commit)) "receipt ref failed")
    (ensure! (= [receipt] (:receipt/records (causal/receipt-at (open-db db) commit (:receipt/cid ack)))) "persisted receipt mismatch")
    (reset! captured ack) ack)))
(case (first *command-line-args*)
 "write" (do (ensure! (.mkdir (java.io.File. staging)) "staging exists") (store/init! store-path)
  (let [initial (:root (store/read-store store-path)) _ (#'pg/query! psql service (str "INSERT INTO awai_witness.root(store_id,root) VALUES ('" store-id "',decode('" (#'pg/wire initial) "','hex'));\n")) db (backend (verifier nil limits))]
   (storage/-put-blocks! db (fixture-blocks))
   (ensure! (:published? (storage/-compare-and-set-ref! db "policy" nil policy-basis)) "basis publication failed")
   (let [recorded (atom nil) denied (atom nil) evaluations (atom 0) opts (ctx db)
         injected (with-redefs [writer/put-ipld-blocks! (fn [& _] (throw (ex-info "injected-publish-failure" {})))]
                    (try (governed/execute! (assoc opts :commit! (sink db "receipt-failed" recorded))) :unexpected-return
                         (catch Exception e (.getMessage e))))
         _ (ensure! (= "injected-publish-failure" injected) "failed publish returned rows")
         _ (ensure! (and (nil? @recorded) (nil? (storage/-read-ref db "receipt-failed"))) "failed publish advanced receipt")
         refusal (try (governed/execute! (assoc opts :authorize! (fn [_] {:allowed? false})
                         :evaluate! (fn [& _] (swap! evaluations inc)) :commit! (sink db "receipt-deny" denied))) :unexpected-return
                     (catch Exception _ :refused))
         _ (ensure! (and (= :refused refusal) (zero? @evaluations) @denied) "denial evaluated or receipt missing")
         result (governed/execute! (assoc opts :commit! (sink db "receipt-allow" recorded)))]
    (ensure! (= 1 (count (:rows result))) "wrong row count")
    (spit (str base "/receipt.edn") (pr-str {:allow @recorded :deny @denied}))
    (prn {:mode :write :allow @recorded :deny @denied :failed-publication :refused :deny-evaluations @evaluations :pass true}))))
 "read" (let [db (backend (verifier nil limits)) acks (edn/read-string (slurp (str base "/receipt.edn")))]
  (doseq [[kind name] [[:allow "receipt-allow"] [:deny "receipt-deny"]]]
   (let [ack (get acks kind) commit (:cid (storage/-read-ref db name))
         receipt (first (:receipt/records (causal/receipt-at (open-db db) commit (:receipt/cid ack))))]
    (ensure! (= commit (:receipt/commit-cid ack)) "commit mismatch")
    (ensure! (= kind (:authority/decision receipt)) "decision mismatch")
    (ensure! (true? (verify-signature {:record :execution-receipt :tenant "test" :epoch 7 :payload-cid (id/payload-cid receipt) :signature (:signature receipt)})) "bad signature")
    (prn {:mode :read :decision kind :commit commit :receipt (:receipt/cid ack) :signature :verified :pass true}))) )
 (throw (ex-info "write or read required" {})))
(shutdown-agents)
