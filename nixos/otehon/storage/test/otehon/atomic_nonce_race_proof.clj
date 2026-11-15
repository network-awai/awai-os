;; Two same-nonce writers must not both publish; no distributed fencing claim.
(require '[awai.fs.car :as car] '[otehon.storage :as store]
         '[otehon.kotobase-forest-blocks :as blocks] '[kotobase.storage.core :as contract]
         '[clojure.edn :as edn] '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util Arrays] '[java.util.concurrent CountDownLatch TimeUnit])
(defn check! [v m] (when-not v (throw (ex-info m {}))))
(defn block [text] (let [b (.getBytes text "UTF-8") d (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
                    {:cid (car/cid-str (car/cid-bytes car/codec-raw d)) :bytes b}))
(let [[root tool] *command-line-args* dir (str root "/store") stage (str root "/stage")
      target (block "candidate") marker (block "marker") key (block "key")
      opt {:ref-name (str "nonce/v1/" (:cid key)) :marker-cid (:cid marker)}
      ready (CountDownLatch. 2) release (CountDownLatch. 1)
      verifier (fn [get-block cid] (and (= cid (:cid target)) (Arrays/equals ^bytes (:bytes marker) ^bytes (get-block (:cid marker)))))
      launch (fn [ref] (future
              (try
               (blocks/publish-atomic-stream-ports! dir stage tool ref nil
                (fn [ports] (.countDown ready) (when-not (.await release 30 TimeUnit/SECONDS) (throw (ex-info "barrier timed out" {})))
                 ((:put! ports) (:cid marker) (:bytes marker)) ((:put! ports) (:cid target) (:bytes target))
                 {:target (:cid target) :value :published}) verifier opt)
               (catch Exception e (:type (ex-data e))))))]
 (check! (.mkdir (java.io.File. root)) "fresh root required")
 (check! (.mkdir (java.io.File. stage)) "fresh stage required") (store/init! dir)
 (let [a (launch "race-a") b (launch "race-b")]
  (when-not (.await ready 30 TimeUnit/SECONDS) (.countDown release) (throw (ex-info "writers did not start" {})))
  (.countDown release)
  (let [results [@a @b] state (store/read-store dir) db (blocks/open-backend dir stage tool)
        refs (mapv #(:cid (contract/-read-ref db %)) ["race-a" "race-b"])
        log (edn/read-string (slurp (str dir "/" (get-in state [:root :log]) ".edn")))
        frames (get-in log [:value :frames]) keys* (set (map first (get-in (first frames) [:payload :puts])))]
   (check! (= 1 (count (filter #{:published} results))) "expected one winner")
   (check! (= 1 (count (filter #{:writer-busy :stale-generation :nonce-replayed} results))) "unexpected loser")
   (check! (= 1 (count (filter some? refs))) "unexpected refs")
   (check! (= (:cid marker) (:cid (contract/-read-ref db (:ref-name opt)))) "nonce ref missing")
   (check! (= 1 (count frames)) "expected exactly one frame")
   (check! (contains? keys* (str "awai.kotobase-ref/" (:ref-name opt))) "nonce absent from frame")
   (check! (= 3 (count keys*)) "unexpected frame scope")
   (prn {:winners 1 :loser :refused :group-ref-nonce :same-frame :pass true}))))
(shutdown-agents)
