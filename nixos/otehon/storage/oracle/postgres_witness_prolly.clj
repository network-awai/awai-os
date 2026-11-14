;; Dated hosted JVM reference. Synthetic keys/identity crypto; not Native.
(require '[clojure.edn :as edn] '[clojure.string :as str] '[ipld.core :as ipld]
         '[kotobase.storage.core :as storage] '[kotobase.engine.prolly :as prolly]
         '[kotobase.engine.contract :as engine] '[datom.source :as source] '[datalog.core :as datalog]
         '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[otehon.postgres-witness :as pg] '[otehon.ipld-forest :as catalog])
(import '[java.security MessageDigest] '[java.util HexFormat] '[java.nio.file Files Paths CopyOption])
(def base (or (System/getenv "PG_PROLLY_OUTPUT") (throw (ex-info "output required" {}))))
(def psql (or (System/getenv "PG_WITNESS_PSQL") (throw (ex-info "psql required" {}))))
(def service (or (System/getenv "PG_WITNESS_SERVICE") (throw (ex-info "service required" {}))))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "tool required" {}))))
(def store-id (or (System/getenv "PG_PROLLY_STORE_ID") (apply str (repeat 64 "0"))))
(when-not (re-matches #"[a-f0-9]{64}" store-id) (throw (ex-info "invalid test store ID" {})))
(def store-path (str base "/store"))
(def staging (str base "/staging"))
(def limits {:max-blocks 256 :max-bytes (* 32 1024 1024) :max-depth 64 :max-edges 4096})
(defn ensure! [v msg] (when-not v (throw (ex-info msg {}))))
(defn kind [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn sha [s] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))))
(defn fail! [type] (throw (ex-info "bounded closure refused" {:type type})))
(defn walk [get-fn root limits]
  (loop [pending [[root 0]] seen #{} order [] total 0 edges 0]
    (if-let [[cid depth] (first pending)]
      (if (contains? seen cid) (recur (subvec pending 1) seen order total edges)
        (let [_ (when (> (inc (count seen)) (:max-blocks limits)) (fail! :resource-limit))
              size (atom nil)
              node (ipld/get-node-bounded
                     (fn [requested] (when-let [b (get-fn requested)]
                                       (let [n (alength ^bytes b)]
                                         (when (> (+ total n) (:max-bytes limits)) (fail! :resource-limit))
                                         (reset! size n) b)))
                     cid {:max-bytes (* 850 1024) :max-depth 32 :max-items 100000})
              _ (when (nil? @size) (fail! :missing-block))
              links (ipld/links node) next-edges (+ edges (count links))]
          (when (> next-edges (:max-edges limits)) (fail! :resource-limit))
          (when (and (seq links) (>= depth (:max-depth limits))) (fail! :resource-limit))
          (recur (into (subvec pending 1) (map #(vector % (inc depth)) links))
                 (conj seen cid) (conj order cid) (+ total @size) next-edges)))
      {:blocks (count seen) :bytes total :edges edges :order order})))
(defn verifier [omitted lim]
  (fn [get-block cid]
    (walk (fn [x] (when-not (= x omitted) (get-block x))) cid lim) true))
(defn witness [] (pg/port psql service store-id))
(defn backend [verify!] (blocks/open-witnessed-backend store-path staging tool (witness) verify!))
(defn make-engine [ports]
  (let [{:keys [put! get-fn]} ports]
    (prolly/prolly-engine {:put! put! :get-fn get-fn :blind-fn #(str "fixture-blind:" %)
                           :encrypt-fn identity :decrypt-fn identity :digest-fn sha})))
(defn names-at [eng state selector]
  (let [snapshot (engine/open-snapshot eng state selector)
        src (reify source/IPatternSource
              (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (engine/scan eng snapshot pattern))))]
    (datalog/q src '{:find [?name] :where [["file" :file/name ?name]]} (constantly true))))
(case (first *command-line-args*)
 "write"
 (do (ensure! (.mkdir (java.io.File. staging)) "staging exists") (store/init! store-path)
     (let [initial (:root (store/read-store store-path))
           _ (#'pg/query! psql service (str "INSERT INTO awai_witness.root(store_id,root) VALUES ('" store-id "',decode('" (#'pg/wire initial) "','hex'));\n"))
           db (backend (verifier nil limits)) tx1 (blocks/open-transaction db) eng (make-engine tx1)
           state0 (engine/empty-state eng "forest/tx-fixture")
           first (engine/transact eng state0 {:database-id "forest/tx-fixture" :request-id "tx-1" :tx-data [[:db/add "file" :file/name "alpha"]]})
           root1 (get-in first [:receipt :physical-root])]
       (ensure! (:published? ((:publish! tx1) "db" nil root1)) "first publication failed")
       (let [tx2 (blocks/open-transaction db) eng2 (make-engine tx2)
             second (engine/transact eng2 (:state first) {:database-id "forest/tx-fixture" :request-id "tx-2"
                     :tx-data [[:db/retract "file" :file/name "alpha"] [:db/add "file" :file/name "beta"]]})
             root2 (get-in second [:receipt :physical-root])]
         (ensure! (not= root1 root2) "roots did not change")
         (ensure! (:published? ((:publish! tx2) "db" root1 root2)) "second publication failed")
         (ensure! (false? (:published? (storage/-compare-and-set-ref! db "db" root1 root1))) "stale ref accepted")
         (ensure! (= root2 (:cid (storage/-read-ref db "db"))) "wrong head")
         (spit (str base "/roots.edn") (pr-str {:root1 root1 :root2 root2}))
         (prn {:mode :write :transactions 2 :root1 root1 :root2 root2 :stale :refused :pass true}))))
 "read"
 (let [db (backend (verifier nil limits)) roots (edn/read-string (slurp (str base "/roots.edn")))
       head (:cid (storage/-read-ref db "db")) get-block #(storage/get-block db %)
       closure (walk get-block head limits) child (second (:order closure))
       eng (make-engine (storage/ports db)) state (engine/restore-state eng head) old (engine/restore-state eng (:root1 roots))]
   (ensure! (= head (:root2 roots)) "wrong recovered root")
   (ensure! (> (:blocks closure) 1) "expected linked DAG")
   (ensure! (= #{["alpha"]} (names-at eng old {})) "historical query differs")
   (ensure! (= #{["alpha"]} (names-at eng state {:as-of 1})) "as-of query differs")
   (ensure! (= #{["beta"]} (names-at eng state {})) "current query differs")
   (let [before (store/read-store store-path) status ((:status! (witness)))
         missing (backend (verifier child limits)) limited (backend (verifier nil (assoc limits :max-blocks 1)))]
     (ensure! (= :missing-block (kind #(storage/-compare-and-set-ref! missing "db" head head))) "missing child was accepted")
     (ensure! (= :resource-limit (kind #(storage/-compare-and-set-ref! limited "db" head head))) "closure limit was accepted")
     (ensure! (= before (store/read-store store-path)) "refused closure changed root")
     (ensure! (= status ((:status! (witness)))) "refused closure changed witness"))
   (let [keys (->> (keys (:state (store/read-store store-path)))
                   (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/")))
         key (first keys) name (subs key (count "awai.ipld-forest-group/"))
         archive (:archive-sha (first (get-in (catalog/recover-group store-path name) [:group :archives])))
         p (Paths/get (str store-path "/" archive ".forest") (make-array String 0))
         saved (Paths/get (str base "/withheld-archive") (make-array String 0)) before ((:status! (witness)))]
     (Files/move p saved (make-array CopyOption 0))
     (try (ensure! (= :missing-forest (kind #(storage/-read-ref db "db"))) "missing archive was accepted")
          (ensure! (= before ((:status! (witness)))) "missing archive changed witness")
          (finally (Files/move saved p (make-array CopyOption 0)))))
   (prn {:mode :read :head head :closure-blocks (:blocks closure) :closure-edges (:edges closure)
         :old :alpha :as-of :alpha :current :beta :missing-child :refused :limit :refused :missing-archive :refused :pass true}))
 (throw (ex-info "write or read required" {})))
(shutdown-agents)
