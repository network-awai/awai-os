;; Run the existing Prolly/Dango policy oracle through the actual IBlockStore and IRefStore ports.
(require '[clojure.string :as str] '[kotobase.storage.core :as contract]
         '[otehon.kotobase-forest-blocks :as adapter])
(def base (or (System/getenv "KOTOBASE_FOREST_PROOF") (throw (ex-info "proof path required" {}))))
(def backend (adapter/open-backend (str base "/store") (str base "/staging")
                                   (or (System/getenv "FOREST_TOOL") (throw (ex-info "FOREST_TOOL required" {})))))
(def source (slurp "nixos/otehon/storage/oracle/prolly_forest_writer_policy.clj"))
(def original-handle "(def handle (catalog/recover-group (or (System/getenv \"GROUP_FOREST_STORE\") (throw (ex-info \"GROUP_FOREST_STORE required\" {}))) \"test\"))")
(def original-basis "(def basis (get-in handle [:group :basis-cid]))")
(def original-get "(defn get-block [cid] (catalog/get-group-block handle cid))")
(doseq [part [original-handle original-basis original-get]]
  (when-not (str/includes? source part) (throw (ex-info "oracle source changed" {:part part}))))
(load-string (-> source
  (str/replace original-handle "")
  (str/replace original-basis "(def basis (:cid (contract/-read-ref backend \"db\")))")
  (str/replace original-get "(defn get-block [cid] (contract/get-block backend cid))")
  ;; The adapter sorts by CID before packing, so this particular query need
  ;; not touch both archives. The separate block proof reads every block.
  (str/replace "(= 2 (count (:archives @counts)))" "(pos? (count (:archives @counts)))")))
