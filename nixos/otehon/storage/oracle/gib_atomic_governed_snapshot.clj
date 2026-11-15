;; Snapshot preexisting governed receipts and GiB data into one atomic local group.
;; Issuance, nonce, authority, and the original stores are not one transaction.
(require '[clojure.string :as str] '[clojure.edn :as edn]
         '[otehon.ipld-forest :as catalog] '[otehon.storage :as store]
         '[otehon.forest :as forest] '[awai.fs.car :as car]
         '[kotobase.storage.core :as storage] '[kotoba.value.codec :as codec])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def mode (first *command-line-args*))
(def source (or (System/getenv "GIB_GOVERNED_PROBE") (throw (ex-info "governed probe required" {}))))
(def raw (java.nio.file.Files/readAllBytes (java.nio.file.Paths/get source (make-array String 0))))
(assert (= "b396c68621caf109c500bdb307e216b082b70e170475f1b20f048975ae220896" (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") raw))))
(def prefix (first (str/split (String. raw "UTF-8") #"\(case \(first \*command-line-args\*\)" 2)))
(def old "(def basis-cid (:cid (storage/-read-ref (refs/open-ref-store (str out \"/store\")) \"gib-prolly\")))")
(def replacement "(def basis-cid (let [cid (:cid (storage/-read-ref (refs/open-ref-store (str out \"/store\")) \"snapshot\")) b (data-get cid)] (:basis (codec/decode-value b))))")
(when (= mode "read") (assert (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote old)) prefix)))))
(load-string (if (= mode "read") (str/replace prefix old replacement) prefix))
(def dest (or (System/getenv "GIB_SNAPSHOT_OUTPUT") (throw (ex-info "snapshot output required" {}))))
(defn source-cids [dir]
 (let [s (store/read-store dir) prefix "awai.ipld-forest-group/"]
  (assert (not (:degraded? s)))
  (vec (distinct (for [k (keys (:state s)) :when (str/starts-with? k prefix)
                       a (:archives (catalog/recover-group dir (subs k (count prefix))))
                       cid (if (get-in a [:forest :file-backed?])
                             (get-in a [:forest :cids])
                             (map :cid (:blocks (car/carv1-decode (:carv1 (forest/open (store/read-forest dir (get-in a [:ref :archive-sha]))))))))]
                   (car/cid-str cid))))))
(defn readonly-db [get-block]
 (open-db (reify storage/IBlockStore
  (-put-blocks! [_ _] (throw (ex-info "read-only" {})))
  (-get-blocks [_ cids] (into {} (keep (fn [c] (when-let [b (get-block c)] [c b]))) cids))
  storage/IRefStore (-read-ref [_ _] nil) (-compare-and-set-ref! [_ _ _ _] (throw (ex-info "read-only" {})))
  storage/IBackendCapabilities (-capabilities [_] (storage/-capabilities data-db)))))
(defn check-snapshot! [get-block target]
 (let [envelope (value-at get-block target)
       _ (assert (= #{:format :basis :allow :allow-commit :deny :deny-commit} (set (keys envelope))))
       _ (assert (= :awai.fixture/governed-gib-snapshot-v1 (:format envelope)))
       _ (assert (= basis-cid (:basis envelope)))
       proof (edn/read-string (String. ^bytes (get-block (:basis envelope)) "UTF-8"))
       e2 (engine {:put! (fn [& _] (throw (ex-info "read-only" {}))) :get-fn get-block})
       root2 (:physical-root proof) snap2 (eng/open-snapshot e2 (eng/restore-state e2 root2))
       p2 (policy-at e2 snap2) pcid2 (policy/policy-cid p2)
       loc2 {:format :awai.fixture/gib-location-v1 :signed-basis (:basis envelope) :physical-root root2 :policy pcid2}
       db (readonly-db get-block)]
  (assert (= entry proof)) (assert (verify-entry! e2 proof pcid2))
  (with-redefs [e e2 entry proof root root2 pcid pcid2 location loc2]
    (doseq [[kind cid commit] [[:allow (:allow envelope) (:allow-commit envelope)] [:deny (:deny envelope) (:deny-commit envelope)]]]
      (let [receipt (first (:receipt/records (causal/receipt-at db commit cid)))]
        (assert (= kind (:authority/decision receipt))) (assert (bundle! get-block receipt))
        (assert (refused? #(bundle! (fn [c] (when-not (= c (:request/digest receipt)) (get-block c))) receipt)))
        (when (= kind :allow) (assert (= (id/value-cid [{:file/logical-cid file-cid}]) (:result/root receipt)))))))
  (assert (verify! get-block (:basis envelope)))
  (prn {:atomic-snapshot :verified :receipts 2 :file-bytes 1073741824 :pass true}) true))
(case mode
 "write" (let [receipt-db (rbackend) ids (edn/read-string (slurp (str receipt-out "/ids.edn")))
               ddir (str out "/store") rdir (str receipt-out "/store")
               dcids (source-cids ddir) rcids (source-cids rdir)
               ac (:cid (storage/-read-ref receipt-db "allow")) dc (:cid (storage/-read-ref receipt-db "deny"))
               envelope {:format :awai.fixture/governed-gib-snapshot-v1 :basis basis-cid
                         :allow (:allow ids) :allow-commit ac :deny (:deny ids) :deny-commit dc}]
           (assert (= basis-cid (:basis ids))) (assert ac) (assert dc)
           (assert (.mkdir (java.io.File. dest))) (store/init! (str dest "/store"))
           (assert (.mkdir (java.io.File. (str dest "/stage"))))
           (fb/publish-atomic-stream-ports! (str dest "/store") (str dest "/stage") tool "snapshot" nil
            (fn [ports]
              (doseq [cid dcids] ((:put! ports) cid (or (data-get cid) (throw (ex-info "missing source data" {})))))
              (doseq [cid rcids] ((:put! ports) cid (or (storage/get-block receipt-db cid) (throw (ex-info "missing source receipt" {})))))
              (let [b (block envelope)] ((:put! ports) (:cid b) (:bytes b)) {:target (:cid b) :value (:cid b)}))
            check-snapshot!))
 "read" (let [backend (fb/open-backend (str dest "/store") (str dest "/unused-stage") "/absent-writer")
              target (:cid (storage/-read-ref (refs/open-ref-store (str dest "/store")) "snapshot"))]
          (assert target) (assert (check-snapshot! #(storage/get-block backend %) target)))
 (throw (ex-info "write or read required" {})))
(shutdown-agents)
