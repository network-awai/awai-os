;; Hosted atomic bounded block batch and ref, real Forest writer.
(require '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[kotobase.storage.core :as contract] '[clojure.edn :as edn] '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util Arrays Random])
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn error [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn block [seed]
 (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. seed) b)
       digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes b}))
(let [[mode root tool] *command-line-args* dir (str root "/store") stage (str root "/stage")
      batch [(block 123) (block 124)] target (:cid (first batch))]
 (case mode
  "write"
  (do (check! (.mkdir (java.io.File. root)) "fresh root required")
      (check! (.mkdir (java.io.File. stage)) "fresh stage required")
      (store/init! dir)
      (let [before (store/read-store dir)
            verify! (fn [get-block cid]
                      (and (= cid target) (every? (fn [{:keys [cid bytes]}] (Arrays/equals ^bytes bytes ^bytes (get-block cid))) batch)))]
       (check! (= :closure-rejected (error #(blocks/publish-atomic-batch! dir stage tool "db" nil target batch (fn [_ _] false)))) "bad closure accepted")
       (check! (= before (store/read-store dir)) "closure refusal changed state")
       (check! (false? (:published? (blocks/publish-atomic-batch! dir stage tool "db" (:cid (second batch)) target batch verify!))) "stale ref accepted")
       (check! (= before (store/read-store dir)) "stale ref changed state")
       (let [ack (blocks/publish-atomic-batch! dir stage tool "db" nil target batch verify!)
             after (store/read-store dir) log (edn/read-string (slurp (str dir "/" (get-in after [:root :log]) ".edn")))
             groups (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/") (keys (:state after)))]
        (check! (:published? ack) "publication failed")
        (check! (= 1 (count groups)) "expected one group")
        (check! (= 1 (count (get-in log [:value :frames]))) "expected one WAL frame")
        (check! (= :put-many (get-in log [:value :frames 0 :op])) "expected grouped WAL"))))
  "read"
  (let [db (blocks/open-backend dir stage tool) got (contract/-get-blocks db (mapv :cid batch))]
   (check! (= target (:cid (contract/-read-ref db "db"))) "ref differs")
   (doseq [{:keys [cid bytes]} batch] (check! (Arrays/equals ^bytes bytes ^bytes (get got cid)) "block differs")))
  (throw (ex-info "expected write/read" {})))
 (prn {:mode mode :blocks 2 :block-bytes (* 1024 1024) :pass true}))
(shutdown-agents)
