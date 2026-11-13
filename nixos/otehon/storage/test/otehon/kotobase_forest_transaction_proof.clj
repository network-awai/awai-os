;; Actual hosted Forest tool with explicit buffered transaction; modes are processes.
(require '[kotobase.storage.core :as contract] '[otehon.storage :as store]
         '[otehon.kotobase-forest-blocks :as forest] '[awai.fs.car :as car])
(import '[java.security MessageDigest])
(defn block [text]
  (let [bytes (.getBytes text "UTF-8")
        digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes))]
    {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes}))
(def bs (mapv block ["batch-one" "batch-two" "batch-three"]))
(defn check! [x msg] (when-not x (throw (ex-info msg {}))))
(let [[mode base tool] *command-line-args* dir (str base "/store") stage (str base "/staging")]
  (case mode
    "write" (do (check! (.mkdir (java.io.File. base)) "output exists")
      (check! (.mkdir (java.io.File. stage)) "staging exists")
      (store/init! dir)
      (let [db (forest/open-backend dir stage tool) tx (forest/open-transaction db)
            before (store/read-store dir) root (:cid (first bs))]
        (doseq [{:keys [cid bytes]} bs] (check! (= cid ((:put! tx) cid bytes)) "put failed"))
        (check! (= before (store/read-store dir)) "overlay published before commit")
        (check! (nil? (contract/get-block db root)) "unpublished block visible")
        (check! (:published? ((:publish! tx) "db" nil root)) "ref not published")
        (check! (= 1 (count (.listFiles (java.io.File. stage)))) "expected one staged batch")
        (check! (try ((:publish! tx) "db" root root) false (catch Exception _ true)) "transaction reused")
        (prn {:blocks 3 :staged-batches 1 :published true :pass true})))
    "fail" (do (check! (.mkdir (java.io.File. base)) "output exists")
      (check! (.mkdir (java.io.File. stage)) "staging exists")
      (store/init! dir)
      (let [db (forest/open-backend dir stage "/bin/echo") tx (forest/open-transaction db)
            before (store/read-store dir) root (:cid (first bs))]
        (doseq [{:keys [cid bytes]} bs] ((:put! tx) cid bytes))
        (check! (= :untrusted-forest-tool
                   (try ((:publish! tx) "db" nil root) nil (catch Exception e (:type (ex-data e)))))
                "expected compressor refusal")
        (check! (= before (store/read-store dir)) "failed flush changed root")
        (check! (nil? (contract/-read-ref db "db")) "failed flush published ref")
        (check! (try ((:publish! tx) "db" nil root) false (catch Exception _ true)) "failed transaction reusable")
        (prn {:flush-refused true :root-unchanged true :ref-absent true :pass true})))
    "read" (let [db (forest/open-backend dir stage tool) got (contract/-get-blocks db (mapv :cid bs))]
      (doseq [{:keys [cid bytes]} bs]
        (check! (java.util.Arrays/equals ^bytes bytes ^bytes (get got cid)) "block mismatch"))
      (check! (= (:cid (first bs)) (:cid (contract/-read-ref db "db"))) "ref mismatch")
      (prn {:blocks 3 :fresh-process true :ref-verified true :pass true}))
    (throw (ex-info "use write/read/fail" {}))))
