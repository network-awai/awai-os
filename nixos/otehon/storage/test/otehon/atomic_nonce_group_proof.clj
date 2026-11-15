;; Local atomic group/ref/nonce boundary; the host must validate marker semantics.
(require '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.kotobase-forest-blocks :as blocks]
         '[otehon.ipld-forest :as catalog]
         '[otehon.kotobase-ref :as refs]
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
       (let [prepared-nonce (assoc nonce :marker {:domain "fixture"} :bytes (:bytes marker))
             receipt-build (fn [ports _ _] (:target (build ports)))
             receipt-verify (fn [get-block cid _ _ n] (and (= {:domain "fixture"} (:marker n)) (verify get-block cid)))
             adapter (blocks/atomic-stream-governed-receipt-adapter dir stage tool "receipt" nil receipt-build receipt-verify true)
             replay (blocks/atomic-stream-governed-receipt-adapter dir stage tool "receipt2" nil receipt-build receipt-verify true)
             input {:receipt {} :prepared {} :nonce prepared-nonce}]
       (check! (nil? ((:read-nonce-ref! adapter) nonce-ref)) "unused nonce requires a receipt")
       (check! (= :invalid-receipt-publication (error #((:publish! adapter) (dissoc input :nonce)))) "missing nonce accepted")
       (check! (= :closure-rejected (error #((:publish! adapter) (assoc-in input [:nonce :marker] {:domain "wrong"})))) "wrong marker semantics accepted")
       (check! (= before (store/read-store dir)) "invalid governed input changed root")
       (check! (= target ((:publish! adapter) input)) "atomic receipt publication failed")
       (check! (= target ((:read-ref! adapter))) "adapter receipt ref missing")
       (check! (= (:cid marker) (:cid ((:read-nonce-ref! adapter) nonce-ref))) "adapter nonce ref missing")
       (check! (= (:cid marker) (:target (catalog/recover-bound-ref dir nonce-ref))) "nonce binding missing")
       (let [view (blocks/open-bound-read-view dir "receipt")]
         (check! (= target ((:read-ref! view))) "view target mismatch")
         (check! (not (satisfies? contract/IRefStore (:blocks view))) "view advertises ref protocol")
         (check! (not (contains? (contract/-capabilities (:blocks view)) :batch-put)) "view advertises writes")
         (contract/validate-block-store! (:blocks view))
         (check! (= (:cid marker) (:cid ((:read-nonce-ref! view) nonce-ref))) "view nonce mismatch")
         (check! (nil? ((:read-nonce-ref! view) (str "nonce/v1/" (:cid (first batch))))) "absent nonce was present")
         (check! (= :invalid-nonce (error #((:read-nonce-ref! view) "other"))) "invalid nonce name accepted"))
       (let [bound (catalog/recover-bound-ref dir "receipt")]
         (with-redefs [catalog/recover-bound-ref (fn [_ _] (update-in bound [:handle :basis :generation] inc))]
           (check! (= :catalog-changed (error #((:read-nonce-ref! adapter) nonce-ref))) "mixed root nonce read accepted")))
       (check! (= :missing-group-binding (error #((:read-ref! replay)))) "unbound ref accepted")
       (let [before-strict (store/read-store dir)
             next-nonce {:ref-name (str "nonce/v1/" (:cid marker)) :marker-cid (:cid key-block)
                         :marker {:domain "fixture"} :bytes (:bytes key-block)}
             sparse-build (fn [ports _ _] ((:put! ports) target (:bytes (last batch))) target)
             needs-old (fn [get-block _ _ _ _] (some? (get-block (:cid (first batch)))))
             strict (blocks/atomic-stream-governed-receipt-adapter dir stage tool "receipt3" nil sparse-build needs-old true)]
         (check! (= :closure-rejected (error #((:publish! strict) {:receipt {} :prepared {} :nonce next-nonce}))) "existing-only closure accepted")
         (check! (= before-strict (store/read-store dir)) "incomplete bound closure changed root"))
       (let [after (store/read-store dir) log (edn/read-string (slurp (str dir "/" (get-in after [:root :log]) ".edn")))
             frames (get-in log [:value :frames]) keys* (set (map first (get-in (first frames) [:payload :puts])))
             group-key (first (filter #(str/starts-with? % "awai.ipld-forest-group/") keys*))
             group (edn/read-string (get-in after [:state group-key]))]
        (check! (= 1 (count frames)) "expected one frame")
        (check! (= :put-many (:op (first frames))) "expected put-many")
        (check! (= #{group-key "awai.kotobase-ref/receipt" "awai.kotobase-group-binding/receipt" (str "awai.kotobase-ref/" nonce-ref) (str "awai.kotobase-group-binding/" nonce-ref)} keys*) "group, receipt, nonce and bindings not in one frame")
        (check! (<= 2 (count (:archives group))) "expected multiple Packs")
        (check! (= :nonce-replayed (error #((:publish! replay) input))) "replay accepted")
        (check! (= after (store/read-store dir)) "replay changed root")
        (let [next-nonce {:ref-name (str "nonce/v1/" (:cid (first batch))) :marker-cid (:cid key-block)
                          :marker {:domain "fixture"} :bytes (:bytes key-block)}
              next-build (fn [ports _ _] (doseq [{:keys [cid bytes]} (conj batch key-block)] ((:put! ports) cid bytes)) target)
              next-verify (fn [get-block cid _ _ n] (and (= target cid) (some? (get-block (:marker-cid n)))))
              next-adapter (blocks/atomic-stream-governed-receipt-adapter dir stage tool "receipt-next" nil next-build next-verify true)]
          (check! (= target ((:publish! next-adapter) {:receipt {} :prepared {} :nonce next-nonce})) "second group publish failed")
          (check! (= :catalog-changed (error #((:read-nonce-ref! adapter) nonce-ref))) "adapter accepted nonce from a later root")
          (check! (not= (:group (catalog/recover-bound-ref dir "receipt-next")) (:group (catalog/recover-bound-ref dir nonce-ref))) "test groups not distinct")
          (check! (= (:cid marker) (:cid ((:read-nonce-ref! next-adapter) nonce-ref))) "prior group nonce not recovered"))
        (let [db (blocks/open-block-store dir stage tool)]
          (contract/-put-blocks! db [key-block])
          (let [foreign (str "nonce/v1/" (:cid marker))
                refs (refs/open-ref-store dir)]
            (check! (:published? (contract/-compare-and-set-ref! refs foreign nil (:cid key-block))) "foreign ref setup failed")
            (let [view (blocks/open-bound-read-view dir "receipt")]
              (check! (= :invalid-ipld-basis (error #((:read-nonce-ref! view) foreign))) "foreign marker accepted"))
            (let [view (blocks/open-bound-read-view dir "receipt" true)]
              (check! (= :missing-group-binding (error #((:read-nonce-ref! view) foreign))) "unbound foreign marker accepted")))
          (let [view (blocks/open-bound-read-view dir "receipt") bound (:blocks view)]
            (check! (nil? (contract/get-block bound (:cid key-block))) "bound lookup searched another group")
            (check! (Arrays/equals ^bytes (:bytes key-block) ^bytes (contract/get-block db (:cid key-block))) "global control missing")
            (check! (= :read-only (error #(contract/-put-blocks! bound [key-block]))) "bound port accepted write")
            (contract/-put-blocks! db [(block 21)])
            (check! (= :catalog-changed (error #(contract/get-block bound target))) "stale bound handle accepted")
            (check! (= :catalog-changed (error #((:read-ref! view)))) "stale view ref accepted")
            (check! (= :catalog-changed (error #((:read-nonce-ref! view) nonce-ref))) "stale view nonce accepted")
            (let [fresh (blocks/open-bound-block-store dir "receipt") original catalog/get-group-block once (atom true)]
              (with-redefs [catalog/get-group-block (fn [h cid]
                           (when (compare-and-set! once true false) (contract/-put-blocks! db [(block 22)]))
                           (original h cid))]
                (check! (= :catalog-changed (error #(contract/get-block fresh target))) "root change during batch accepted")))
            (let [fresh (blocks/open-bound-read-view dir "receipt") original catalog/get-group-block once (atom true)]
              (with-redefs [catalog/get-group-block (fn [h cid]
                           (when (compare-and-set! once true false) (contract/-put-blocks! db [(block 23)]))
                           (original h cid))]
                (check! (= :catalog-changed (error #((:read-nonce-ref! fresh) nonce-ref))) "root change during nonce read accepted")))))))))
  "read"
  (let [db (blocks/open-backend dir stage tool) bound (catalog/recover-bound-ref dir "receipt")]
   (check! (= target (:cid (contract/-read-ref db "receipt"))) "receipt ref missing")
   (check! (= (:cid marker) (:cid (contract/-read-ref db nonce-ref))) "nonce ref missing")
   (check! (not= (:group bound) (:group (catalog/recover-bound-ref dir "receipt-next"))) "reopened groups not distinct")
   (check! (= (:cid marker) (:cid (blocks/read-bound-nonce-ref! dir nonce-ref))) "reopened prior nonce missing")
   (doseq [{:keys [cid bytes]} (conj batch marker)]
    (check! (Arrays/equals ^bytes bytes ^bytes (catalog/get-group-block (:handle bound) cid)) "bound readback mismatch")
    (check! (Arrays/equals ^bytes bytes ^bytes (contract/get-block db cid)) "readback mismatch")))
  (throw (ex-info "expected write/read" {})))
 (prn {:mode mode :blocks 19 :group-ref-nonce :same-frame :pass true}))
(shutdown-agents)
