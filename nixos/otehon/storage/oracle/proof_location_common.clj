;; Fixture-only location record binding the recovered signed basis proof.
(load-file "nixos/otehon/storage/oracle/signed_basis_receipt_common.clj")
(def location {:location/version 1 :basis/proof signed-proof-cid
               :basis/physical signed-basis :authority/policy signed-policy})
(def manifest
  (let [unsigned (assoc (dissoc manifest :signature) :location/manifest (id/value-cid location))]
    (assoc unsigned :signature (sign "issuer" issuer unsigned))))
(def opts (assoc opts :manifest manifest))
(defn verify-location! [m loc expected-proof expected-basis expected-policy]
  (when-not (and (= #{:location/version :basis/proof :basis/physical :authority/policy} (set (keys loc)))
                 (= 1 (:location/version loc))
                 (= (:location/manifest m) (id/value-cid loc))
                 (= expected-proof (:basis/proof loc))
                 (= expected-basis (:basis/physical loc) (:data/commit m))
                 (= expected-policy (:authority/policy loc) (:authority/policy m)))
    (throw (ex-info "fixture location binding refused" {:type :invalid-location-binding})))
  true)
(defn manifest-signature-valid? [m]
  (true? (verifier {:record :execution-manifest :tenant "test" :epoch 7
                    :payload-cid (id/payload-cid m) :signature (:signature m)})))
(assert (manifest-signature-valid? manifest))
(assert (verify-location! manifest location signed-proof-cid signed-basis signed-policy))
(assert (try (verify-location! manifest location "different-proof" signed-basis signed-policy) false (catch Exception _ true)))
(def changed (assoc location :basis/proof "different-proof"))
(assert (try (verify-location! manifest changed signed-proof-cid signed-basis signed-policy) false (catch Exception _ true)))
(assert (not (manifest-signature-valid? (assoc manifest :location/manifest (id/value-cid changed)))))
