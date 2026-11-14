;; A task-owned local PostgreSQL cluster is interrupted during an UPDATE.
(require '[clojure.edn :as edn] '[otehon.storage :as store] '[otehon.pack-store :as pack]
         '[otehon.postgres-witness :as pg] '[otehon.witnessed-pack-test])
(def base (or (System/getenv "PG_WITNESS_PROOF") (throw (ex-info "output required" {}))))
(def psql (or (System/getenv "PG_WITNESS_PSQL") (throw (ex-info "psql required" {}))))
(def service (or (System/getenv "PG_WITNESS_SERVICE") (throw (ex-info "service required" {}))))
(def store-id (apply str (repeat 64 "9")))
(def store-path (str base "/crash-postgres"))
(defn ensure! [v msg] (when-not v (throw (ex-info msg {}))))
(defn error-type [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn port [] (pg/port psql service store-id))
(case (first *command-line-args*)
 "prepare"
 (do (store/init! store-path)
     (let [root (:root (store/read-store store-path))]
       (#'pg/query! psql service (str "INSERT INTO awai_witness.root (store_id,root) VALUES ('" store-id "',decode('" (#'pg/wire root) "','hex'));\n"))
       (ensure! (= root ((:read! (port)))) "initial witness mismatch")
       (prn {:mode :prepare :pass true})))
 "write"
 (let [{:keys [paths bytes cid]} (#'otehon.witnessed-pack-test/fixture)
       outcome (error-type #(pack/import-logical-forest-files! store-path "proof" paths bytes cid {:expected-generation 1 :witness (port)}))]
   (ensure! (= :witness-commit-uncertain outcome) "writer reported wrong outcome")
   (prn {:mode :write :outcome outcome :pass true}))
 "verify"
 (let [w (port) trusted ((:read! w)) local (:root (store/read-store store-path)) unguarded (pack/summary (pack/recover store-path))]
   (ensure! (= 1 (:generation trusted)) "DB unexpectedly committed the interrupted update")
   (ensure! (= 2 (:generation local)) "expected locally published root")
   (ensure! (= 4 (count (get-in unguarded [:groups "proof" :packs]))) "published Pack set incomplete")
   (ensure! (= :witness-mismatch (error-type #(pack/recover-witnessed store-path (:read! w)))) "guarded read did not refuse")
   (prn {:mode :verify :db-generation 1 :local-generation 2 :packs 4 :guard :refused :pass true}))
 (throw (ex-info "prepare, write or verify required" {})))
(shutdown-agents)
