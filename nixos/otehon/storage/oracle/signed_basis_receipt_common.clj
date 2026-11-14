(require '[clojure.string :as str])
(binding [*command-line-args* ["read"]]
 (load-string (first (str/split (slurp "nixos/otehon/storage/oracle/signed_basis_multipack.clj") #"\(defn fixture-blocks"))))
(def signed-proof-cid (get-in h [:group :basis-cid]))
(def signed-entry stored-proof)
(def accepted (frontier/accept-head {:candidate-root (:root signed-entry) :path [signed-entry] :verify-entry #(verify-proof % checkpoint pcid)}))
(assert (= :initialized (:status accepted)))
(let [queries (atom 0) bad (assoc-in signed-entry [:commit :logical-checkpoint-root] "wrong")]
 (assert (try (frontier/accept-head {:candidate-root (:root bad) :path [bad] :verify-entry #(verify-proof % checkpoint pcid)}) (swap! queries inc) false (catch Exception _ true)))
 (assert (zero? @queries)))
(def signed-policy pcid)
(def signed-basis basis)
(def src (slurp "nixos/otehon/storage/oracle/governed_forest_receipt.clj"))
(def prefix (first (str/split src #"\(store/init! receipt-dir\)")))
(def prefix (-> prefix
 (str/replace "(def h (catalog/recover-group data-dir \"test\"))" "(def h (catalog/recover-group data-dir \"signed-basis\"))")
 (str/replace "(def basis (get-in h [:group :basis-cid]))" "(def basis signed-basis)")))
(load-string prefix)
(assert (= signed-policy pcid))
(def proof-cid (get-in h [:group :basis-cid]))
(assert (= proof-cid signed-proof-cid))
;; The execution manifest retains its original location fixture. There is no
;; existing field which proves that it names this signed proof.
(assert (= (:data/commit manifest) signed-basis))
(assert (= (:authority/policy manifest) signed-policy))
