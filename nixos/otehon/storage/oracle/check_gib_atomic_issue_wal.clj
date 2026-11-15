(require '[otehon.storage :as store] '[clojure.edn :as edn] '[clojure.string :as str])
(let [dir (or (System/getenv "GIB_ISSUED_STORE") (throw (ex-info "store required" {})))
      s (store/read-store dir) log (:value (edn/read-string (slurp (str dir "/" (get-in s [:root :log]) ".edn"))))
      frames (:frames log) refs #{"awai.kotobase-ref/allow" "awai.kotobase-ref/deny"}
      groups (for [frame frames :when (= :put-many (:op frame))
                   :let [puts (into {} (get-in frame [:payload :puts])) ref (first (filter refs (keys puts)))
                         ks (filter #(str/starts-with? % "awai.ipld-forest-group/") (keys puts))]
                   :when ref]
               (do (assert (= 2 (count puts))) (assert (= 1 (count ks)))
                   (assert (= (get puts ref) (get-in s [:state ref])))
                   (assert (= (get puts (first ks)) (get-in s [:state (first ks)]))) ref))]
 (assert (= refs (set groups))) (assert (= 2 (count groups)))
 (prn {:allow-and-deny :separate-group-ref-frames :count (count groups) :pass true}))
(shutdown-agents)
