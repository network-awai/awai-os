;; Hosted reference policy/Dango fixture over witnessed Forest + PostgreSQL.
(require '[clojure.string :as str] '[awai.fs.car :as car] '[otehon.forest :as forest]
         '[kotobase-peer.policy :as policy] '[dango.chain :as chain] '[ed25519.sign :as ed])
(def shared (slurp "nixos/otehon/storage/oracle/postgres_witness_prolly.clj"))
(load-string (first (str/split shared #"\(case \(first \*command-line-args\*\)" 2)))
(def policy-basis "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri")
(def fixture (or (System/getenv "IPLD_POLICY_FIXTURE") "nixos/otehon/storage/test/fixtures/prolly-forest/policy.forest"))
(defn fixture-blocks []
  (let [f (Files/readAllBytes (Paths/get fixture (make-array String 0)))
        records (:blocks (car/carv1-decode (:carv1 (forest/open f))))]
    (mapv (fn [{:keys [cid bytes]}] {:cid (car/cid-str cid) :bytes (byte-array (map unchecked-byte bytes))}) records)))
(def query '{:find [?root ?cid] :where [["file" :file/root ?root] ["file" :file/chunk ?c] [?c :chunk/index 8] [?c :chunk/cid ?cid]]})
(def expected #{["bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny" "bafkreidxq3azg4pwxcuurzkrmjha3uuzhstmefbzx6dw6z5bjaqya64mra"]})
(case (first *command-line-args*)
 "write"
 (do (ensure! (.mkdir (java.io.File. staging)) "staging exists") (store/init! store-path)
     (let [initial (:root (store/read-store store-path))
           _ (#'pg/query! psql service (str "INSERT INTO awai_witness.root(store_id,root) VALUES ('" store-id "',decode('" (#'pg/wire initial) "','hex'));\n"))
           db (backend (verifier nil limits)) entries (fixture-blocks)]
       (ensure! (= 18 (count entries)) "unexpected fixture size")
       (ensure! (= (mapv :cid entries) (storage/-put-blocks! db entries)) "block acknowledgement mismatch")
       (ensure! (:published? (storage/-compare-and-set-ref! db "policy" nil policy-basis)) "policy basis publication failed")
       (ensure! (= policy-basis (:cid (storage/-read-ref db "policy"))) "published basis mismatch")
       (prn {:mode :write :fixture-blocks 18 :basis policy-basis :pass true})))
 "read"
 (let [db (backend (verifier nil limits)) basis (:cid (storage/-read-ref db "policy"))
       _ (ensure! (= policy-basis basis) "recovered basis mismatch")
       eng (prolly/prolly-engine {:put! (fn [& _] (throw (ex-info "read only" {}))) :get-fn #(storage/get-block db %)
                                  :blind-fn #(str "blind-fixture:" %) :encrypt-fn identity :decrypt-fn identity :digest-fn sha})
       snap (engine/open-snapshot eng (engine/restore-state eng basis))
       p (policy/policy-of (mapv (fn [{:keys [e a v]}] {:e e :a (str a) :v_edn (pr-str v)}) (engine/scan eng snap ["kotobase.policy/read" nil nil])))
       resource (str "kotoba://basis/" basis) seed (vec (repeat 32 1))
       token (chain/root {:issuer-seed seed :grant {:caps #{[:datom/read-protected resource]} :before 1800000000} :caveats [] :next-seed (vec (repeat 32 2))})
       presentation (chain/present token) req {:req/kind :datom/read-protected :req/resource resource :req/now 1700000000}
       decide (fn [t r] (chain/verify t {:roots #{(ed/public-key seed)} :request r}))
       valid (decide presentation req)
       revoked (chain/verify presentation {:roots #{(ed/public-key seed)} :request req :revoked #{(first (:dango/cids valid))}})
       decisions [valid (decide presentation (assoc req :req/resource "kotoba://basis/bafywrong"))
                  (decide presentation (assoc req :req/now 1800000000))
                  (decide (assoc presentation :seal (vec (repeat 64 0))) req) revoked]
       src (reify source/IPatternSource (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (engine/scan eng snap pattern))))
       run (fn [decision] (let [caps (if (:dango/allowed? decision) #{policy/read-protected-capability} #{})
                                visible (policy/visible-for p caps)]
                            (datalog/q src query #(visible (update % :p str)))))
       results (mapv run decisions)]
   (ensure! (= [:granted :dango/not-covered :dango/expired :dango/bad-seal :dango/revoked] (mapv :dango/reason decisions)) "decision mismatch")
   (ensure! (= [":chunk/"] (:protected-prefixes p)) "recovered policy mismatch")
   (ensure! (and (= expected (first results)) (every? empty? (rest results))) "query authorization mismatch")
   (prn {:mode :read :basis basis :policy-cid (policy/policy-cid p)
         :decision-reasons (mapv :dango/reason decisions) :allowed-rows (count (first results))
         :denied-rows (mapv count (rest results)) :pass true}))
 (throw (ex-info "write or read required" {})))
(shutdown-agents)
