(require '[otehon.storage :as store] '[clojure.edn :as edn] '[clojure.string :as str])
(def root (str (System/getenv "HOME") "/linked-recovery-174/"))
(doseq [n ["gib-atomic-governed-20261115" "gib-atomic-governed-v2-20261115"]]
 (let [s (store/read-store (str root n "/store"))]
  (assert (nil? (get-in s [:state "awai.kotobase-ref/snapshot"])))
  (prn {:unpublished n :pass true})))
(let [dir (str root "gib-atomic-governed-v3-20261115/store") s (store/read-store dir)
      log (:value (edn/read-string (slurp (str dir "/" (get-in s [:root :log]) ".edn"))))
      frame (last (:frames log)) puts (into {} (get-in frame [:payload :puts]))
      group-keys (filter #(str/starts-with? % "awai.ipld-forest-group/") (keys puts))]
 (assert (= :put-many (:op frame))) (assert (= 2 (count puts))) (assert (= 1 (count group-keys)))
 (assert (= (get puts "awai.kotobase-ref/snapshot") (get-in s [:state "awai.kotobase-ref/snapshot"])))
 (assert (= (get puts (first group-keys)) (get-in s [:state (first group-keys)])))
 (prn {:group-and-ref-one-wal-frame true :failed-candidates-unpublished true :pass true}))
(shutdown-agents)
