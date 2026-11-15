;; Hosted 1 MiB blocks with a prepared, in-memory witness fixture.
(require '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[kotobase.storage.core :as contract])
(import '[java.security MessageDigest] '[java.util Arrays Random])
(defn ensure! [x message] (when-not x (throw (ex-info message {}))))
(defn refused? [f] (try (f) false (catch Exception _ true)))
(defn block [seed]
 (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. seed) b)
       hash (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw hash)) :bytes b}))
(let [[root tool] *command-line-args* dir (str root "/store") staging (str root "/stage")]
 (ensure! (.mkdir (java.io.File. root)) "fresh root required")
 (ensure! (.mkdir (java.io.File. staging)) "fresh staging required")
 (store/init! dir)
 (let [initial (:root (store/read-store dir)) state (atom {:root initial :pending nil})
       witness {:status! #(deref state) :read! #(:root @state)
                :prepare! (fn [old next] (locking state (if (= @state {:root old :pending nil})
                                                          (do (reset! state {:root old :pending next}) true) false)))
                :compare-and-set! (fn [old next] (locking state (if (= @state {:root old :pending next})
                                                                  (do (reset! state {:root next :pending nil}) true) false)))}
       a (block 789) b (block 790) batch [a b]
       deny (blocks/open-witnessed-block-store dir staging tool witness (fn [_ _] false))]
   (ensure! (refused? #(contract/-put-blocks! deny batch)) "root verifier refusal ignored")
   (ensure! (= initial (:root (store/read-store dir)) (:root @state)) "refusal changed root")
   (let [backend (blocks/open-witnessed-block-store dir staging tool witness)
         expected (mapv :cid batch)]
     (ensure! (= expected (contract/-put-blocks! backend batch)) "write acknowledgement mismatch")
     (let [current (:root (store/read-store dir)) got (contract/-get-blocks backend expected)]
       (ensure! (= current (:root @state)) "witness differs")
       (ensure! (nil? (:pending @state)) "witness pending")
       (doseq [{:keys [cid bytes]} batch] (ensure! (Arrays/equals ^bytes bytes ^bytes (get got cid)) "readback mismatch"))
       (reset! state {:root initial :pending nil})
       (ensure! (refused? #(contract/-get-blocks backend expected)) "mismatched witness accepted")
       (reset! state {:root current :pending initial})
       (ensure! (refused? #(contract/-get-blocks backend expected)) "pending witness accepted")
       (reset! state {:root current :pending nil})
       (prn {:blocks 2 :size-each (* 1024 1024) :witness :fixture :mismatch :refused :pending :refused :root-verifier :refused :pass true})))))
(shutdown-agents)
