(require '[otehon.ipld-forest :as catalog] '[otehon.storage :as store]
         '[kotobase.engine.prolly :as prolly] '[kotobase.engine.contract :as eng]
         '[kotobase-peer.policy :as policy] '[datom.source :as source]
         '[datalog.core :as datalog] '[dango.chain :as chain] '[ed25519.sign :as ed])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def handle (catalog/recover-group (or (System/getenv "GROUP_FOREST_STORE") (throw (ex-info "GROUP_FOREST_STORE required" {}))) "test"))
(def basis (get-in handle [:group :basis-cid]))
(def counts (atom {:frames 0 :bytes 0 :archives #{}}))
(def original store/read-payload-segments)
(defn get-block [cid] (catalog/get-group-block handle cid))
(defn sha [s] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))))
(def e (prolly/prolly-engine {:put! (fn [& _] (throw (ex-info "read only" {}))) :get-fn get-block
                              :blind-fn #(str "blind-fixture:" %) :encrypt-fn identity :decrypt-fn identity :digest-fn sha}))
(def resource (str "kotoba://basis/" basis))
(def seed (vec (repeat 32 1)))
(def token (chain/root {:issuer-seed seed :grant {:caps #{[:datom/read-protected resource]} :before 1800000000}
                        :caveats [] :next-seed (vec (repeat 32 2))}))
(def presentation (chain/present token))
(def req {:req/kind :datom/read-protected :req/resource resource :req/now 1700000000})
(defn decide [p r] (chain/verify p {:roots #{(ed/public-key seed)} :request r}))
(def valid (decide presentation req))
(def revoked (chain/verify presentation {:roots #{(ed/public-key seed)} :request req :revoked #{(first (:dango/cids valid))}}))
(def decisions [valid
                (decide presentation (assoc req :req/resource "kotoba://basis/bafywrong"))
                (decide presentation (assoc req :req/now 1800000000))
                (decide (assoc presentation :seal (vec (repeat 64 0))) req)
                revoked])
(def q '{:find [?root ?cid] :where [["file" :file/root ?root] ["file" :file/chunk ?c] [?c :chunk/index 8] [?c :chunk/cid ?cid]]})
(def expected #{["bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny" "bafkreidxq3azg4pwxcuurzkrmjha3uuzhstmefbzx6dw6z5bjaqya64mra"]})
(with-redefs [store/read-payload-segments (fn [d sha ext size spans]
                                           (swap! counts #(-> % (update :frames + (count spans))
                                                               (update :bytes + (reduce + (map :length spans)))
                                                               (update :archives conj sha)))
                                           (original d sha ext size spans))]
  (let [state (eng/restore-state e basis) snap (eng/open-snapshot e state)
        rows (eng/scan e snap ["kotobase.policy/read" nil nil])
        p (policy/policy-of (mapv (fn [{:keys [e a v]}] {:e e :a (str a) :v_edn (pr-str v)}) rows))
        src (reify source/IPatternSource
              (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (eng/scan e snap pattern))))
        run (fn [decision] (let [caps (if (:dango/allowed? decision) #{policy/read-protected-capability} #{})
                                 visible (policy/visible-for p caps)]
                             (datalog/q src q #(visible (update % :p str)))))
        results (mapv run decisions)]
    (when-not (and (= [:granted :dango/not-covered :dango/expired :dango/bad-seal :dango/revoked] (mapv :dango/reason decisions))
                   (= 2 (count (:archives @counts))) (= [":chunk/"] (:protected-prefixes p)) (= expected (first results)) (every? empty? (rest results)))
      (throw (ex-info "authorization or query mismatch" {:decisions decisions :results results :policy p})))
    (prn {:basis basis :decision-reasons (mapv :dango/reason decisions) :policy p
          :allowed (first results) :denied-counts (mapv count (rest results)) :positioned @counts :pass true})))

(shutdown-agents)
