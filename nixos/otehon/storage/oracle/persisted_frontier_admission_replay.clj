;; Read-only replay: real stored frontier, signed proof, fixture policy and receipt.
(require '[clojure.string :as str]
         '[kotobase.frontier-store :as fs]
         '[otehon.kotobase-forest-blocks :as forest-blocks])
(def original (slurp "nixos/otehon/storage/oracle/proof_location_admission_replay.clj"))
(load-string (first (str/split original #"\(defn guard")))
(def frontier-output (or (System/getenv "FRONTIER_FOREST_OUTPUT") (throw (ex-info "output required" {}))))
(def fb (forest-blocks/open-backend (str frontier-output "/store") (str frontier-output "/stage") tool))
(defn guard [events change-proof]
  (fn [{m :manifest r :request}]
    (swap! events conj :basis)
    (verify-location! m location signed-proof-cid signed-basis signed-policy)
    (when-not (= (:base/commit r) signed-basis) (throw (ex-info "basis mismatch" {})))
    (let [raw (or (catalog/get-group-block h signed-proof-cid) (throw (ex-info "missing proof" {})))
          _ (writer/validate-ipld-block {:cid signed-proof-cid :bytes raw})
          proof (change-proof (edn/read-string (String. ^bytes raw "UTF-8")))
          verify-entry #(verify-proof % checkpoint signed-policy)]
      ;; accept-head's unchanged case does not reverify a proof; verify the
      ;; freshly fetched proof explicitly before comparing the persisted head.
      (when-not (true? (verify-entry proof)) (throw (ex-info "invalid signature or checkpoint" {})))
      (let [v (fs/accept-and-store! fb "frontier" (:database-id checkpoint)
                                    {:candidate-root (:root proof) :path [] :verify-entry verify-entry})]
        (= :unchanged (:status v))))))
(load-string (str "(defn checked-options" (second (str/split original #"\(defn checked-options" 2))))
