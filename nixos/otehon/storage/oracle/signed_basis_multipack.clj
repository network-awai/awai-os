(def dest (or (System/getenv "SIGNED_BASIS_OUTPUT") (throw (ex-info "output required" {}))))
(require '[clojure.edn :as edn] '[otehon.ipld-forest :as catalog] '[otehon.storage :as store] '[otehon.forest-writer :as writer] '[otehon.forest :as forest] '[awai.fs.car :as car] '[kotobase.engine.prolly :as prolly] '[kotobase.engine.contract :as eng] '[kotobase.engine.identity :as logical] '[kotobase.engine.frontier :as frontier] '[ed25519.sign :as ed] '[kotobase-peer.policy :as policy] '[dango.chain :as chain] '[datom.source :as source] '[datalog.core :as datalog])
(import '[java.security MessageDigest] '[java.util HexFormat Random] '[java.nio.file Files Paths])
(def mode (first *command-line-args*))
(def tool (when (= mode "write") (or (System/getenv "FOREST_TOOL") (throw (ex-info "tool required" {})))))
(def h (if (= mode "write")
         (catalog/recover-group (or (System/getenv "GROUP_FOREST_STORE") (throw (ex-info "GROUP_FOREST_STORE required for write" {}))) "test")
         (catalog/recover-group (str dest "/store") "signed-basis")))
(def touched (atom #{}))
(def read-segments store/read-payload-segments)
(defn tracked-get [cid]
 (with-redefs [store/read-payload-segments (fn [dir sha ext size spans]
                                            (swap! touched conj sha)
                                            (read-segments dir sha ext size spans))]
  (catalog/get-group-block h cid)))
(def stored-proof (when (= mode "read") (edn/read-string (String. ^bytes (tracked-get (get-in h [:group :basis-cid])) "UTF-8"))))
(def basis (if (= mode "write") (get-in h [:group :basis-cid]) (:physical-root stored-proof)))
(defn sha [s] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))))
(def engine (prolly/prolly-engine {:put! (fn [& _] (throw (ex-info "read only" {}))) :get-fn tracked-get :blind-fn #(str "blind-fixture:" %) :encrypt-fn identity :decrypt-fn identity :digest-fn sha}))
(def snap (eng/open-snapshot engine (eng/restore-state engine basis)))
(def policy-rows (eng/scan engine snap ["kotobase.policy/read" nil nil]))
(def read-policy (policy/policy-of (mapv (fn [{:keys [e a v]}] {:e e :a (str a) :v_edn (pr-str v)}) policy-rows)))
(def pcid (or (policy/policy-cid read-policy) (throw (ex-info "missing policy" {}))))
(def issuer (vec (repeat 32 3)))
(defn payload-bytes [s] (mapv #(bit-and 255 %) (.getBytes s "UTF-8")))
(defn block [x] (let [bytes (.getBytes (pr-str x) "UTF-8") digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes))] {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes}))
(def key-id "fixture-key")
(def signer "did:key:fixture-issuer")
(def checkpoint (eng/checkpoint engine snap))
;; The tx/schema/model roots and lack of parent proof are fixture placeholders.
(def commit (logical/logical-commit {:format logical/logical-commit-format :database-id (:database-id checkpoint) :epoch (:epoch checkpoint) :parents [] :tx-root "unverified-fixture-tx" :logical-checkpoint-root (:logical-checkpoint-root checkpoint) :schema-root "fixture-schema" :model-contract-root "fixture-model" :admission-policy-root pcid}))
(def root (sha (logical/logical-commit-string commit)))
(defn payload [r] (logical/signature-payload {:logical-commit-root r :issuer signer :key-id key-id}))
(def proof {:physical-root basis :root root :commit commit :issuer signer :key-id key-id :signature (ed/sign (ed/secret-key! issuer) (payload-bytes (payload root)))})
(defn verify-proof [entry cp expected-policy]
 (and (= signer (:issuer entry)) (= key-id (:key-id entry))
      (= (:root entry) (sha (logical/logical-commit-string (:commit entry))))
      (= (:database-id cp) (get-in entry [:commit :database-id]))
      (= (:epoch cp) (get-in entry [:commit :epoch]))
      (= (:logical-checkpoint-root cp) (get-in entry [:commit :logical-checkpoint-root]))
      (= expected-policy (get-in entry [:commit :admission-policy-root]))
      (true? (ed/verify (ed/public-key issuer) (payload-bytes (payload (:root entry))) (:signature entry)))))
(defn fixture-blocks []
 (let [path "nixos/otehon/storage/test/fixtures/prolly-forest/policy.forest"
       archive (Files/readAllBytes (Paths/get path (make-array String 0)))
       src (:blocks (car/carv1-decode (:carv1 (forest/open archive))))
       prolly (mapv (fn [{:keys [cid bytes]}] {:cid (car/cid-str cid) :bytes (byte-array (map unchecked-byte bytes))}) src)
       rng (Random. 532174)
       extras (mapv (fn [_] (let [b (byte-array (* 600 1024)) _ (.nextBytes rng b)
                                  digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
                              {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes b})) (range 2))]
  (vec (concat (take 9 prolly) extras (drop 9 prolly)))))
(case mode
 "write" (do (assert (.mkdir (java.io.File. dest))) (store/init! (str dest "/store"))
  (let [b (block proof) bs (conj (fixture-blocks) b)
        result (writer/put-ipld-blocks! (str dest "/store") "signed-basis" (:cid b) bs (str dest "/stage") tool)]
   (assert (= 2 (:archive-count result)))
   (assert (= 21 (:block-count result)))
   (prn {:proof (:cid b) :root root :archives (:archive-count result) :blocks (:block-count result)})))
 "read" (let [cid (get-in h [:group :basis-cid])
               entry stored-proof
               verify-entry #(verify-proof % checkpoint pcid)
               result (frontier/accept-head {:candidate-root (:root entry) :path [entry] :verify-entry verify-entry})]
          (assert (= :initialized (:status result)))
          (doseq [bad [(assoc entry :root "wrong") (assoc-in entry [:commit :logical-checkpoint-root] "wrong") (assoc entry :signature (vec (repeat 64 0))) (assoc entry :issuer "other")]]
            (assert (not (verify-entry bad))))
          (assert (not (verify-proof entry (assoc checkpoint :logical-checkpoint-root "other") pcid)))
          (let [changed-policy (policy/policy-cid (assoc read-policy :protected-prefixes [":other/"]))
                queries (atom 0)
                admit-and-query (fn [expected-policy]
                  (frontier/accept-head {:candidate-root (:root entry) :path [entry]
                                         :verify-entry #(verify-proof % checkpoint expected-policy)})
                  (swap! queries inc))]
            (assert (not= pcid changed-policy))
            (assert (try (admit-and-query changed-policy) false (catch Exception _ true)))
            (assert (zero? @queries)))
          ;; Run the query against the same snapshot and policy whose CID was
          ;; checked above; the capability authority and clock remain fixtures.
          (let [seed (vec (repeat 32 1)) resource (str "kotoba://basis/" basis)
                token (chain/root {:issuer-seed seed :grant {:caps #{[:datom/read-protected resource]} :before 1800000000} :caveats [] :next-seed (vec (repeat 32 2))})
                req {:req/kind :datom/read-protected :req/resource resource :req/now 1700000000}
                decide (fn [request] (chain/verify (chain/present token) {:roots #{(ed/public-key seed)} :request request}))
                src (reify source/IPatternSource (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (eng/scan engine snap pattern))))
                q '{:find [?root ?cid] :where [["file" :file/root ?root] ["file" :file/chunk ?c] [?c :chunk/index 8] [?c :chunk/cid ?cid]]}
                run (fn [decision] (let [caps (if (:dango/allowed? decision) #{policy/read-protected-capability} #{}) visible (policy/visible-for read-policy caps)] (datalog/q src q #(visible (update % :p str)))))
                allowed (run (decide req)) denied (run (decide (assoc req :req/resource "kotoba://basis/wrong")))]
            (assert (= #{["bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny" "bafkreidxq3azg4pwxcuurzkrmjha3uuzhstmefbzx6dw6z5bjaqya64mra"]} allowed))
            (assert (empty? denied)))
          (assert (= 2 (count @touched)))
          (prn {:archives-read (count @touched) :proof cid :physical-root basis :checkpoint (:logical-checkpoint-root checkpoint) :policy-cid pcid :signature :verified :tamper :rejected :query :passed :pass true}))
 (throw (ex-info "write/read required" {})))
(shutdown-agents)
