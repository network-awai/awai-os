;; Hosted streaming multi-batch 1 MiB block and ref proof.
(require '[clojure.string :as str] '[awai.fs.car :as car] '[otehon.storage :as store]
         '[otehon.kotobase-forest-blocks :as forest] '[kotobase.storage.core :as contract])
(import '[java.security MessageDigest] '[java.util Arrays Random])
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn failure [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn items []
 (mapv (fn [i] (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. (+ 500 i)) b)
                      hash (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
                  {:cid (car/cid-str (car/cid-bytes car/codec-raw hash)) :bytes b})) (range 5)))
(let [[mode base tool] *command-line-args* dir (str base "/store") stage (str base "/stage")
      data (items) target (:cid (last data)) limits {:max-bytes (* 6 1024 1024) :max-blocks 5}]
 (case mode
  "write"
  (do (check! (.mkdir (java.io.File. base)) "fresh output required")
      (check! (.mkdir (java.io.File. stage)) "fresh staging required")
      (store/init! dir)
      (let [db (forest/open-backend dir stage tool)
            build! (fn [ports]
                     (doseq [{:keys [cid bytes]} data] ((:put! ports) cid bytes))
                     (check! (nil? (contract/-read-ref db "large-stream")) "ref visible before publish")
                     {:target target :value :published})
            verify! (fn [get-block root]
                      (and (= root target)
                           (every? (fn [{:keys [cid bytes]}] (Arrays/equals ^bytes bytes ^bytes (get-block cid))) data)))]
        (check! (= :closure-rejected (failure #(forest/publish-streamed-ports! db "large-stream" nil limits build! (fn [_ _] false)))) "closure rejection missing")
        (check! (nil? (contract/-read-ref db "large-stream")) "ref changed after rejection")
        (check! (some? (contract/get-block db target)) "expected retained orphan block")
        (check! (= :published (forest/publish-streamed-ports! db "large-stream" nil limits build! verify!)) "retry failed")
        (check! (= target (:cid (contract/-read-ref db "large-stream"))) "published ref mismatch")
        (let [before (:root (store/read-store dir))
              stale-build (fn [_] {:target target :value :unexpected})]
          (check! (= :stale-ref (failure #(forest/publish-streamed-ports! db "large-stream" nil limits stale-build verify!))) "stale ref accepted")
          (check! (= before (:root (store/read-store dir))) "stale CAS changed root"))))
  "read"
  (let [db (forest/open-backend dir stage tool)
        groups (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/") (keys (:state (store/read-store dir))))]
    (check! (= 2 (count groups)) "expected two independently published batches")
    (check! (= target (:cid (contract/-read-ref db "large-stream"))) "ref mismatch")
    (doseq [{:keys [cid bytes]} data]
      (check! (Arrays/equals ^bytes bytes ^bytes (contract/get-block db cid)) "block differs")))
  (throw (ex-info "expected write or read" {})))
 (prn {:mode mode :blocks 5 :block-bytes (* 1024 1024) :batches 2 :pass true}))
(shutdown-agents)
