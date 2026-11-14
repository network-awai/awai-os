;; Real pinned hosted Forest writer, local atom witness; not independent trust.
(require '[clojure.string :as str] '[otehon.storage :as store]
         '[otehon.forest-writer :as writer] '[otehon.ipld-forest :as catalog])
(def helper (slurp "nixos/otehon/storage/test/otehon/ipld_forest_writer_proof.clj"))
(load-string (subs helper 0 (str/index-of helper "(let [[mode base tool]")))
(let [[base tool] *command-line-args* d (str base "/store")]
  (check! (.mkdir (java.io.File. base)) "output must not exist")
  (store/init! d)
  (let [trusted (atom (:root (store/read-store d)))
        w {:read! #(deref trusted)
           :compare-and-set! (fn [old next] (locking trusted
                                               (if (= @trusted old) (do (reset! trusted next) true) false)))}
        bs (blocks)
        result (writer/put-ipld-blocks! d "test" basis bs (str base "/stage") tool 1 w)
        h (catalog/recover-group-witnessed d "test" (:read! w))]
    (check! (= 2 (:archive-count result)) "expected two archives")
    (check! (= 20 (:block-count result)) "expected 20 blocks")
    (check! (= @trusted (:basis h)) "witness root differs")
    (doseq [{:keys [cid bytes]} bs]
      (check! (java.util.Arrays/equals ^bytes bytes ^bytes (catalog/get-group-block h cid)) "recovered CID bytes differ"))
    (prn {:witnessed-writer true :archives 2 :blocks 20 :all-cids-verified true :pass true})))
