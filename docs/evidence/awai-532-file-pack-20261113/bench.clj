(require '[clojure.string :as str])
(let [s (slurp "nixos/otehon/storage/test/otehon/atomic_logical_proof.clj")
      i (str/index-of s "(let [[mode dir a b c]")]
  (when-not i (throw (ex-info "test helpers missing" {})))
  (load-string (subs s 0 i)))
(let [dir (first *command-line-args*) files (fixtures) start (System/nanoTime)]
  (store/init! dir)
  (let [result (publish dir files) elapsed (/ (- (System/nanoTime) start) 1000000.0)]
    (prn {:mode (if (= "1" (System/getenv "AWAI_FILE_INPUT")) :file :memory)
          :elapsed-ms elapsed :logical-bytes 2097152 :packs (count (:packs (:group result)))
          :manifest (get-in result [:group :manifest-cid])})))
