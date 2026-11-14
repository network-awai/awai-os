;; Hosted witnessed block/ref integration; raw leaf closure, no auth claim.
(require '[kotobase.storage.core :as contract] '[awai.fs.car :as car]
         '[otehon.storage :as store] '[otehon.postgres-witness :as pg]
         '[otehon.ipld-forest :as catalog]
         '[otehon.kotobase-forest-blocks :as adapter])
(def proof-dir (or (System/getenv "PG_WITNESS_PROOF") (throw (ex-info "proof directory required" {}))))
(def psql (or (System/getenv "PG_WITNESS_PSQL") (throw (ex-info "psql required" {}))))
(def service (or (System/getenv "PG_WITNESS_SERVICE") (throw (ex-info "service required" {}))))
(def tool (or (System/getenv "PG_WITNESS_TOOL") (throw (ex-info "tool required" {}))))
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn kind [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn block-of [s]
  (let [bytes (.getBytes s "UTF-8") digest (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))]
    {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes}))
(let [d (str proof-dir "/kotobase-ref") stage (str proof-dir "/kotobase-ref-stage")
      id (apply str (repeat 64 "1")) _ (.mkdir (java.io.File. stage)) _ (store/init! d)
      initial (:root (store/read-store d))
      _ (#'pg/query! psql service (str "INSERT INTO awai_witness.root(store_id,root) VALUES ('" id "',decode('" (#'pg/wire initial) "','hex'));\n"))
      w (pg/port psql service id) leaf (block-of "standalone fully checked raw leaf")
      closure (fn [get-block cid]
                (and (= cid (:cid leaf)) (java.util.Arrays/equals ^bytes (:bytes leaf) ^bytes (get-block cid))))
      backend (adapter/open-witnessed-backend d stage tool w closure)]
  (check! (= [(:cid leaf)] (contract/-put-blocks! backend [leaf])) "leaf write failed")
  (let [before (store/read-store d) missing (:cid (block-of "absent"))]
    (check! (= :missing-ref-target (kind #(contract/-compare-and-set-ref! backend "db" nil missing))) "missing target accepted")
    (check! (= before (store/read-store d)) "missing target mutated root"))
  (check! (true? (:published? (contract/-compare-and-set-ref! backend "db" nil (:cid leaf)))) "ref CAS failed")
  (check! (= (:cid leaf) (:cid (contract/-read-ref backend "db"))) "ref read differs")
  (let [denied (adapter/open-witnessed-backend d stage tool w (fn [_ _] false))]
    (check! (= :closure-rejected (kind #(contract/-read-ref denied "db"))) "closure refusal bypassed"))
  (let [outcome (binding [store/*write-observer* (fn [e r] (when (= [e r] [:before-cas :witness]) (throw (ex-info "injected" {}))))]
                  (kind #(contract/-compare-and-set-ref! backend "db" (:cid leaf) (:cid leaf))))]
    (check! (= :witness-commit-uncertain outcome) "interrupted ref CAS reported success")
    (check! (= :witness-pending (kind #(contract/-read-ref backend "db"))) "pending ref read succeeded"))
  (let [old ((:status! w)) group-key (first (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/")
                                                   (keys (:state (store/read-store d)))))
        group-name (subs group-key (count "awai.ipld-forest-group/"))
        group (get-in (catalog/recover-group d group-name) [:group])
        ref (first (:archives group)) f (java.nio.file.Paths/get (str d "/" (:archive-sha ref) ".forest") (make-array String 0))
        withheld (java.nio.file.Paths/get (str proof-dir "/ref-withheld") (make-array String 0))]
    (java.nio.file.Files/move f withheld (make-array java.nio.file.CopyOption 0))
    (try
      (check! (= :missing-forest (kind #(adapter/reconcile-witnessed-backend! d w closure))) "missing closure recovered")
      (check! (= old ((:status! w))) "missing closure changed witness")
      (finally (java.nio.file.Files/move withheld f (make-array java.nio.file.CopyOption 0))))
    (check! (= :committed-pending (:outcome (adapter/reconcile-witnessed-backend! d w closure))) "ref reconciliation failed")
    (check! (= :already-consistent (:outcome (adapter/reconcile-witnessed-backend! d w closure))) "ref reconciliation not idempotent"))
  (check! (= (:cid leaf) (:cid (contract/-read-ref backend "db"))) "recovered ref differs")
  (let [second-leaf (block-of "additional immutable raw block")]
    (check! (= [(:cid second-leaf)] (contract/-put-blocks! backend [second-leaf])) "block after ref failed")
    (check! (java.util.Arrays/equals ^bytes (:bytes second-leaf) ^bytes (get (contract/-get-blocks backend [(:cid second-leaf)]) (:cid second-leaf))) "new block differs"))
  (prn {:real-tool true :postgres true :raw-leaf-closure true :ref-cas true :missing-target :refused
        :closure-denied :refused :pending :refused :missing-archive :refused :reconciled true :later-block true :pass true}))
(shutdown-agents)
