;; Hosted integration of actual Kotoba nonce marker and receipt publication adapter.
(require '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as fb]
 '[otehon.kotobase-ref :as refs] '[kotobase.storage.core :as s]
 '[kotobase.nonce-store :as nonce] '[kotoba.value.codec :as codec] '[clojure.edn :as edn] '[clojure.string :as str])
(defn check! [v message] (when-not v (throw (ex-info message {}))))
(defn error [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(let [[mode base tool] *command-line-args* dir (str base "/store") stage (str base "/stage")
      scope "fixture-scope" n "nonce-1" marker (nonce/prepare-marker scope n)
      value {:fixture :receipt} target (codec/value-cid value) bytes (byte-array (map unchecked-byte (codec/encode-bounded value 4096)))
      build (fn [p _ _] ((:put! p) target bytes) target)
      verify (fn [get-block cid _ _] (= value (codec/verify-value-cid-structurally-bounded cid (get-block cid) {:max-bytes 4096 :max-depth 8 :max-items 32})))
      input {:receipt {} :prepared {}}]
 (case mode
  "write" (do (check! (.mkdir (java.io.File. base)) "fresh root required") (check! (.mkdir (java.io.File. stage)) "fresh stage required") (store/init! dir)
    (let [backend (fb/open-backend dir stage tool) before (store/read-store dir)]
     (check! (true? (nonce/available? backend scope n)) "fresh preflight refused")
     (check! (= before (store/read-store dir)) "preflight changed root")
     (let [bad (fb/atomic-stream-receipt-publication-adapter dir stage tool "receipt" nil build (fn [& _] false) marker)]
      (check! (= :closure-rejected (error #((:publish! bad) input))) "bad verifier accepted")
      (check! (= before (store/read-store dir)) "bad verifier changed root"))
     (let [adapter (fb/atomic-stream-receipt-publication-adapter dir stage tool "receipt" nil build verify marker)]
      (check! (= target ((:publish! adapter) input)) "publication failed")
      (let [after (store/read-store dir) log (edn/read-string (slurp (str dir "/" (get-in after [:root :log]) ".edn")))
            frame (first (get-in log [:value :frames])) keys* (set (map first (get-in frame [:payload :puts])))
            group (first (filter #(str/starts-with? % "awai.ipld-forest-group/") keys*))]
       (check! (= #{group "awai.kotobase-ref/receipt" (str "awai.kotobase-ref/" (:ref-name marker))} keys*) "not one frame")
       (check! (false? (nonce/available? backend scope n)) "consumed preflight allowed")
       (let [replay (fb/atomic-stream-receipt-publication-adapter dir stage tool "receipt2" nil build verify marker)]
        (check! (= :nonce-replayed (error #((:publish! replay) input))) "atomic replay accepted")
        (check! (= after (store/read-store dir)) "atomic replay changed root")))))
    (prn {:mode :write :canonical-nonce :same-receipt-frame :replay :refused :pass true}))
  "read" (let [backend (fb/open-backend dir stage tool) before (store/read-store dir)
               consume (nonce/consumer {:backend backend :scope scope :single-writer? true})]
            (check! (= target (:cid (s/-read-ref (refs/open-ref-store dir) "receipt"))) "missing receipt")
            (check! (false? (consume n)) "replay accepted") (check! (= before (store/read-store dir)) "replay changed root")
            (prn {:mode :read :replay :refused :root :unchanged :pass true}))
  (throw (ex-info "mode" {}))))
(shutdown-agents)
