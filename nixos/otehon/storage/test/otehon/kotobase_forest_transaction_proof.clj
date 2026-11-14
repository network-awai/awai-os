;; Actual hosted Forest tool with explicit buffered transaction; modes are processes.
(require '[clojure.string :as str] '[kotobase.storage.core :as contract] '[otehon.storage :as store]
         '[otehon.kotobase-forest-blocks :as forest] '[otehon.ipld-forest :as catalog] '[awai.fs.car :as car])
(import '[java.security MessageDigest] '[java.util Random Arrays])
(defn block [text]
  (let [bytes (.getBytes text "UTF-8")
        digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes))]
    {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes}))
(def bs (mapv block ["batch-one" "batch-two" "batch-three"]))
(defn large-blocks []
  (let [rng (Random. 532174)]
    (mapv (fn [_]
            (let [bytes (byte-array (* 600 1024))
                  _ (.nextBytes rng bytes)
                  digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes))]
              {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes})) (range 2))))
(defn check! [x msg] (when-not x (throw (ex-info msg {}))))
(let [[mode base tool] *command-line-args* dir (str base "/store") stage (str base "/staging")]
  (case mode
    "scoped-write" (do (check! (.mkdir (java.io.File. base)) "output exists")
      (check! (.mkdir (java.io.File. stage)) "staging exists")
      (store/init! dir)
      (let [db (forest/open-backend dir stage tool) items (into bs (large-blocks))
            target (:cid (first items)) leaked (atom nil)
            value (forest/publish-scoped! db "db" nil
                    (fn [staged] (reset! leaked staged)
                      (check! (= (mapv :cid items) (contract/-put-blocks! staged items)) "staged blocks changed")
                      (check! (nil? (contract/-read-ref db "db")) "premature ref")
                      {:target target :value :published})
                    (fn [get-block cid]
                      (and (= cid target) (every? (fn [{:keys [cid bytes]}]
                                                   (Arrays/equals ^bytes bytes ^bytes (get-block cid))) items))))]
        (check! (= :published value) "not published")
        (check! (try (contract/-get-blocks @leaked [target]) false (catch Exception _ true)) "scope remained usable")
        (prn {:blocks (count items) :scoped-publication true :pass true})))
    "scoped-read" (let [db (forest/open-backend dir stage tool) items (into bs (large-blocks))
                        got (contract/-get-blocks db (mapv :cid items))
                        state (:state (store/read-store dir))
                        groups (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/") (keys state))]
      (check! (= 1 (count groups)) "expected one group")
      (check! (= (:cid (first items)) (:cid (contract/-read-ref db "db"))) "ref mismatch")
      (doseq [{:keys [cid bytes]} items]
        (check! (Arrays/equals ^bytes bytes ^bytes (get got cid)) "block mismatch"))
      (let [name (subs (first groups) (count "awai.ipld-forest-group/"))
            archives (get-in (catalog/recover-group dir name) [:group :archives])]
        (check! (= 2 (count archives)) "expected two physical Packs"))
      (prn {:blocks (count items) :packs 2 :fresh-process true :pass true}))
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
