;; Hosted integration oracle: actual Prolly + Datalog over product atomic stream ports.
(require '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as fb]
         '[otehon.kotobase-ref :as refs] '[kotobase.storage.core :as storage]
         '[kotobase.engine.prolly :as prolly] '[kotobase.engine.contract :as eng]
         '[datom.source :as source] '[datalog.core :as datalog] '[awai.fs.car :as car]
         '[clojure.edn :as edn] '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util HexFormat Random Arrays])
(defn require! [v msg] (when-not v (throw (ex-info msg {}))))
(defn sha [s] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str s) "UTF-8"))))
(defn engine [ports] (prolly/prolly-engine {:put! (:put! ports) :get-fn (:get-fn ports)
 :blind-fn #(str "fixture-blind:" %) :encrypt-fn identity :decrypt-fn identity :digest-fn sha}))
(defn block [i]
 (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. (+ 532 i)) b)
       h (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw h)) :bytes b}))
(defn verify! [get-block root file-cid]
 (let [e (engine {:put! (fn [& _] (throw (ex-info "read-only" {}))) :get-fn get-block})
       state (eng/restore-state e root) snapshot (eng/open-snapshot e state)
       db (reify source/IPatternSource (-scan [_ pattern] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) (eng/scan e snapshot pattern))))
       rows (datalog/q db '{:find [?cid] :where [["file/demo" :file/logical-cid ?cid]]} (constantly true))]
  (require! (= #{[file-cid]} rows) "Datalog did not read expected file CID")
  (doseq [i (range 18)]
   (let [{:keys [cid bytes]} (block i) got (get-block cid)]
    (require! (and got (Arrays/equals ^bytes bytes ^bytes got)) "block mismatch")))
  true))
(let [[mode root tool] *command-line-args* directory (str root "/store") staging (str root "/stage")
      file-cid (:cid (block 0))]
 (case mode
  "write" (do
    (require! (.mkdir (java.io.File. root)) "fresh root required")
    (require! (.mkdir (java.io.File. staging)) "fresh stage required")
    (store/init! directory)
    (let [published (fb/publish-atomic-stream-ports! directory staging tool "prolly" nil
                      (fn [ports]
                       (doseq [i (range 18)] (let [{:keys [cid bytes]} (block i)] ((:put! ports) cid bytes)))
                       (let [e (engine ports) state (eng/empty-state e "oracle/prolly")
                             result (eng/transact e state {:database-id "oracle/prolly" :request-id "tx-1"
                                      :tx-data [[:db/add "file/demo" :file/logical-cid file-cid]]})
                             physical (get-in result [:receipt :physical-root])]
                         {:target physical :value physical}))
                      (fn [get-block target] (verify! get-block target file-cid)))]
     (require! (= published (:cid (storage/-read-ref (refs/open-ref-store directory) "prolly"))) "ref mismatch")
     (let [snapshot (store/read-store directory)
           groups (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/") (keys (:state snapshot)))
           group (edn/read-string (get-in snapshot [:state (first groups)]))
           log (edn/read-string (slurp (str directory "/" (get-in snapshot [:root :log]) ".edn")))]
      (require! (= 1 (count groups)) "expected one group")
      (require! (<= 2 (count (:archives group))) "expected multiple Forest Packs")
      (require! (= [:put-many] (mapv :op (get-in log [:value :frames]))) "group and ref did not share one WAL frame"))
     (prn {:mode :write :root published :blocks 18 :datalog :verified :pass true})))
  "read" (let [db (fb/open-backend directory staging tool)
               root-cid (:cid (storage/-read-ref db "prolly"))]
            (require! root-cid "missing root")
            (verify! #(storage/get-block db %) root-cid file-cid)
            (prn {:mode :read :root root-cid :blocks 18 :datalog :verified :pass true}))
  (throw (ex-info "expected write/read" {}))))
(shutdown-agents)
