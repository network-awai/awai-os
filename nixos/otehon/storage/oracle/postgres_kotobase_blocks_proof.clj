;; Hosted block-port proof with real Forest tool and isolated PostgreSQL.
(require '[clojure.string :as str] '[kotobase.storage.core :as contract]
         '[otehon.storage :as store] '[otehon.pack-store :as pack]
         '[otehon.postgres-witness :as pg] '[otehon.ipld-forest :as catalog]
         '[otehon.kotobase-forest-blocks :as adapter])
(def helper (slurp "nixos/otehon/storage/test/otehon/ipld_forest_writer_proof.clj"))
(load-string (subs helper 0 (str/index-of helper "(let [[mode base tool]")))
(def proof-dir (or (System/getenv "PG_WITNESS_PROOF") (throw (ex-info "proof directory required" {}))))
(def psql (or (System/getenv "PG_WITNESS_PSQL") (throw (ex-info "psql required" {}))))
(def service (or (System/getenv "PG_WITNESS_SERVICE") (throw (ex-info "service required" {}))))
(def tool (or (System/getenv "PG_WITNESS_TOOL") (throw (ex-info "tool required" {}))))
(defn bootstrap! [id root]
  (#'pg/query! psql service (str "INSERT INTO awai_witness.root(store_id,root) VALUES ('" id "',decode('" (#'pg/wire root) "','hex'));\n")))
(defn clone-initial! [from to]
  (check! (.mkdir (java.io.File. to)) "clone exists")
  (doseq [f (.listFiles (java.io.File. from))]
    (check! (.isFile f) "unexpected store entry")
    (java.nio.file.Files/copy (.toPath f) (.toPath (java.io.File. to (.getName f))) (make-array java.nio.file.CopyOption 0))))
(defn extra-block []
  (let [bytes (.getBytes "new witnessed Kotobase block" "UTF-8")
        digest (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))]
    {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes}))
(let [d (str proof-dir "/kotobase-witness") stale (str proof-dir "/kotobase-old")
      stage (str proof-dir "/kotobase-stage") id (apply str (repeat 64 "3"))
      _ (check! (.mkdir (java.io.File. stage)) "staging exists") _ (store/init! d)
      initial (:root (store/read-store d)) _ (clone-initial! d stale) _ (bootstrap! id initial)
      w (pg/port psql service id) b (adapter/open-witnessed-block-store d stage tool w)
      bs (blocks) cids (mapv :cid bs)]
  (check! (= cids (contract/-put-blocks! b bs)) "block write acknowledgement differs")
  (let [got (contract/-get-blocks b cids)]
    (doseq [{:keys [cid bytes]} bs]
      (check! (java.util.Arrays/equals ^bytes bytes ^bytes (get got cid)) "block bytes differ")))
  (let [before (store/read-store d)]
    (check! (= cids (contract/-put-blocks! b bs)) "idempotent block write differs")
    (check! (= before (store/read-store d)) "idempotent write changed root"))
  (let [flag (atom false) status! (:status! w)
        moving (assoc w :status! #(let [s (status!)] (if @flag (assoc s :pending (:root s)) s)))
        check-port (adapter/open-witnessed-block-store d stage tool moving)
        original catalog/get-group-block]
    (check! (= :witness-pending
               (with-redefs [catalog/get-group-block (fn [h cid] (let [v (original h cid)] (reset! flag true) v))]
                 (kind #(contract/-get-blocks check-port [(first cids)]))))
            "mid-read witness change released bytes"))
  (let [extra (extra-block)
        outcome (binding [store/*write-observer* (fn [event role]
                          (when (= [event role] [:before-cas :witness]) (throw (ex-info "injected" {}))))]
                  (kind #(contract/-put-blocks! b [extra])))]
    (check! (= :witness-commit-uncertain outcome) "interrupted write not uncertain")
    (check! (= :witness-pending (kind #(contract/-get-blocks b [(first cids)]))) "pending read returned data")
    (check! (= :witness-pending (kind #(contract/-put-blocks! b []))) "pending empty write acknowledged")
    (check! (= :committed-pending (:outcome (pack/reconcile-witnessed! d w))) "reconciliation failed")
    (check! (java.util.Arrays/equals ^bytes (:bytes extra) ^bytes (get (contract/-get-blocks b [(:cid extra)]) (:cid extra))) "recovered new block differs"))
  (let [old (adapter/open-witnessed-block-store stale stage tool w)]
    (check! (= :witness-mismatch (kind #(contract/-get-blocks old []))) "stale store opened"))
  (let [unknown (str proof-dir "/kotobase-unknown") id2 (apply str (repeat 64 "2"))]
    (store/init! unknown) (store/transact! unknown :put {:key "unknown/entry" :value "x"})
    (bootstrap! id2 (:root (store/read-store unknown)))
    (let [b2 (adapter/open-witnessed-block-store unknown stage tool (pg/port psql service id2))]
      (check! (= :unverified-catalog-type (kind #(contract/-get-blocks b2 []))) "unknown namespace admitted")))
  (prn {:real-writer true :postgres true :blocks 20 :idempotent true :mid-read-change :refused
        :pending :refused :reconciled true :stale :refused :unknown :refused :pass true}))
(shutdown-agents)
