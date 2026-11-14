;; Hosted fixture: new signed receipt publication after persistent frontier check.
(require '[clojure.string :as str]
         '[kotobase.frontier-store :as fs]
         '[otehon.kotobase-forest-blocks :as forest-blocks])
(def original (slurp "nixos/otehon/storage/oracle/proof_location_admission_write.clj"))
(load-string (first (str/split original #"\(defn guard-for")))
(def request (assoc request :nonce "fixture-persisted-frontier-20261114"))
(def opts (assoc opts :request request))
(def frontier-output (or (System/getenv "FRONTIER_FOREST_OUTPUT") (throw (ex-info "frontier output required" {}))))
(def fb (forest-blocks/open-backend (str frontier-output "/store") (str frontier-output "/stage") tool))
(defn guard-for [location-value proof-transform expected-policy events]
  (fn [{m :manifest r :request}]
    (swap! events conj :basis)
    (verify-location! m location-value signed-proof-cid signed-basis expected-policy)
    (when-not (= (:base/commit r) signed-basis) (throw (ex-info "basis mismatch" {})))
    (let [proof-bytes (or (catalog/get-group-block h signed-proof-cid)
                          (throw (ex-info "missing proof" {:type :missing-proof})))
          _ (writer/validate-ipld-block {:cid signed-proof-cid :bytes proof-bytes})
          proof (proof-transform (clojure.edn/read-string (String. ^bytes proof-bytes "UTF-8")))
          verify-entry #(verify-proof % checkpoint expected-policy)]
      ;; An unchanged head does not itself check a freshly fetched signature.
      (when-not (true? (verify-entry proof)) (throw (ex-info "invalid signed proof" {})))
      (= :unchanged (:status (fs/accept-and-store! fb "frontier" (:database-id checkpoint)
                                                    {:candidate-root (:root proof) :path [] :verify-entry verify-entry}))))))
(load-string (str "(defn negative!" (second (str/split original #"\(defn negative!" 2))))
