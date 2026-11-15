;; Hosted integration oracle; keys, location, clock and crypto profile are fixtures.
(require '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as fb]
 '[otehon.kotobase-ref :as refs] '[kotobase.storage.core :as storage]
 '[kotobase.engine.prolly :as prolly] '[kotobase.engine.contract :as eng]
 '[kotobase.engine.identity :as logical] '[kotobase.signed-basis :as signed]
 '[kotobase-peer.policy :as policy] '[datom.source :as source] '[datalog.core :as datalog]
 '[ed25519.sign :as ed] '[awai.fs.car :as car] '[clojure.edn :as edn] '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util HexFormat Random Arrays])
(defn require! [v msg] (when-not v (throw (ex-info msg {}))))
(defn sha [s] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))))
(defn engine [ports] (prolly/prolly-engine {:put! (:put! ports) :get-fn (:get-fn ports)
 :blind-fn #(str "fixture-blind:" %) :encrypt-fn identity :decrypt-fn identity :digest-fn sha}))
(defn block [i]
 (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. (+ 532 i)) b)
       h (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw h)) :bytes b}))
(defn policy-at [e snapshot]
 (policy/policy-of (mapv (fn [{:keys [e a v]}] {:e e :a (str a) :v_edn (pr-str v)})
                         (eng/scan e snapshot ["kotobase.policy/read" nil nil]))))
(def key-seed (vec (repeat 32 3)))
(defn utf8 [s] (mapv #(bit-and 255 %) (.getBytes ^String s "UTF-8")))
(defn signed-entry [physical cp policy-cid tx-root]
 (let [commit (logical/logical-commit {:format logical/logical-commit-format :database-id (:database-id cp)
               :epoch (:epoch cp) :parents [] :tx-root tx-root :logical-checkpoint-root (:logical-checkpoint-root cp)
               :schema-root "fixture-schema" :model-contract-root "fixture-model" :admission-policy-root policy-cid})
       root (sha (logical/logical-commit-string commit)) issuer "did:key:fixture-issuer" key-id "fixture-key"
       payload (logical/signature-payload {:logical-commit-root root :issuer issuer :key-id key-id})]
  {:physical-root physical :root root :commit commit :issuer issuer :key-id key-id
   :signature (ed/sign (ed/secret-key! key-seed) (utf8 payload))}))
(defn verify-entry! [e entry policy-cid]
 (let [v (signed/verifier {:digest! sha :checkpoint! (signed/checkpoint-reader e) :verify-location! (fn [_] true)
           :verify-signature! (fn [{:keys [issuer key-id payload signature]}]
             (and (= issuer "did:key:fixture-issuer") (= key-id "fixture-key")
                  (true? (ed/verify (ed/public-key key-seed) (utf8 payload) signature))))})
       physical (:physical-root entry)]
  (true? (v {:entry entry :request {:base/commit physical :authority/policy policy-cid}
             :manifest {:data/commit physical :authority/policy policy-cid}}))))
(defn refused? [f] (try (not (true? (f))) (catch Exception _ true)))
(defn proof-block [entry]
 (let [bytes (.getBytes (pr-str entry) "UTF-8") digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes}))
(defn verify! [get-block proof-cid file-cid]
 (let [bytes (or (get-block proof-cid) (throw (ex-info "missing proof" {})))
       proof (edn/read-string (String. ^bytes bytes "UTF-8"))
       e (engine {:put! (fn [& _] (throw (ex-info "read-only" {}))) :get-fn get-block})
       snap (eng/open-snapshot e (eng/restore-state e (:physical-root proof))) p (policy-at e snap)
       pcid (policy/policy-cid p)
       _ (require! (= [":file/"] (:protected-prefixes p)) "persisted policy mismatch")
       _ (require! (verify-entry! e proof pcid) "signed basis refused")
       _ (require! (refused? #(verify-entry! e (assoc proof :signature (vec (repeat 64 0))) pcid)) "bad signature accepted")
       _ (require! (refused? #(verify-entry! e proof (policy/policy-cid {:protected-prefixes [":other/"]}))) "wrong policy accepted")
       db (reify source/IPatternSource (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (eng/scan e snap pattern))))
       query (fn [caps] (let [visible (policy/visible-for p caps)]
                          (datalog/q db '{:find [?cid] :where [["file/demo" :file/logical-cid ?cid]]}
                                     #(visible (update % :p str)))))]
  (require! (= #{[file-cid]} (query #{policy/read-protected-capability})) "allowed Datalog mismatch")
  (require! (empty? (query #{})) "denied policy disclosed data")
  (doseq [i (range 18)] (let [{:keys [cid bytes]} (block i) got (get-block cid)]
                         (require! (and got (Arrays/equals ^bytes bytes ^bytes got)) "block mismatch"))) true))
(let [[mode root tool] *command-line-args* directory (str root "/store") staging (str root "/stage") file-cid (:cid (block 0))]
 (case mode
  "write" (do
   (require! (.mkdir (java.io.File. root)) "fresh root required")
   (require! (.mkdir (java.io.File. staging)) "fresh stage required") (store/init! directory)
   (let [published (fb/publish-atomic-stream-ports! directory staging tool "signed-prolly" nil
     (fn [ports]
      (doseq [i (range 18)] (let [{:keys [cid bytes]} (block i)] ((:put! ports) cid bytes)))
      (let [e (engine ports) st (eng/empty-state e "oracle/signed-policy")
            tx (eng/transact e st {:database-id "oracle/signed-policy" :request-id "tx-1"
              :tx-data [[:db/add "file/demo" :file/logical-cid file-cid]
                        [:db/add "kotobase.policy/read" :kotobase.policy/protected-prefixes (pr-str [":file/"])]]})
            physical (get-in tx [:receipt :physical-root]) snap (eng/open-snapshot e (:state tx))
            proof (proof-block (signed-entry physical (eng/checkpoint e snap) (policy/policy-cid (policy-at e snap)) (get-in tx [:receipt :tx-root])))]
        ((:put! ports) (:cid proof) (:bytes proof)) {:target (:cid proof) :value (:cid proof)}))
     (fn [get-block proof] (verify! get-block proof file-cid)))]
    (require! (= published (:cid (storage/-read-ref (refs/open-ref-store directory) "signed-prolly"))) "ref mismatch")
    (let [snapshot (store/read-store directory)
          groups (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/") (keys (:state snapshot)))
          group (edn/read-string (get-in snapshot [:state (first groups)]))
          log (edn/read-string (slurp (str directory "/" (get-in snapshot [:root :log]) ".edn")))]
     (require! (= 1 (count groups)) "expected one group")
     (require! (<= 2 (count (:archives group))) "expected multiple packs")
     (require! (= [:put-many] (mapv :op (get-in log [:value :frames]))) "expected one group/ref frame"))
    (prn {:mode :write :proof published :signed-basis :verified :policy :allow-deny :blocks 18 :pass true})))
  "read" (let [db (fb/open-backend directory staging tool) proof (:cid (storage/-read-ref db "signed-prolly"))]
            (require! proof "missing proof") (verify! #(storage/get-block db %) proof file-cid)
            (prn {:mode :read :proof proof :signed-basis :verified :policy :allow-deny :blocks 18 :pass true}))
  (throw (ex-info "expected write/read" {}))))
(shutdown-agents)
