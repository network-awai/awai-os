(require '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as fb]
 '[otehon.kotobase-ref :as refs] '[kotobase.storage.core :as s]
 '[kotobase.nonce-store :as nonce] '[kotoba.value.codec :as codec])
(defn check! [v message] (when-not v (throw (ex-info message {}))))
(let [[mode base tool] *command-line-args* dir (str base "/store") stage (str base "/stage")
      scope "fixture-scope" n "nonce-1" key-value {:format :kotobase.nonce/key-v1 :scope scope :nonce n}
      key-cid (codec/value-cid key-value) marker {:format :kotobase.nonce/consumed-v1 :key-cid key-cid}
      marker-cid (codec/value-cid marker) marker-bytes (byte-array (map unchecked-byte (codec/encode-bounded marker 4096)))
      value {:fixture :receipt} target (codec/value-cid value) target-bytes (byte-array (map unchecked-byte (codec/encode-bounded value 4096)))
      opt {:ref-name (str "nonce/v1/" key-cid) :marker-cid marker-cid}]
 (case mode
  "write" (do (check! (.mkdir (java.io.File. base)) "fresh root required")
               (check! (.mkdir (java.io.File. stage)) "fresh stage required") (store/init! dir)
               (check! (= :done (fb/publish-atomic-stream-ports! dir stage tool "receipt" nil
                 (fn [p] ((:put! p) marker-cid marker-bytes) ((:put! p) target target-bytes) {:target target :value :done})
                 (fn [get-block _] (= marker (codec/verify-value-cid-structurally-bounded marker-cid (get-block marker-cid) {:max-bytes 4096 :max-depth 8 :max-items 32}))) opt)) "publish failed")
               (prn {:mode :write :nonce-ref (:ref-name opt) :marker marker-cid :pass true}))
  "read" (let [backend (fb/open-backend dir stage tool) before (store/read-store dir)
               consume (nonce/consumer {:backend backend :scope scope :single-writer? true}) result (consume n)]
            (check! (false? result) "replay not refused")
            (check! (= before (store/read-store dir)) "replay changed root")
            (prn {:mode :read :replay :refused :root :unchanged :pass true}))
  (throw (ex-info "mode" {}))))
(shutdown-agents)
