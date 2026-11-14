;; Local hosted oracle. All keys, policy authority and snapshot fields are fixtures.
(require '[clojure.string :as str])
(binding [*command-line-args* ["read"]]
  (load-string (first (str/split (slurp "nixos/otehon/storage/oracle/signed_basis_multipack.clj") #"\(defn fixture-blocks"))))
(require '[kotobase.frontier-store :as frontier-store]
         '[otehon.kotobase-forest-blocks :as forest-blocks])
(def output (or (System/getenv "FRONTIER_FOREST_OUTPUT") (throw (ex-info "output required" {}))))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "tool required" {}))))
(def dir (str output "/store"))
(def stage (str output "/stage"))
(def db-id (:database-id checkpoint))
(def verified? #(verify-proof % checkpoint pcid))
(defn assert! [v msg] (when-not v (throw (ex-info msg {}))))
(defn problem [f] (try (f) nil (catch Exception e (:problem (ex-data e)))))
(defn backend [] (forest-blocks/open-backend dir stage tool))
(defn opts [entry] {:candidate-root (:root entry) :path [entry] :verify-entry verified?})
(defn equivocation []
  (let [c (assoc (:commit stored-proof) :tx-root "other-fixture-transaction")
        r (sha (logical/logical-commit-string c))]
    (assoc stored-proof :commit c :root r
           :signature (ed/sign (ed/secret-key! issuer) (payload-bytes (payload r))))))
(case (first *command-line-args*)
 "write"
 (do (assert! (.mkdir (java.io.File. output)) "fresh output required")
     (store/init! dir)
     (assert! (.mkdir (java.io.File. stage)) "fresh stage required")
     (let [b (backend) bad (assoc stored-proof :signature (vec (repeat 64 0)))
           initial (:root (store/read-store dir))]
       (assert! (verified? stored-proof) "signed proof invalid")
       (assert! (= :unverified-commit (problem #(frontier-store/accept-and-store! b "frontier" db-id (assoc (opts bad) :allow-initialize? true)))) "bad signature accepted")
       (assert! (= initial (:root (store/read-store dir))) "denial mutated store")
       (let [r (frontier-store/accept-and-store! b "frontier" db-id (assoc (opts stored-proof) :allow-initialize? true))]
         (assert! (= :initialized (:status r)) "not initialized")
         (assert! (= (:root stored-proof) (get-in (frontier-store/read-frontier b "frontier" db-id) [:frontier :logical-commit-root])) "wrong stored frontier")
         (prn {:mode :write :signature :verified :frontier-cid (:frontier-cid r) :bad-signature :rejected :pass true}))))
 "read"
 (let [b (backend) saved (frontier-store/read-frontier b "frontier" db-id)
       alternate (equivocation)]
   (assert! (verified? stored-proof) "original proof invalid")
   (assert! (verified? alternate) "alternate signature invalid")
   (assert! (= (:root stored-proof) (get-in saved [:frontier :logical-commit-root])) "persisted root mismatch")
   (assert! (= :unchanged (:status (frontier-store/accept-and-store! b "frontier" db-id {:candidate-root (:root stored-proof) :path [] :verify-entry verified?}))) "unchanged failed")
   (assert! (= :equivocation (problem #(frontier-store/accept-and-store! b "frontier" db-id (opts alternate)))) "equivocation accepted")
   (assert! (= saved (frontier-store/read-frontier b "frontier" db-id)) "rejection changed frontier")
   (prn {:mode :read :signature :verified :frontier-cid (:cid saved) :same-epoch-signed-fork :rejected :pass true}))
 (throw (ex-info "write/read required" {})))
(shutdown-agents)
