;; Actual Kotobase port, two 1 MiB incompressible blocks, separate processes.
(require '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[otehon.forest-writer :as writer] '[kotobase.storage.core :as contract] '[clojure.edn :as edn])
(import '[java.security MessageDigest] '[java.util Arrays Random])
(defn ensure! [x message] (when-not x (throw (ex-info message {}))))
(defn refused? [f] (try (f) false (catch Exception _ true)))
(defn block [seed]
 (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. seed) b)
       hash (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw hash)) :bytes b}))
(let [[mode root tool] *command-line-args* dir (str root "/store") staging (str root "/stage")
      a (block 789) b (block 790) batch [a b]]
 (case mode
  "write"
  (do (ensure! (.mkdir (java.io.File. root)) "fresh root required")
      (ensure! (.mkdir (java.io.File. staging)) "fresh staging required")
      (store/init! dir)
      (let [initial (:root (store/read-store dir))
            guard-stage (str root "/guard-stage")]
        (ensure! (refused? #(writer/put-ipld-blocks! dir "unsafe" (:cid a) batch guard-stage tool)) "unconditional large write accepted")
        (ensure! (not (.exists (java.io.File. guard-stage))) "refused write created staging")
        (ensure! (= initial (:root (store/read-store dir))) "refused write changed root"))
      (let [backend (blocks/open-block-store dir staging tool)
            expected (mapv :cid batch) got (contract/-put-blocks! backend batch)
            state (:state (store/read-store dir)) groups (filter #(clojure.string/starts-with? (key %) "awai.ipld-forest-group/") state)
            group (edn/read-string (val (first groups)))]
        (ensure! (= expected got) "CID acknowledgement mismatch")
        (ensure! (= 1 (count groups)) "batch was not one catalog group")
        (ensure! (= 2 (count (:archives group))) "expected two archives")
        (ensure! (every? #(= :awai.otehon-store/ipld-forest-file-v2 (:format %)) (:archives group)) "not file-backed")
        (spit (str root "/ids.edn") (pr-str expected))))
  "read"
  (let [backend (blocks/open-block-store dir staging tool)
        ids (edn/read-string (slurp (str root "/ids.edn"))) got (contract/-get-blocks backend ids)]
    (doseq [{:keys [cid bytes]} batch] (ensure! (Arrays/equals ^bytes bytes ^bytes (get got cid)) "readback mismatch")))
  (throw (ex-info "expected write or read" {})))
 (prn {:mode mode :blocks 2 :size-each (* 1024 1024) :pass true}))
(shutdown-agents)
