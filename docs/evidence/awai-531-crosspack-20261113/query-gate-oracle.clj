;; One-off oracle, injected evaluator and receipt are test doubles, not Datomic or production authorization.
(require '[clojure.edn :as edn] '[kotobase.authorized-query :as q]
         '[otehon.storage :as store] '[otehon.pack-store :as pack] '[awai.fs.car :as car])
(import '[java.security MessageDigest])
(defn check! [x msg] (when-not x (throw (ex-info msg {}))))
(defn cid [b]
  (car/cid-str (car/cid-bytes car/codec-raw
    (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b)))))
(defn run [dir profile]
  (let [m (edn/read-string (get-in (store/read-store dir) [:state "proof/logical-file"]))
        basis (:cid m) leaf (nth (:chunks m) 8) handle (pack/recover dir)
        req {:find [:file/cid :chunk/cid] :where [[:file/name "file"]]
             :scope {:tenant "proof" :resources #{"file"} :purpose :test :basis basis} :limit 1}
        allow (fn [query] {:allowed? true :projection (set (:find query)) :basis basis :policy-cid "test-policy"})
        reads (atom 0)
        evaluator (fn [_ _] (swap! reads inc)
                    (let [b (if (= profile :forest)
                              (pack/read-forest-block handle "part-1" (car/base32-decode (subs (:cid leaf) 1)))
                              (pack/read-range-verified-leaves handle "part-1" 0 (:length leaf)))]
                      (check! (= (:cid leaf) (cid b)) "block mismatch")
                      [{:file/cid basis :chunk/cid (:cid leaf)}]))
        receipt (fn [_] {:receipt/durable? true :receipt/cid "test-double-not-durable"})
        before (:bytes-read @(:stats handle))
        reason (fn [auth] (:kotobase.query/reason (ex-data (try (q/compile! auth req) (catch Exception e e)))))]
    (check! (= :denied (reason #(assoc (allow %) :allowed? false))) "denial missing")
    (check! (= :basis-mismatch (reason #(assoc (allow %) :basis "stale"))) "stale basis accepted")
    (check! (= :projection-denied (reason #(assoc (allow %) :projection #{}))) "projection denial missing")
    (check! (and (zero? @reads) (= before (:bytes-read @(:stats handle)))) "denied query performed reads")
    (let [res (q/execute! evaluator receipt (q/compile! allow req))]
      (check! (= 1 @reads) "allowed evaluation count")
      {:profile profile :rows (:rows res) :basis (get-in res [:provenance :basis])
       :denied-reasons [:denied :basis-mismatch :projection-denied] :denied-storage-reads 0
       :policy :test-double :evaluator :test-double-not-datalog :receipt :test-double-not-durable})))
(let [a (run ".agent-output/crosspack-proof-2/zpack" :zpack)
      b (run ".agent-output/crosspack-proof-2/forest" :forest)]
  (check! (= (:rows a) (:rows b)) "query results differ")
  (prn {:oracle :kotobase-authorized-query :profiles [a b] :equal true :pass true}))
