;; Hosted atomic receipt ports with candidate and previously stored blocks.
(require '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[kotobase.storage.core :as contract] '[clojure.edn :as edn])
(import '[java.security MessageDigest] '[java.util Arrays Random])
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn err [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn block [size seed]
 (let [b (byte-array size) _ (.nextBytes (Random. seed) b)
       h (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw h)) :bytes b}))
(let [[mode root tool] *command-line-args* dir (str root "/store") stage (str root "/stage")
      old (block 32 57) batch [(block (* 1024 1024) 58) (block (* 1024 1024) 59)]
      target (:cid (first batch))]
 (case mode
  "write"
  (do (check! (.mkdir (java.io.File. root)) "fresh root required")
      (check! (.mkdir (java.io.File. stage)) "fresh stage required")
      (store/init! dir)
      (let [base (blocks/open-block-store dir stage tool) _ (contract/-put-blocks! base [old])
            initial (store/read-store dir) leaked (atom nil)
            build! (fn [ports _ _]
                     (reset! leaked ports)
                     (check! (Arrays/equals ^bytes (:bytes old) ^bytes ((:get-fn ports) (:cid old))) "existing block absent")
                     (doseq [{:keys [cid bytes]} batch] ((:put! ports) cid bytes))
                     (check! (Arrays/equals ^bytes (:bytes (first batch)) ^bytes ((:get-fn ports) target)) "provisional block absent")
                     target)
            verify! (fn [get-block cid _ _]
                      (and (= cid target)
                           (Arrays/equals ^bytes (:bytes old) ^bytes (get-block (:cid old)))
                           (every? (fn [{:keys [cid bytes]}] (Arrays/equals ^bytes bytes ^bytes (get-block cid))) batch)))
            input {:receipt {:fixture true} :prepared {:fixture true}}
            refused (blocks/atomic-receipt-publication-adapter dir stage tool "db" nil build! (fn [& _] false))]
       (check! (= :closure-rejected (err #((:publish! refused) input))) "closure refusal missing")
       (check! (= initial (store/read-store dir)) "refusal changed root")
       (check! (= :transaction-closed (err #((:get-fn @leaked) target))) "refused scope remained open")
       (let [stale (blocks/atomic-receipt-publication-adapter dir stage tool "db" (:cid old) build! verify!)]
        (check! (= :stale-ref (err #((:publish! stale) input))) "stale ref accepted")
        (check! (= initial (store/read-store dir)) "stale ref changed root"))
       (let [adapter (blocks/atomic-receipt-publication-adapter dir stage tool "db" nil build! verify!)
             result ((:publish! adapter) input) after (store/read-store dir)
             log (edn/read-string (slurp (str dir "/" (get-in after [:root :log]) ".edn")))]
        (check! (= target result ((:read-ref! adapter))) "receipt target mismatch")
        (check! (= (inc (get-in initial [:root :generation])) (get-in after [:root :generation])) "not one root update")
        (check! (= :put-many (:op (last (get-in log [:value :frames])))) "not grouped WAL")
        (check! (= :transaction-closed (err #((:put! @leaked) target (:bytes (first batch))))) "successful scope remained open"))))
  "read"
  (let [base (blocks/open-backend dir stage tool)]
   (check! (= target (:cid (contract/-read-ref base "db"))) "ref missing")
   (doseq [{:keys [cid bytes]} (conj batch old)]
    (check! (Arrays/equals ^bytes bytes ^bytes (contract/get-block base cid)) "recovered block mismatch")))
  (throw (ex-info "expected write/read" {})))
 (prn {:mode mode :candidate-blocks 2 :existing-block 1 :atomic-ref true :pass true}))
(shutdown-agents)
