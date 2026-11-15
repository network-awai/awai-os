(require '[otehon.storage :as store] '[otehon.ipld-forest :as catalog] '[otehon.kotobase-forest-blocks :as blocks])
(import '[java.nio.file Files Paths CopyOption])
(let [root (or (first *command-line-args*) (throw (ex-info "isolated copy required" {})))
      dir (str root "/store") before (store/read-store dir)
      bound (catalog/recover-bound-ref dir "allow")
      sha (get-in bound [:handle :group :archives 0 :archive-sha])
      src (Paths/get (str (store/forest-file-path dir sha)) (make-array String 0))
      saved (Paths/get (str root "/saved-pack.forest") (make-array String 0))
      adapter (blocks/atomic-stream-governed-receipt-adapter dir (str root "/stage") "/nonexistent/forest-tool" "allow" nil (fn [& _] nil) (fn [& _] false) true)]
 (Files/move src saved (make-array CopyOption 0))
 (let [reason (try ((:read-ref! adapter)) :unexpected (catch Exception e (:type (ex-data e))))]
  (assert (= :missing-forest reason)) (assert (= before (store/read-store dir)))
  (prn {:bound-receipt-read :missing-forest :root-unchanged true :isolated-copy true})))
(shutdown-agents)
