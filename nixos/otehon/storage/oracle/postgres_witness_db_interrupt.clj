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
 (let [w (port) status ((:status! w)) trusted (:root status) local (:root (store/read-store store-path)) unguarded (pack/summary (pack/recover store-path))]
   (ensure! (= 1 (:generation trusted)) "DB unexpectedly committed the interrupted update")
   (ensure! (= local (:pending status)) "DB did not retain prepared candidate")
   (ensure! (= 2 (:generation local)) "expected locally published root")
   (ensure! (= 4 (count (get-in unguarded [:groups "proof" :packs]))) "published Pack set incomplete")
   (ensure! (= :witness-pending (error-type #(pack/recover-witnessed store-path w))) "guarded read did not refuse")
   (prn {:mode :verify :db-generation 1 :local-generation 2 :packs 4 :guard :refused :pass true}))
 "reconcile"
 (let [w (port) before ((:status! w))
       f (first (filter #(re-matches #"[0-9a-f]{64}\.forest" (.getName %)) (.listFiles (java.io.File. store-path))))
       withheld (java.nio.file.Paths/get (str base "/db-interrupt-withheld") (make-array String 0))]
   (ensure! f "published Pack missing before negative control")
   (java.nio.file.Files/move (.toPath f) withheld (make-array java.nio.file.CopyOption 0))
   (try
     (ensure! (= :missing-forest (error-type #(pack/reconcile-witnessed! store-path w))) "missing Pack was accepted")
     (ensure! (= before ((:status! w))) "missing Pack changed witness")
     (finally (java.nio.file.Files/move withheld (.toPath f) (make-array java.nio.file.CopyOption 0))))
   (ensure! (= :committed-pending (:outcome (pack/reconcile-witnessed! store-path w))) "prepared candidate not committed")
   (ensure! (= :already-consistent (:outcome (pack/reconcile-witnessed! store-path w))) "reconcile is not idempotent")
   (ensure! (= 4 (count (get-in (pack/summary (pack/recover-witnessed store-path w)) [:groups "proof" :packs]))) "reconciled group missing")
   (prn {:mode :reconcile :missing-pack :refused :witness :committed :packs 4 :pass true}))
 (throw (ex-info "prepare, write or verify required" {})))
(shutdown-agents)
