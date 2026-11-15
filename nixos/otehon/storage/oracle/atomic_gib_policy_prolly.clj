;; Hosted experiment: actual logical-file CID in the Prolly snapshot in the same
;; atomic Forest group as its GiB block closure. No authority/receipt claim.
(require '[otehon.atomic-forest-stream :as stream] '[otehon.storage :as store]
         '[otehon.pack-store :as pack] '[otehon.kotobase-ref :as refs]
         '[otehon.kotobase-forest-blocks :as fb] '[kotobase.storage.core :as storage]
         '[kotobase.engine.prolly :as prolly] '[kotobase.engine.contract :as eng]
         '[datom.source :as source] '[datalog.core :as datalog] '[awai.fs.car :as car]
         '[clojure.edn :as edn] '[ed25519.sign :as ed] '[kotobase.engine.identity :as logical]
         '[kotobase.signed-basis :as signed] '[kotobase-peer.policy :as policy] '[dango.chain :as chain])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def out (or (System/getenv "GIB_PROLLY_OUTPUT") (throw (ex-info "output required" {}))))
(def src (or (System/getenv "GIB_SOURCE") (throw (ex-info "source required" {}))))
(def file-cid "bafyreidk3dxbsrqaocvdhfr624j4n75v6ddgmyfgkyu24z3lirlg5aj4g4")
(def file-sha "1f7e0c0d3fefe5579e556a04f7796b7de01278916e49a6d31df864e16adf1708")
(defn sha [s] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))))
(defn engine [ports] (prolly/prolly-engine {:put! (:put! ports) :get-fn (:get-fn ports)
                                           :blind-fn #(str "fixture-blind:" %) :encrypt-fn identity
                                           :decrypt-fn identity :digest-fn sha}))
(def issuer (vec (repeat 32 3)))
(defn payload-bytes [s] (mapv #(bit-and 255 %) (.getBytes s "UTF-8")))
(defn policy-at [e snap]
 (policy/policy-of (mapv (fn [{:keys [e a v]}] {:e e :a (str a) :v_edn (pr-str v)}) (eng/scan e snap ["kotobase.policy/read" nil nil]))))
(defn signed-entry [physical cp pcid tx-root]
 (let [commit (logical/logical-commit {:format logical/logical-commit-format :database-id (:database-id cp) :epoch (:epoch cp) :parents [] :tx-root tx-root :logical-checkpoint-root (:logical-checkpoint-root cp) :schema-root "fixture-schema" :model-contract-root "fixture-model" :admission-policy-root pcid})
       root (sha (logical/logical-commit-string commit))
       payload (logical/signature-payload {:logical-commit-root root :issuer "did:key:fixture-issuer" :key-id "fixture-key"})]
  {:physical-root physical :root root :commit commit :issuer "did:key:fixture-issuer" :key-id "fixture-key" :signature (ed/sign (ed/secret-key! issuer) (payload-bytes payload))}))
(defn verify-entry! [e entry pcid]
 (let [verify (signed/verifier {:digest! sha :checkpoint! (signed/checkpoint-reader e)
                               :verify-location! (fn [_] true)
                               :verify-signature! (fn [{:keys [issuer key-id payload signature]}]
                                 (and (= issuer "did:key:fixture-issuer") (= key-id "fixture-key")
                                      (true? (ed/verify (ed/public-key (vec (repeat 32 3))) (payload-bytes payload) signature))))})
       root (:physical-root entry)]
   (true? (verify {:entry entry :request {:base/commit root :authority/policy pcid}
                   :manifest {:data/commit root :authority/policy pcid}}))))
(defn refused? [f] (try (not (true? (f))) (catch Exception _ true)))
(defn proof-block [proof]
 (let [b (.getBytes (pr-str proof) "UTF-8") d (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw d)) :bytes b}))
(defn verify! [get-block proof-cid]
 (let [proof-bytes (or (get-block proof-cid) (throw (ex-info "missing signed basis" {})))
       proof (edn/read-string (String. ^bytes proof-bytes "UTF-8")) root (:physical-root proof)
       e (engine {:put! (fn [& _] (throw (ex-info "read-only" {}))) :get-fn get-block})
       snap (eng/open-snapshot e (eng/restore-state e root))
       cp (eng/checkpoint e snap)
       p (policy-at e snap) pcid (policy/policy-cid p)
       _ (assert (= [":file/"] (:protected-prefixes p)))
       _ (assert (verify-entry! e proof pcid))
       _ (assert (refused? #(verify-entry! e (assoc proof :signature (vec (repeat 64 0))) pcid)))
       _ (assert (refused? #(verify-entry! e proof (policy/policy-cid {:protected-prefixes [":other/"]}))))
       db (reify source/IPatternSource (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (eng/scan e snap pattern))))
       resource (str "kotoba://basis/" root) dseed (vec (repeat 32 11))
       token (chain/root {:issuer-seed dseed :grant {:caps #{[:datom/read-protected resource]} :before 1800000000} :caveats [] :next-seed (vec (repeat 32 12))})
       decide (fn [r] (chain/verify (chain/present token) {:roots #{(ed/public-key dseed)} :request {:req/kind :datom/read-protected :req/resource r :req/now 1700000000}}))
       allow (decide resource) deny (decide "kotoba://basis/wrong")
       query (fn [decision] (let [caps (if (:dango/allowed? decision) #{policy/read-protected-capability} #{}) visible (policy/visible-for p caps)]
                              (datalog/q db '{:find [?cid] :where [["file/gib" :file/logical-cid ?cid]]} #(visible (update % :p str)))))
       _ (assert (:dango/allowed? allow)) _ (assert (not (:dango/allowed? deny)))
       _ (assert (empty? (query deny))) rows (query allow)
       _ (assert (= #{[file-cid]} rows))
       manifest (or (get-block (ffirst rows)) (throw (ex-info "missing manifest" {})))
       decoded (first (car/cbor-decode (mapv #(bit-and 255 %) manifest) 0))
       chunks (get decoded "chunks") md (MessageDigest/getInstance "SHA-256")]
   (assert (= 1024 (count chunks)))
   (doseq [c chunks] (let [b (or (get-block (car/cid-str (get-in c ["cid" :bytes]))) (throw (ex-info "missing chunk" {})))]
                       (assert (= (get c "length") (alength ^bytes b))) (.update md ^bytes b)))
   (assert (= file-sha (.formatHex (HexFormat/of) (.digest md))))
   (prn {:signed-basis :verified :bad-signature :refused :wrong-policy :refused :dango :allowed-and-denied :policy :bound :query :actual-file-cid :chunks (count chunks) :sha file-sha :pass true}) true))
(case (first *command-line-args*)
 "write" (let [tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "tool required" {})))
               view (pack/logical-block-view (pack/recover (str src "/store")) "gib" file-cid)
               manifest ((:get-block view) file-cid)
               decoded (first (car/cbor-decode (mapv #(bit-and 255 %) manifest) 0))]
           (assert (.mkdir (java.io.File. out))) (store/init! (str out "/store"))
           (stream/publish! (str out "/store") (str out "/stage") tool "gib-prolly" nil (constantly nil)
             (fn [ports]
               (let [e (engine ports) st (eng/empty-state e "fixture/gib-file")
                     result (eng/transact e st {:database-id "fixture/gib-file" :request-id "gib-1"
                                               :tx-data [[:db/add "file/gib" :file/logical-cid file-cid] [:db/add "kotobase.policy/read" :kotobase.policy/protected-prefixes (pr-str [":file/"])]]})
                     root (get-in result [:receipt :physical-root])
                     snap (eng/open-snapshot e (:state result)) cp (eng/checkpoint e snap)
                     pcid (policy/policy-cid (policy-at e snap))
                     proof (proof-block (signed-entry root cp pcid (get-in result [:receipt :tx-root])))]
                 ((:put! ports) (:cid proof) (:bytes proof))
                 ((:put! ports) file-cid manifest)
                 (doseq [c (get decoded "chunks")]
                   (let [cid (car/cid-str (get-in c ["cid" :bytes]))] ((:put! ports) cid ((:get-block view) cid))))
                 {:target (:cid proof) :value (:cid proof)})) verify!))
 "read" (let [dir (str out "/store") backend (fb/open-backend dir (str out "/unused-stage") "/absent-writer")
              root (:cid (storage/-read-ref (refs/open-ref-store dir) "gib-prolly"))]
          (assert root) (assert (verify! #(storage/get-block backend %) root)))
 (throw (ex-info "write or read required" {})))
(shutdown-agents)
