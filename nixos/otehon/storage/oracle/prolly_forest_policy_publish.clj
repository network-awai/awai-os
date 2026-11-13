;; Hosted Otehon publication for the basis-bound Dango/policy reference oracle.
(require '[otehon.storage :as store] '[otehon.ipld-forest :as catalog])
(import '[java.nio.file Files Paths])
(def directory (or (System/getenv "POLICY_FOREST_STORE")
                   (throw (ex-info "POLICY_FOREST_STORE required" {}))))
(def archive (Files/readAllBytes (Paths/get "nixos/otehon/storage/test/fixtures/prolly-forest/policy.forest" (make-array String 0))))
(store/init! directory)
(prn (catalog/publish! directory "policy" "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri" archive))
