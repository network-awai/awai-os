;; Hosted composition against the prior atomic GiB data group; receipts use a separate store.
(require '[clojure.string :as str] '[kotobase.governed-execution :as governed]
         '[kotobase.execution-identity :as id] '[kotobase.execution-contract :as contract]
         '[kotobase.causal-commit :as causal] '[kotobase.core :as core] '[kotobase-peer.core :as peer]
         '[kotoba.value.codec :as codec])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def source-path (or (System/getenv "GIB_POLICY_PROBE") (throw (ex-info "probe required" {}))))
(def raw (java.nio.file.Files/readAllBytes (java.nio.file.Paths/get source-path (make-array String 0))))
(assert (= "e5f9226ff30272174a67223bff528f933c2f2390d8840a0ac1963ff0f25ba0a9" (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") raw))))
(load-string (first (str/split (String. raw "UTF-8") #"\(case \(first \*command-line-args\*\)" 2)))
(def receipt-out (or (System/getenv "GIB_RECEIPT_OUTPUT") (throw (ex-info "receipt output required" {}))))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "tool required" {}))))
(def data-db (fb/open-backend (str out "/store") (str out "/unused-stage") "/absent-writer"))
(def data-get #(storage/get-block data-db %))
(def basis-cid (:cid (storage/-read-ref (refs/open-ref-store (str out "/store")) "gib-prolly")))
(def entry (edn/read-string (String. ^bytes (data-get basis-cid) "UTF-8")))
(def root (:physical-root entry))
(def e (engine {:put! (fn [& _] (throw (ex-info "read-only" {}))) :get-fn data-get}))
(def snap (eng/open-snapshot e (eng/restore-state e root)))
(def pol (policy-at e snap))
(def pcid (policy/policy-cid pol))
(assert (verify-entry! e entry pcid))
(def location {:format :awai.fixture/gib-location-v1 :signed-basis basis-cid :physical-root root :policy pcid})
(def seed (vec (repeat 32 23)))
(defn sig [record] (ed/sign (ed/secret-key! seed) (payload-bytes (id/payload-cid record))))
(defn signature-ok? [{:keys [payload-cid signature]}] (true? (ed/verify (ed/public-key seed) (payload-bytes payload-cid) signature)))
(defn block [v] {:cid (codec/value-cid v) :bytes (byte-array (map unchecked-byte (codec/encode-value v)))})
(defn value-at [get-block cid] (let [b (or (get-block cid) (throw (ex-info "missing value" {}))) v (codec/decode-value b)] (assert (= cid (codec/value-cid v))) v))
(defn rbackend [] (fb/open-backend (str receipt-out "/store") (str receipt-out "/stage") tool))
(defn open-db [b] (core/open {:storage b :encrypt-fn identity :decrypt-fn identity :blind-fn pr-str :visible? (constantly true)}))
(defn admit! [request manifest]
 (assert (= (:location/manifest manifest) (id/value-cid location)))
 (assert (= root (:data/commit manifest) (:base/commit request)))
 (assert (= pcid (:authority/policy request) (:authority/policy manifest)))
 (assert (verify-entry! e entry pcid)) true)
(defn bundle! [get-block receipt]
 (let [request (value-at get-block (:request/digest receipt)) manifest (value-at get-block (:execution/manifest receipt))]
  (contract/validate-manifest-request! manifest request)
  (assert (signature-ok? {:payload-cid (id/payload-cid manifest) :signature (:signature manifest)}))
  (assert (signature-ok? {:payload-cid (id/payload-cid receipt) :signature (:signature receipt)}))
  (admit! request manifest)))
(def resource (str "kotoba://basis/" root))
(def q {:find [:file/logical-cid] :where '[["file/gib" :file/logical-cid ?cid]] :scope {:tenant "test" :resources #{resource} :purpose :audit :basis root} :limit 1})
(def token (chain/root {:issuer-seed (vec (repeat 32 11)) :grant {:caps #{[:datom/read-protected resource]} :before 1800000000} :caveats [] :next-seed (vec (repeat 32 12))}))
(defn decision [r] (chain/verify (chain/present token) {:roots #{(ed/public-key (vec (repeat 32 11)))} :request {:req/kind :datom/read-protected :req/resource r :req/now 1700000000}}))
(defn query [] (let [db (reify source/IPatternSource (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (eng/scan e snap pattern)))) visible (policy/visible-for pol #{policy/read-protected-capability})]
                  (mapv (fn [[cid]] {:file/logical-cid cid}) (datalog/q db {:find '[?cid] :where (:where q)} #(visible (update % :p str))))))
(case (first *command-line-args*)
 "write" (do
  (assert (.mkdir (java.io.File. receipt-out))) (assert (.mkdir (java.io.File. (str receipt-out "/stage")))) (store/init! (str receipt-out "/store"))
  (let [db (rbackend) evals (atom 0)
        unsigned {:execution/version 1 :data/commit root :authority/policy pcid :authority/epoch 7 :location/manifest (id/value-cid location) :schema/root "fixture-schema" :parent nil :issued-at "2026-09-02T14:00:00Z"}
        manifest (assoc unsigned :signature (sig unsigned))
        execute (fn [d ref-name]
         (let [request {:request/version 1 :principal "fixture-principal" :tenant "test" :graph "fixture-graph" :operation :read :query/digest (id/value-cid q) :base/commit root :authority/policy pcid :authority/epoch 7 :nonce ref-name :expires-at "2026-09-02T15:00:00Z"}
               sink (fn [receipt]
                (let [prepared (causal/prepare-execution-receipt receipt {:expected-basis-cid nil :receipt-cid-fn id/value-cid})
                      result (fb/publish-ports! db ref-name nil
                        (fn [ports] (doseq [v [request manifest]] (let [b (block v)] ((:put! ports) (:cid b) (:bytes b))))
                         (let [commit (peer/commit! (:put! ports) (:get-fn ports) (:tx-data prepared) (:receipt/basis-cid prepared) identity)]
                          {:target commit :value {:receipt/cid (:receipt/cid prepared) :receipt/commit-cid commit}}))
                        (fn [get-block _] (bundle! get-block receipt)))
                      commit (:receipt/commit-cid result)]
                  (assert (= [receipt] (:receipt/records (causal/receipt-at (open-db db) commit (:receipt/cid result)))))
                  (assoc result :receipt/durable? true)))]
           (try (admit! request manifest)
             (governed/execute! {:request request :manifest manifest :authority {:now "2026-09-02T14:30:00Z" :epoch 7 :consume-nonce! (constantly true)}
               :value-cid id/value-cid :verify signature-ok? :plan-digest (constantly "fixture-plan")
               :cost (constantly {:dependent-hops 0 :requests 0 :bytes 0 :cache-profile :unknown}) :implementation/build "fixture"
               :sign sig :commit! sink :authorize! (fn [_] {:allowed? (true? (:dango/allowed? d)) :projection #{:file/logical-cid} :basis root :policy-cid pcid})
               :schema {:file/logical-cid {:class :public}} :grant {:granted #{:public} :scopes #{}} :query q
               :evaluate! (fn [_ _] (swap! evals inc) (query))})
             (catch Exception ex {:error (ex-data ex)}))))
        allow (execute (decision resource) "allow") denied (execute (decision "kotoba://basis/wrong") "deny")
        aid (get-in allow [:provenance :receipt-cid]) did (get-in denied [:error :kotobase.governed-execution/deny-receipt-cid])]
    (assert (= [{:file/logical-cid file-cid}] (:rows allow)))
    (assert (= :authority-denied (get-in denied [:error :kotobase.governed-execution/reason])))
    (assert (= 1 @evals)) (assert (and (string? aid) (string? did)))
    (assert (= (id/value-cid (:rows allow)) (get-in allow [:execution/receipt :result/root])))
    (spit (str receipt-out "/ids.edn") (pr-str {:allow aid :deny did :basis basis-cid}))
    (prn {:governed :allow-and-deny :evaluations @evals :receipts :durable :file-cid file-cid :pass true})))
 "read" (let [db (rbackend) ids (edn/read-string (slurp (str receipt-out "/ids.edn"))) get-block #(storage/get-block db %)]
  (assert (= basis-cid (:basis ids)))
  (doseq [[kind ref cid] [[:allow "allow" (:allow ids)] [:deny "deny" (:deny ids)]]]
   (let [commit (:cid (storage/-read-ref db ref)) receipt (first (:receipt/records (causal/receipt-at (open-db db) commit cid)))]
    (assert (= kind (:authority/decision receipt))) (assert (bundle! get-block receipt))
    (assert (refused? #(bundle! (fn [c] (when-not (= c (:request/digest receipt)) (get-block c))) receipt)))
    (when (= kind :allow) (assert (= (id/value-cid [{:file/logical-cid file-cid}]) (:result/root receipt))))))
  (assert (verify! data-get basis-cid))
  (prn {:after-reboot :verified :signed-basis :verified :policy :bound :allow-deny-receipts :verified :missing-request :refused :pass true}))
 (throw (ex-info "write or read required" {})))
(shutdown-agents)
