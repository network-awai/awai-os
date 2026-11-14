;; Hosted Prolly transaction through actual Forest block/ref ports, not Native.
(require '[clojure.edn :as edn] '[kotobase.storage.core :as storage] '[otehon.storage :as store]
         '[otehon.kotobase-forest-blocks :as blocks] '[kotobase.engine.prolly :as prolly]
         '[kotobase.engine.contract :as engine] '[datom.source :as source] '[datalog.core :as datalog])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def base (or (System/getenv "KOTOBASE_TX_OUTPUT") (throw (ex-info "KOTOBASE_TX_OUTPUT required" {}))))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "FOREST_TOOL required" {}))))
(def dir (str base "/store"))
(def staging (str base "/staging"))
(defn ensure! [x message] (when-not x (throw (ex-info message {}))))
(defn sha [s] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))))
(defn backend [] (blocks/open-backend dir staging tool))
(defn make-engine [ports]
  (let [{:keys [put! get-fn]} ports]
    (prolly/prolly-engine {:put! put! :get-fn get-fn :blind-fn #(str "fixture-blind:" %)
                           :encrypt-fn identity :decrypt-fn identity :digest-fn sha})))
(defn names-at [eng state selector]
  (let [snapshot (engine/open-snapshot eng state selector)
        src (reify source/IPatternSource
              (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v})
                                       (engine/scan eng snapshot pattern))))]
    (datalog/q src '{:find [?name] :where [["file" :file/name ?name]]} (constantly true))))
(case (first *command-line-args*)
  "write"
  (do (ensure! (.mkdir (java.io.File. base)) "output exists")
      (ensure! (.mkdir (java.io.File. staging)) "staging exists")
      (store/init! dir)
      (let [db (backend) first-batch (blocks/open-transaction db) eng (make-engine first-batch)
            s0 (engine/empty-state eng "forest/tx-fixture")
            first-tx (engine/transact eng s0 {:database-id "forest/tx-fixture" :request-id "tx-1"
                                             :tx-data [[:db/add "file" :file/name "alpha"]]})
            root1 (get-in first-tx [:receipt :physical-root])]
        (ensure! (nil? (storage/-read-ref db "db")) "ref advanced before flush")
        (ensure! (:published? ((:publish! first-batch) "db" nil root1)) "first CAS failed")
        (let [second-batch (blocks/open-transaction db)
              eng2 (make-engine second-batch)
              second-tx (engine/transact eng2 (:state first-tx)
                                        {:database-id "forest/tx-fixture" :request-id "tx-2"
                                         :tx-data [[:db/retract "file" :file/name "alpha"]
                                                   [:db/add "file" :file/name "beta"]]})
              root2 (get-in second-tx [:receipt :physical-root])]
          (ensure! (not= root1 root2) "roots did not change")
          (ensure! (= root1 (:cid (storage/-read-ref db "db"))) "ref advanced before second flush")
          (ensure! (:published? ((:publish! second-batch) "db" root1 root2)) "second CAS failed")
          (ensure! (false? (:published? (storage/-compare-and-set-ref! db "db" root1 root1))) "stale ref accepted")
          (spit (str base "/roots.edn") (pr-str {:root1 root1 :root2 root2}))
          (prn {:root1 root1 :root2 root2 :transactions 2 :stale-ref-refused true :pass true}))))
  "read"
  (let [db (backend) eng (make-engine (storage/ports db)) roots (edn/read-string (slurp (str base "/roots.edn")))
        head (:cid (storage/-read-ref db "db")) state (engine/restore-state eng head)
        old (engine/restore-state eng (:root1 roots))]
    (ensure! (= "bafyreia6sewmc3tpbmlnur4e4e5himj5yg4eya6e4igotbmtifvwweibmi" (:root1 roots)) "first logical input produced a different root")
    (ensure! (= "bafyreiczbylfrpsshqklrxp6jjc55k2jrkrvpakcdvm4eqjjrpoecuwgua" (:root2 roots)) "second logical input produced a different root")
    (ensure! (= head (:root2 roots)) "wrong recovered head")
    (ensure! (= #{["alpha"]} (names-at eng old {})) "old snapshot changed")
    (ensure! (= #{["alpha"]} (names-at eng state {:as-of 1})) "as-of differs")
    (ensure! (= #{["beta"]} (names-at eng state {})) "current query differs")
    (prn {:head head :old-query :alpha :as-of-1 :alpha :current :beta :pass true}))
  (throw (ex-info "use write or read" {})))
(shutdown-agents)
