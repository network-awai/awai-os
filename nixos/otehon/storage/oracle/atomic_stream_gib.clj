;; Hosted bounded atomic stream of a previously verified canonical GiB file.
(require '[clojure.edn :as edn] '[clojure.string :as str] '[awai.fs.car :as car]
         '[otehon.storage :as store] '[otehon.pack-store :as pack]
         '[otehon.kotobase-forest-blocks :as blocks] '[kotobase.storage.core :as contract])
(import '[java.security MessageDigest] '[java.util Arrays HexFormat])
(def manifest-cid "bafyreidk3dxbsrqaocvdhfr624j4n75v6ddgmyfgkyu24z3lirlg5aj4g4")
(def expected-sha "1f7e0c0d3fefe5579e556a04f7796b7de01278916e49a6d31df864e16adf1708")
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn manifest-value [bytes] (first (car/cbor-decode (mapv #(bit-and 255 %) bytes) 0)))
(defn chunks [bytes]
 (let [v (manifest-value bytes) c (get v "chunks")]
  (check! (= 1073741824 (get v "fileSize")) "size mismatch")
  (check! (= 1024 (count c)) "chunk count mismatch") c))
(defn check-file! [get-block manifest]
 (let [md (MessageDigest/getInstance "SHA-256")]
  (doseq [[i c] (map-indexed vector (chunks manifest))]
   (let [cid (car/cid-str (get-in c ["cid" :bytes])) b (get-block cid)]
    (check! (and b (= (get c "length") (alength ^bytes b))) "missing/short chunk")
    (.update md ^bytes b))
   (when (zero? (mod (inc i) 256)) (prn {:verified (inc i)}) (flush)))
  (check! (= expected-sha (.formatHex (HexFormat/of) (.digest md))) "full SHA mismatch") true))
(let [[mode] *command-line-args* base (or (System/getenv "GIB_ATOMIC_OUTPUT") (throw (ex-info "output required" {})))
      src (System/getenv "GIB_SOURCE") tool (or (System/getenv "FOREST_TOOL") "/nonexistent/no-writer")
      dir (str base "/store") stage (str base "/stage")]
 (case mode
  "write"
  (do (check! (string? src) "source required")
      (check! (.mkdir (java.io.File. base)) "fresh output required")
      (check! (.mkdir (java.io.File. stage)) "fresh stage required")
      (store/init! dir)
      (let [view (pack/logical-block-view (pack/recover (str src "/store")) "gib" manifest-cid)
            get-source (:get-block view) manifest (get-source manifest-cid)
            build! (fn [ports _ _]
                     (doseq [c (chunks manifest)]
                       (let [cid (car/cid-str (get-in c ["cid" :bytes])) b (get-source cid)]
                        (check! (and b (= (get c "length") (alength ^bytes b))) "source chunk missing")
                        ((:put! ports) cid b)))
                     ((:put! ports) manifest-cid manifest)
                     manifest-cid)
            verify! (fn [get-block cid _ _]
                      (and (= cid manifest-cid) (Arrays/equals ^bytes manifest ^bytes (get-block manifest-cid))
                           (check-file! get-block manifest)))
            adapter (blocks/atomic-stream-receipt-publication-adapter dir stage tool "gib" nil build! verify!)
            started (System/nanoTime)
            result ((:publish! adapter) {:receipt {:fixture true} :prepared {:fixture true}})
            after (store/read-store dir) group-key (first (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/") (keys (:state after))))
            group (edn/read-string (get-in after [:state group-key]))
            log (edn/read-string (slurp (str dir "/" (get-in after [:root :log]) ".edn")))]
       (check! (= manifest-cid result ((:read-ref! adapter))) "ref mismatch")
       (check! (= 61 (count (:archives group))) "expected 61 archives")
       (check! (= 1 (count (get-in log [:value :frames]))) "not one frame")
       (check! (= :put-many (get-in log [:value :frames 0 :op])) "not grouped WAL")
       (prn {:mode :write :logical-bytes 1073741824 :chunks 1024 :archives 61 :manifest manifest-cid
             :sha expected-sha :elapsed-ms (quot (- (System/nanoTime) started) 1000000) :pass true})))
  "read"
  (let [started (System/nanoTime) db (blocks/open-backend dir stage tool)
        ref (:cid (contract/-read-ref db "gib")) manifest (contract/get-block db manifest-cid)]
   (check! (= manifest-cid ref) "ref mismatch")
   (check! manifest "manifest missing")
   (check-file! #(contract/get-block db %) manifest)
   (prn {:mode :read :logical-bytes 1073741824 :chunks 1024 :manifest manifest-cid :sha expected-sha
         :elapsed-ms (quot (- (System/nanoTime) started) 1000000) :pass true}))
  (throw (ex-info "expected write/read" {}))))
(shutdown-agents)
