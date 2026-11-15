;; Hosted read-only block port over the existing synthetic GiB file.
(require '[otehon.pack-store :as pack] '[otehon.kotobase-forest-blocks :as blocks]
         '[kotobase.storage.core :as contract] '[awai.fs.car :as car])
(def store-dir (or (System/getenv "GIB_OVERLAY_STORE") (throw (ex-info "store required" {}))))
(def manifest-cid "bafyreidk3dxbsrqaocvdhfr624j4n75v6ddgmyfgkyu24z3lirlg5aj4g4")
(def fallback (reify contract/IBlockStore
                (-put-blocks! [_ _] (throw (ex-info "unexpected write" {})))
                (-get-blocks [_ _] {})
                contract/IBackendCapabilities
                (-capabilities [_] #{:immutable-blocks :cid-addressed-read})))
(def h (pack/recover store-dir))
(def b (blocks/open-logical-read-store fallback h "gib" manifest-cid))
(def manifest (contract/get-block b manifest-cid))
(def value (first (car/cbor-decode (mapv #(bit-and 255 %) manifest) 0)))
(def chunks (get value "chunks"))
(assert (= 1024 (count chunks)))
(def first-cid (car/cid-str (get-in (first chunks) ["cid" :bytes])))
(def bytes (contract/get-block b first-cid))
(assert (= 1048576 (alength ^bytes bytes)))
(assert (= first-cid (car/cid-str (car/cid-bytes car/codec-raw (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))))))
(assert (try (contract/-put-blocks! b [{:cid first-cid :bytes bytes}]) false (catch Exception _ true)))
(prn {:manifest manifest-cid :chunks (count chunks) :first-block-bytes (alength ^bytes bytes) :block-cid first-cid :write :refused :pass true})
(shutdown-agents)
