;; Actual hosted atomic staged stream, more than one 17 MiB archive.
(require '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[otehon.atomic-forest-stream :as stream]
         '[kotobase.storage.core :as contract] '[clojure.edn :as edn] '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util Arrays Random])
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn error [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn block [i]
 (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. (+ 532 i)) b)
       h (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw h)) :bytes b}))
(let [[mode root tool] *command-line-args* dir (str root "/store") stage (str root "/stage")
      batch (mapv block (range 18)) target (:cid (last batch)) next-block (block 19) next-target (:cid next-block)]
 (case mode
  "write"
  (do (check! (.mkdir (java.io.File. root)) "fresh root required")
      (check! (.mkdir (java.io.File. stage)) "fresh stage required")
      (store/init! dir)
      (let [before (store/read-store dir) leaked (atom nil)
            build! (fn [ports _ _]
                     (reset! leaked ports)
                     (doseq [{:keys [cid bytes]} batch] ((:put! ports) cid bytes))
                     (check! (Arrays/equals ^bytes (:bytes (first batch)) ^bytes ((:get-fn ports) (:cid (first batch)))) "flushed provisional block mismatch")
                     target)
            verify! (fn [get-block cid _ _]
                      (and (= cid target) (every? (fn [{:keys [cid bytes]}] (Arrays/equals ^bytes bytes ^bytes (get-block cid))) batch)))
            input {:receipt {:fixture true} :prepared {:fixture true}}
            bad (blocks/atomic-stream-receipt-publication-adapter dir stage tool "db" nil build! (fn [& _] false))]
       (let [external (:cid (first batch)) damaged (byte-array [1 2 3])
             existing (fn [_] damaged)
             probe (fn [ports] ((:get-fn ports) external) {:target target :value target})
             staged (fn [ports] ((:put! ports) target (:bytes (last batch))) {:target target :value target})]
        (check! (= :cid-mismatch (error #(stream/publish! dir (str stage "/bad-build") tool "db" nil existing probe (fn [& _] true)))) "bad existing block accepted during build")
        (check! (= before (store/read-store dir)) "bad build changed root")
        (check! (= :invalid-ipld-block (error #(stream/publish! dir (str stage "/bad-type") tool "db" nil (fn [_] false) probe (fn [& _] true)))) "invalid callback result accepted")
        (check! (= before (store/read-store dir)) "bad callback type changed root")
        (check! (= :cid-mismatch (error #(stream/publish! dir (str stage "/bad-closure") tool "db" nil existing staged (fn [get-block _] (get-block external) true)))) "bad existing block accepted during closure")
        (check! (= before (store/read-store dir)) "bad closure changed root")
        (let [original (:bytes (first batch))
              valid-probe (fn [ports]
                            (let [got ((:get-fn ports) external)]
                              (check! (Arrays/equals ^bytes original ^bytes got) "valid existing block rejected")
                              (check! (not (identical? original got)) "existing callback buffer escaped"))
                            (throw (ex-info "probe complete" {:type :probe-complete})))]
         (check! (= :probe-complete (error #(stream/publish! dir (str stage "/good-existing") tool "db" nil (fn [_] original) valid-probe (fn [& _] true)))) "valid fallback probe failed")
         (check! (= before (store/read-store dir)) "valid probe changed root")))
       (check! (= :closure-rejected (error #((:publish! bad) input))) "closure refusal missing")
       (check! (= before (store/read-store dir)) "failed closure changed root")
       (check! (= :transaction-closed (error #((:get-fn @leaked) target))) "scope remained open")
       (let [adapter (blocks/atomic-stream-receipt-publication-adapter dir stage tool "db" nil build! verify!)
             result ((:publish! adapter) input) after (store/read-store dir)
             log (edn/read-string (slurp (str dir "/" (get-in after [:root :log]) ".edn")))
             groups (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/") (keys (:state after)))
             group (edn/read-string (get-in after [:state (first groups)]))]
        (check! (= target result ((:read-ref! adapter))) "ref mismatch")
        (check! (= 1 (count groups)) "expected one group")
        (check! (= 2 (count (:archives group))) "expected two archives")
        (check! (= 1 (count (get-in log [:value :frames]))) "expected one WAL frame")
        (check! (= :put-many (get-in log [:value :frames 0 :op])) "expected grouped WAL")
        (check! (= :transaction-closed (error #((:put! @leaked) target (:bytes (last batch))))) "successful scope remained open")
        (let [build (fn [ports]
                      (check! (Arrays/equals ^bytes (:bytes (first batch)) ^bytes ((:get-fn ports) (:cid (first batch)))) "existing product block missing")
                      ((:put! ports) next-target (:bytes next-block))
                      {:target next-target :value :published})
              verify (fn [get-block cid]
                       (and (= cid next-target)
                            (Arrays/equals ^bytes (:bytes next-block) ^bytes (get-block next-target))
                            (Arrays/equals ^bytes (:bytes (first batch)) ^bytes (get-block (:cid (first batch))))))]
         (check! (= :published (blocks/publish-atomic-stream-ports! dir stage tool "db" target build verify)) "generic streamed publish failed")
         (let [updated (store/read-store dir)]
          (check! (= next-target (:cid (contract/-read-ref (blocks/open-backend dir stage tool) "db"))) "generic ref mismatch")
          (check! (= :stale-ref (error #(blocks/publish-atomic-stream-ports! dir stage tool "db" target build verify))) "stale generic writer accepted")
          (check! (= updated (store/read-store dir)) "stale generic writer changed root"))))))
  "read"
  (let [db (blocks/open-backend dir stage tool)]
   (check! (= next-target (:cid (contract/-read-ref db "db"))) "ref missing")
   (doseq [{:keys [cid bytes]} (conj batch next-block)] (check! (Arrays/equals ^bytes bytes ^bytes (contract/get-block db cid)) "readback mismatch")))
  (throw (ex-info "expected write/read" {})))
 (prn {:mode mode :initial-blocks (count batch) :replacement-blocks 1 :initial-logical-bytes (* 18 1024 1024) :initial-archives 2 :pass true}))
(shutdown-agents)
