;; Actual hosted atomic staged stream, more than one 17 MiB archive.
(require '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[kotobase.storage.core :as contract] '[clojure.edn :as edn] '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util Arrays Random])
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn error [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn block [i]
 (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. (+ 532 i)) b)
       h (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw h)) :bytes b}))
(let [[mode root tool] *command-line-args* dir (str root "/store") stage (str root "/stage")
      batch (mapv block (range 18)) target (:cid (last batch))]
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
        (check! (= :transaction-closed (error #((:put! @leaked) target (:bytes (last batch))))) "successful scope remained open"))))
  "read"
  (let [db (blocks/open-backend dir stage tool)]
   (check! (= target (:cid (contract/-read-ref db "db"))) "ref missing")
   (doseq [{:keys [cid bytes]} batch] (check! (Arrays/equals ^bytes bytes ^bytes (contract/get-block db cid)) "readback mismatch")))
  (throw (ex-info "expected write/read" {})))
 (prn {:mode mode :blocks (count batch) :logical-bytes (* 18 1024 1024) :archives 2 :pass true}))
(shutdown-agents)
