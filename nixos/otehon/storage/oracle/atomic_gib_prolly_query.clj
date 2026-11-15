;; Hosted experiment: actual logical-file CID in the Prolly snapshot in the same
;; atomic Forest group as its GiB block closure. No authority/receipt claim.
(require '[otehon.atomic-forest-stream :as stream] '[otehon.storage :as store]
         '[otehon.pack-store :as pack] '[otehon.kotobase-ref :as refs]
         '[otehon.kotobase-forest-blocks :as fb] '[kotobase.storage.core :as storage]
         '[kotobase.engine.prolly :as prolly] '[kotobase.engine.contract :as eng]
         '[datom.source :as source] '[datalog.core :as datalog] '[awai.fs.car :as car])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def out (or (System/getenv "GIB_PROLLY_OUTPUT") (throw (ex-info "output required" {}))))
(def src (or (System/getenv "GIB_SOURCE") (throw (ex-info "source required" {}))))
(def file-cid "bafyreidk3dxbsrqaocvdhfr624j4n75v6ddgmyfgkyu24z3lirlg5aj4g4")
(def file-sha "1f7e0c0d3fefe5579e556a04f7796b7de01278916e49a6d31df864e16adf1708")
(defn sha [s] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))))
(defn engine [ports] (prolly/prolly-engine {:put! (:put! ports) :get-fn (:get-fn ports)
                                           :blind-fn #(str "fixture-blind:" %) :encrypt-fn identity
                                           :decrypt-fn identity :digest-fn sha}))
(defn verify! [get-block root]
 (let [e (engine {:put! (fn [& _] (throw (ex-info "read-only" {}))) :get-fn get-block})
       snap (eng/open-snapshot e (eng/restore-state e root))
       db (reify source/IPatternSource (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (eng/scan e snap pattern))))
       rows (datalog/q db '{:find [?cid] :where [["file/gib" :file/logical-cid ?cid]]} (constantly true))
       _ (assert (= #{[file-cid]} rows))
       manifest (or (get-block (ffirst rows)) (throw (ex-info "missing manifest" {})))
       decoded (first (car/cbor-decode (mapv #(bit-and 255 %) manifest) 0))
       chunks (get decoded "chunks") md (MessageDigest/getInstance "SHA-256")]
   (assert (= 1024 (count chunks)))
   (doseq [c chunks] (let [b (or (get-block (car/cid-str (get-in c ["cid" :bytes]))) (throw (ex-info "missing chunk" {})))]
                       (assert (= (get c "length") (alength ^bytes b))) (.update md ^bytes b)))
   (assert (= file-sha (.formatHex (HexFormat/of) (.digest md))))
   (prn {:query :actual-file-cid :chunks (count chunks) :sha file-sha :pass true}) true))
(case (first *command-line-args*)
 "write" (let [tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "tool required" {})))
               view (pack/logical-block-view (pack/recover (str src "/store")) "gib" file-cid)
               manifest ((:get-block view) file-cid)
               decoded (first (car/cbor-decode (mapv #(bit-and 255 %) manifest) 0))]
           (assert (.mkdir (java.io.File. out))) (store/init! (str out "/store"))
           (stream/publish! (str out "/store") (str out "/stage") tool "gib-prolly" nil (constantly nil)
             (fn [ports]
               (let [e (engine ports) st (eng/empty-state e "fixture/gib-file")
                     result (eng/transact e st {:database-id "fixture/gib-file" :request-id "gib-1"
                                               :tx-data [[:db/add "file/gib" :file/logical-cid file-cid]]})
                     root (get-in result [:receipt :physical-root])]
                 ((:put! ports) file-cid manifest)
                 (doseq [c (get decoded "chunks")]
                   (let [cid (car/cid-str (get-in c ["cid" :bytes]))] ((:put! ports) cid ((:get-block view) cid))))
                 {:target root :value root})) verify!))
 "read" (let [dir (str out "/store") backend (fb/open-backend dir (str out "/unused-stage") "/absent-writer")
              root (:cid (storage/-read-ref (refs/open-ref-store dir) "gib-prolly"))]
          (assert root) (assert (verify! #(storage/get-block backend %) root)))
 (throw (ex-info "write or read required" {})))
(shutdown-agents)
