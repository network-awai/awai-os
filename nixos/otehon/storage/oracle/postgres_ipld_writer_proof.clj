;; Real hosted Forest writer + PostgreSQL prepared witness. Test service only.
(require '[clojure.string :as str] '[otehon.storage :as store] '[otehon.forest-writer :as writer]
         '[otehon.pack-store :as pack] '[otehon.ipld-forest :as catalog] '[otehon.postgres-witness :as pg])
(def helper (slurp "nixos/otehon/storage/test/otehon/ipld_forest_writer_proof.clj"))
(load-string (subs helper 0 (str/index-of helper "(let [[mode base tool]")))
(def proof-dir (or (System/getenv "PG_WITNESS_PROOF") (throw (ex-info "proof directory required" {}))))
(def psql (or (System/getenv "PG_WITNESS_PSQL") (throw (ex-info "psql required" {}))))
(def service (or (System/getenv "PG_WITNESS_SERVICE") (throw (ex-info "service required" {}))))
(def tool (or (System/getenv "PG_WITNESS_TOOL") (throw (ex-info "tool required" {}))))
(let [d (str proof-dir "/generic-real-writer") id (apply str (repeat 64 "4"))
      _ (store/init! d) initial (:root (store/read-store d))
      _ (#'pg/query! psql service (str "INSERT INTO awai_witness.root(store_id,root) VALUES ('" id "',decode('" (#'pg/wire initial) "','hex'));\n"))
      w (pg/port psql service id) bs (blocks)
      outcome (binding [store/*write-observer* (fn [e r] (when (= [e r] [:before-cas :witness])
                                                             (throw (ex-info "injected" {}))))]
                (kind #(writer/put-ipld-blocks! d "test" basis bs (str proof-dir "/generic-real-stage") tool 1 w)))
      status ((:status! w))]
  (check! (= :witness-commit-uncertain outcome) "expected interrupted writer")
  (check! (= initial (:root status)) "witness committed too early")
  (check! (= (:root (store/read-store d)) (:pending status)) "prepared candidate differs")
  (check! (= :witness-pending (kind #(catalog/recover-group-witnessed d "test" w))) "pending group opened")
  (check! (= :committed-pending (:outcome (pack/reconcile-witnessed! d w))) "reconciliation failed")
  (let [h (catalog/recover-group-witnessed d "test" w)]
    (check! (= 2 (count (get-in h [:group :archives]))) "wrong archive count")
    (doseq [{:keys [cid bytes]} bs]
      (check! (java.util.Arrays/equals ^bytes bytes ^bytes (catalog/get-group-block h cid)) "CID bytes changed")))
  (prn {:real-writer true :postgres true :pending-refused true :reconciled true :archives 2 :blocks 20 :pass true}))
(shutdown-agents)
