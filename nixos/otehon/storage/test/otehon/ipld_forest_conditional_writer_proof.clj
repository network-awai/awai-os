;; Real hosted compressor and conditional publication; not distributed fencing.
(require '[clojure.string :as str] '[otehon.storage :as store]
         '[otehon.forest-writer :as writer] '[otehon.ipld-forest :as catalog])
(def helper (slurp "nixos/otehon/storage/test/otehon/ipld_forest_writer_proof.clj"))
(load-string (subs helper 0 (str/index-of helper "(let [[mode base tool]")))
(let [[base tool] *command-line-args* dir (str base "/store")]
  (check! (.mkdir (java.io.File. base)) "output must not exist")
  (store/init! dir)
  (let [initial (get-in (store/read-store dir) [:root :generation]) bs (blocks)]
    (check! (= :invalid-generation (kind #(writer/put-ipld-blocks! dir "test" basis bs (str base "/invalid") tool nil))) "nil was unconditional")
    (let [first-result (writer/put-ipld-blocks! dir "test" basis bs (str base "/first") tool initial)
          after (store/read-store dir)]
      (check! (= 2 (:archive-count first-result)) "expected two archives")
      (check! (= :stale-generation (kind #(writer/put-ipld-blocks! dir "test" basis bs (str base "/stale") tool initial))) "stale writer accepted")
      (check! (= after (store/read-store dir)) "stale writer changed store")
      (writer/put-ipld-blocks! dir "test" basis bs (str base "/next") tool (get-in after [:root :generation]))
      (check! (= basis (get-in (catalog/recover-group dir "test") [:group :basis-cid])) "basis changed")
      (prn {:conditional-two-pack true :stale-refused true :root-unchanged true :retry-current true :pass true}))))
