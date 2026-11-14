;; Task-owned isolated PostgreSQL service. Never run against an existing DB.
(require '[clojure.edn :as edn] '[otehon.storage :as store] '[otehon.pack-store :as pack]
         '[otehon.postgres-witness :as pg] '[otehon.witnessed-pack-test])
(import '[java.nio.file Files Paths CopyOption])
(def base (or (System/getenv "PG_WITNESS_PROOF") (throw (ex-info "PG_WITNESS_PROOF required" {}))))
(def psql (or (System/getenv "PG_WITNESS_PSQL") (throw (ex-info "PG_WITNESS_PSQL required" {}))))
(def service (or (System/getenv "PG_WITNESS_SERVICE") (throw (ex-info "PG_WITNESS_SERVICE required" {}))))
(def store-id (apply str (repeat 64 "a")))
(def race-id (apply str (repeat 64 "b")))
(defn ensure! [v msg] (when-not v (throw (ex-info msg {}))))
(defn bootstrap! [id root]
  (#'pg/query! psql service (str "INSERT INTO awai_witness.root (store_id,root) VALUES ('" id "',decode('" (#'pg/wire root) "','hex'));\n")))
(defn error-type [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn copy-tree! [from to]
  (ensure! (.mkdir (java.io.File. to)) "copy target exists")
  (doseq [f (.listFiles (java.io.File. from))]
    (ensure! (.isFile f) "unexpected non-file in initial store")
    (Files/copy (.toPath f) (.toPath (java.io.File. to (.getName f))) (make-array CopyOption 0))))
(case (first *command-line-args*)
 "setup"
 (let [dir (str base "/store") _ (store/init! dir) initial (:root (store/read-store dir))
       _ (bootstrap! store-id initial) _ (bootstrap! race-id initial)
       w (pg/port psql service store-id) race (pg/port psql service race-id)
       _ (ensure! (= initial ((:read! w))) "initial root mismatch")
       n1 (assoc initial :generation 2 :tail 1 :log (apply str (repeat 64 "c")))
       n2 (assoc initial :generation 2 :tail 1 :log (apply str (repeat 64 "d")))
       a (future ((:compare-and-set! race) initial n1))
       b (future ((:compare-and-set! race) initial n2))
       outcomes [@a @b]]
   (ensure! (= [false true] (sort outcomes)) "concurrent CAS did not select exactly one")
   (ensure! (#{n1 n2} ((:read! race))) "CAS winner not persisted")
   (ensure! (= :invalid-witness (error-type #((:compare-and-set! race) initial initial))) "nonmonotonic CAS accepted")
   (copy-tree! dir (str base "/rollback"))
   (let [{:keys [paths bytes cid]} (#'otehon.witnessed-pack-test/fixture)
         result (pack/import-logical-forest-files! dir "proof" paths bytes cid {:expected-generation 1 :witness w})]
     (ensure! (= 2 (:generation result)) "import generation mismatch")
     (ensure! (= (:root (store/read-store dir)) ((:read! w))) "DB witness mismatch")
     (spit (str base "/expected.edn") (pr-str ((:read! w))))
     (ensure! (= :witness-mismatch (error-type #(pack/recover-witnessed (str base "/rollback") (:read! w)))) "restored old store was accepted")
     (ensure! (= 1 (get-in (pack/summary (pack/recover (str base "/rollback"))) [:basis :generation])) "rollback control mismatch")
     (prn {:mode :setup :concurrent-cas outcomes :packs 4 :rollback :refused :pass true})))
 "verify"
 (let [w (pg/port psql service store-id) expected (edn/read-string (slurp (str base "/expected.edn")))
       h (pack/recover-witnessed (str base "/store") (:read! w))
       offset (- (* 8 65536) 20)
       expected-bytes (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range offset (+ offset 40))))]
   (ensure! (= expected ((:read! w)) (:basis (pack/summary h))) "restart root mismatch")
   (ensure! (= 4 (count (get-in (pack/summary h) [:groups "proof" :packs]))) "missing Pack")
   (ensure! (java.util.Arrays/equals expected-bytes (pack/read-group-range h "proof" offset 40)) "cross-Pack bytes mismatch")
   (ensure! (= :witness-mismatch (error-type #(pack/recover-witnessed (str base "/rollback") (:read! w)))) "rollback accepted")
   (prn {:mode :verify :generation (:generation expected) :packs 4 :cross-pack true :rollback :refused :pass true}))
 "down"
 (let [w (pg/port psql service store-id)]
   (ensure! (= :witness-service-error (error-type #((:read! w)))) "unavailable database accepted")
   (prn {:mode :down :service-unavailable :refused :pass true}))
 (throw (ex-info "setup, verify or down required" {})))
(shutdown-agents)
