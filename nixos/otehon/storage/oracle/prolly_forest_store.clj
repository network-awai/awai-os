;; Hosted Otehon reference bridge for the AWAI-532 Prolly/Forest proof.
;; Every call opens the persisted store and revalidates the entire <=1 MiB
;; Forest object. This is not a product blockstore or a bounded random-read API.
(require '[awai.fs.car :as car] '[otehon.forest :as forest]
         '[otehon.storage :as store] '[clojure.edn :as edn])
(import '[java.nio.file Files Paths LinkOption])
(def directory (or (System/getenv "PROLLY_FOREST_STORE")
                   (throw (ex-info "PROLLY_FOREST_STORE required" {}))))
(def root "bafyreiakmttcp6otxvnyqmdjpzlschlskibp7enadlvkguw3nnp47f5wqm")
(def archive-path "nixos/otehon/storage/test/fixtures/prolly-forest/prolly.forest")
(let [[action cid] *command-line-args*]
  (case action
    "publish" (let [archive (Files/readAllBytes (Paths/get archive-path (make-array String 0)))
                    h (forest/open archive)
                    _ (when-not (forest/get-block h (car/base32-decode (subs root 1)))
                        (throw (ex-info "root block absent" {})))
                    digest (otehon.segmented/sha archive)]
                (store/init! directory)
                (store/transact! directory :put {:key "prolly/root" :value (pr-str {:archive digest :cid root})}
                                 (fn [dir _] (when-not (= digest (store/write-forest! dir archive))
                                               (throw (ex-info "archive digest changed" {})))))
                (prn {:archive digest :bytes (alength archive) :cid root}))
    (let [value (get-in (store/read-store directory) [:state "prolly/root"])
          _ (when-not value (throw (ex-info "published root absent" {})))
          ref-data (edn/read-string value)]
      (case action
        "ref" (print (:cid ref-data))
        "get" (let [h (forest/open (store/read-forest directory (:archive ref-data)))
                    _ (car/parse-cid-str cid)
                    b (forest/get-block h (car/base32-decode (subs cid 1)))]
                (when-not b (throw (ex-info "CID absent" {:cid cid})))
                (.write System/out ^bytes b))
        (throw (ex-info "invalid action" {}))))))
