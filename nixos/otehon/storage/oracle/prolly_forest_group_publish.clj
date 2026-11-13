;; Hosted reference publication of two Forest archives as one Prolly basis.
(require '[otehon.storage :as store] '[otehon.ipld-forest :as catalog])
(import '[java.nio.file Files Paths])
(def directory (or (System/getenv "GROUP_FOREST_STORE") (throw (ex-info "GROUP_FOREST_STORE required" {}))))
(def basis "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri")
(def roots ["bafyreia5f47e462gm43mxscjphe4n6wyi56ccevdmwq526i4jcjuuphala"
            "bafyreidb7f6i335vyhbordfkte377frwmtq5axfpd44gpvxodjor643mhy"])
(def archives (mapv (fn [i root] {:root-cid root :bytes (Files/readAllBytes
                                 (Paths/get (str "nixos/otehon/storage/test/fixtures/prolly-forest/split/" i ".forest") (make-array String 0)))})
                    (range 2) roots))
(store/init! directory)
(prn (catalog/publish-group! directory "policy" basis archives))
