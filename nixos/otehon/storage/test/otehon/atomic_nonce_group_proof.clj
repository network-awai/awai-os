;; Local atomic group/ref/nonce boundary; the host must validate marker semantics.
(require '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[kotobase.storage.core :as contract] '[clojure.edn :as edn] '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util Random Arrays])
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn error [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn block [i]
 (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. (+ 532 i)) b)
       digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
  {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes b}))
(let [[mode root tool] *command-line-args* dir (str root "/store") stage (str root "/stage")
      batch (mapv block (range 18)) marker (block 19) key-block (block 20)
      target (:cid (last batch)) nonce-ref (str "nonce/v1/" (:cid key-block))
      nonce {:ref-name nonce-ref :marker-cid (:cid marker)}]
 (case mode
  "write"
  (do (check! (.mkdir (java.io.File. root)) "fresh root required")
      (check! (.mkdir (java.io.File. stage)) "fresh stage required")
      (store/init! dir)
      (let [before (store/read-store dir)
            incomplete (fn [ports] ((:put! ports) target (:bytes (last batch))) {:target target :value :done})
            build (fn [ports] (doseq [{:keys [cid bytes]} (conj batch marker)] ((:put! ports) cid bytes))
                    {:target target :value :done})
            verify (fn [get-block cid]
                     (and (= cid target) (Arrays/equals ^bytes (:bytes marker) ^bytes (get-block (:cid marker)))
                          (every? (fn [{:keys [cid bytes]}] (Arrays/equals ^bytes bytes ^bytes (get-block cid))) batch)))]
       (check! (= :invalid-ipld-basis (error #(blocks/publish-atomic-stream-ports! dir stage tool "receipt" nil incomplete verify nonce))) "missing marker accepted")
       (check! (= before (store/read-store dir)) "missing marker changed root")
       (check! (= :closure-rejected (error #(blocks/publish-atomic-stream-ports! dir stage tool "receipt" nil build (fn [& _] false) nonce))) "bad marker verifier accepted")
       (check! (= before (store/read-store dir)) "refused closure changed root")
       (check! (= :done (blocks/publish-atomic-stream-ports! dir stage tool "receipt" nil build verify nonce)) "atomic publication failed")
       (let [after (store/read-store dir) log (edn/read-string (slurp (str dir "/" (get-in after [:root :log]) ".edn")))
             frames (get-in log [:value :frames]) keys* (set (map first (get-in (first frames) [:payload :puts])))
             group-key (first (filter #(str/starts-with? % "awai.ipld-forest-group/") keys*))
             group (edn/read-string (get-in after [:state group-key]))]
        (check! (= 1 (count frames)) "expected one frame")
        (check! (= :put-many (:op (first frames))) "expected put-many")
        (check! (= #{group-key "awai.kotobase-ref/receipt" (str "awai.kotobase-ref/" nonce-ref)} keys*) "group, receipt and nonce not in one frame")
        (check! (<= 2 (count (:archives group))) "expected multiple Packs")
        (check! (= :nonce-replayed (error #(blocks/publish-atomic-stream-ports! dir stage tool "receipt2" nil build verify nonce))) "replay accepted")
        (check! (= after (store/read-store dir)) "replay changed root"))))
  "read"
  (let [db (blocks/open-backend dir stage tool)]
   (check! (= target (:cid (contract/-read-ref db "receipt"))) "receipt ref missing")
   (check! (= (:cid marker) (:cid (contract/-read-ref db nonce-ref))) "nonce ref missing")
   (doseq [{:keys [cid bytes]} (conj batch marker)]
    (check! (Arrays/equals ^bytes bytes ^bytes (contract/get-block db cid)) "readback mismatch")))
  (throw (ex-info "expected write/read" {})))
 (prn {:mode mode :blocks 19 :group-ref-nonce :same-frame :pass true}))
(shutdown-agents)
