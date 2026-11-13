;; Hosted proof with pinned real Forest tool; each mode is a separate process.
(require '[clojure.string :as str] '[kotobase.storage.core :as contract]
         '[otehon.kotobase-forest-blocks :as adapter] '[otehon.storage :as store]
         '[otehon.ipld-forest :as catalog])
(def helper (slurp "nixos/otehon/storage/test/otehon/ipld_forest_writer_proof.clj"))
(load-string (subs helper 0 (str/index-of helper "(let [[mode base tool]")))
(defn block-of [text]
  (let [bytes (.getBytes text "UTF-8")
        digest (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))]
    {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes}))
(defn extra-block [] (block-of "independent later batch"))
(let [[mode base tool] *command-line-args* dir (str base "/store") staging (str base "/staging")]
  (case mode
    "write"
    (do (check! (.mkdir (java.io.File. base)) "output exists")
        (check! (.mkdir (java.io.File. staging)) "staging exists")
        (store/init! dir)
        (let [backend (adapter/open-backend dir staging tool)
              bs (blocks) vector-blocks (assoc bs 0 (update (first bs) :bytes #(mapv (fn [x] (bit-and 255 x)) %)))
              cids (mapv :cid bs)]
          (check! (= :single-writer-ref (contract/ref-profile (contract/validate-backend! backend))) "backend profile")
          (check! (= cids (contract/-put-blocks! backend vector-blocks)) "put order")
          (let [state (store/read-store dir)]
            (check! (= cids (contract/-put-blocks! backend bs)) "idempotent put")
            (check! (= state (store/read-store dir)) "idempotent put changed store")
            (check! (try (contract/-put-blocks! backend [(assoc (first bs) :bytes (.getBytes "bad" "UTF-8"))]) false (catch Exception _ true)) "bad CID accepted")
            (check! (= state (store/read-store dir)) "bad input changed store"))
          (check! (= [(:cid (extra-block))] (contract/-put-blocks! backend [(extra-block)])) "second batch")
          (check! (:published? (contract/-compare-and-set-ref! backend "db" nil basis)) "ref CAS failed")
          (prn {:put-blocks (count bs) :idempotent true :bad-cid-refused true :ref-published true})))
    "race"
    (do (check! (.mkdir (java.io.File. base)) "output exists")
        (check! (.mkdir (java.io.File. staging)) "staging exists")
        (store/init! dir)
        (let [backend (adapter/open-backend dir staging tool) gate (promise)
              x (block-of "race batch one") y (block-of "race batch two")
              a (future @gate (contract/-put-blocks! backend [x]))
              b (future @gate (contract/-put-blocks! backend [y]))]
          (deliver gate true)
          (check! (= [(:cid x)] @a) "first put failed")
          (check! (= [(:cid y)] @b) "second put failed")
          (let [got (contract/-get-blocks backend [(:cid x) (:cid y)])]
            (doseq [{:keys [cid bytes]} [x y]]
              (check! (java.util.Arrays/equals ^bytes bytes ^bytes (get got cid)) "racing batch lost")))
          (prn {:concurrent-batches 2 :both-recovered true :pass true})))
    "invalidate"
    (let [backend (adapter/open-backend dir staging tool)
          _ (check! (get (contract/-get-blocks backend [basis]) basis) "basis unavailable")
          state (:state (store/read-store dir))
          names (->> (keys state) (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/")))
          target (first (filter (fn [key]
                                  (let [name (subs key (count "awai.ipld-forest-group/"))]
                                    (catalog/get-group-block (catalog/recover-group dir name) basis))) names))]
      (check! target "basis group unavailable")
      (store/transact! dir :put {:key target :value "{:bad true}"})
      (check! (= :invalid-ipld-forest-group
                 (kind #(contract/-get-blocks backend [basis]))) "changed catalog was not rejected")
      (prn {:cache-invalidated true :invalid-catalog-refused true :pass true}))
    "read"
    (let [backend (adapter/open-backend dir staging tool) bs (blocks)
          bs (conj bs (extra-block)) cids (mapv :cid bs) got (contract/-get-blocks backend cids)
          refs (contract/-read-ref backend "db")
          missing (car/cid-str (car/cid-bytes car/codec-raw (vec (repeat 32 42))))
          entries (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/") (keys (:state (store/read-store dir))))
          names (map #(subs % (count "awai.ipld-forest-group/")) entries)
          archive-counts (map #(count (get-in (catalog/recover-group dir %) [:group :archives])) names)]
      (check! (= 2 (count entries)) "wrong group count")
      (check! (= #{1 2} (set archive-counts)) "expected one- and two-pack batches")
      (check! (= basis (:cid refs)) "ref did not persist")
      (doseq [{:keys [cid bytes]} bs]
        (check! (java.util.Arrays/equals ^bytes bytes ^bytes (get got cid)) "block changed"))
      (check! (empty? (contract/-get-blocks backend [missing])) "missing block returned")
      (check! (try (contract/-get-blocks backend [(car/cid-str (conj (car/base32-decode (subs basis 1)) 0))]) false (catch Exception _ true)) "trailing CID accepted")
      (prn {:recovered-blocks (count bs) :archives 2 :ref (:cid refs) :missing :omitted :pass true}))
    (throw (ex-info "use write, read, race or invalidate" {}))))
