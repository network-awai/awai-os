;; Pinned hosted fixture composition: GiB blocks and linked receipt in one group/ref.
(require '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util HexFormat]
        '[java.nio.file Files Paths OpenOption StandardOpenOption])
(defn pinned-text [path expected]
 (let [b (Files/readAllBytes (Paths/get path (make-array String 0)))
       sha (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") b))]
  (when-not (= expected sha) (throw (ex-info "fixture source digest differs" {:path path})))
  (String. b "UTF-8")))
(defn replace-once [s old new]
 (when-not (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote old)) s)))
  (throw (ex-info "fixture replacement marker differs" {:marker old})))
 (str/replace s old new))
(let [project (or (System/getenv "KOTOBASE_ORACLE_ROOT") (throw (ex-info "project required" {})))
      derived (or (System/getenv "GIB_DERIVED_WRITER") (throw (ex-info "derived writer required" {})))
      original (pinned-text (str project "/oracle/awai-174/linked_governed_gib_file.clj") "58fd80f0313034f8a2d2585076042c51d6f64253f9399684173d5653b0e3d848")
      auth (pinned-text (str project "/oracle/awai-174/linked_governed_gib_authenticated.clj") "11a8b58eaa7f99b3a3212657561b48453d68f332f11c25ebd33dd096e1c1110b")
      stage-old "{:stage-bundle! (fn [ports _ _] (doseq [v [request* file-manifest file-location]] (let [{:keys [cid bytes]} (block v)] ((:put! ports) cid bytes))))"
      stage-new "{:stage-bundle! (fn [ports _ _] (let [m ((:get-block file-view) file-cid) v (first (car/cbor-decode (mapv #(bit-and 255 %) m) 0))] (doseq [c (get v \"chunks\")] (let [cid (car/cid-str (get-in c [\"cid\" :bytes]))] ((:put! ports) cid ((:get-block file-view) cid)))) ((:put! ports) file-cid m)) (doseq [v [request* file-manifest file-location]] (let [{:keys [cid bytes]} (block v)] ((:put! ports) cid bytes))))"
      verifier-old "(defn verify-file! []"
      verifier-new "(defn verify-file! [candidate]"
      source-read "((:get-block file-view) file-cid)"
      chunk-read "((:get-block file-view) (car/cid-str (get-in c [\"cid\" :bytes])))"
      old-adapter "(fb/streamed-receipt-publication-adapter backend \"linked-gib\" nil {:max-bytes (* 8 1024 1024) :max-blocks 500} (:build! callbacks) (:verify! callbacks))"
      new-adapter "(fb/atomic-stream-receipt-publication-adapter dir stage tool \"linked-gib\" nil (:build! callbacks) (:verify! callbacks))"
      start (.indexOf original verifier-old) end (.indexOf original "(defn location-ok?" start)
      _ (when (or (neg? start) (neg? end)) (throw (ex-info "verifier boundary missing" {})))
      verifier (subs original start end)
      verifier* (-> verifier (replace-once verifier-old verifier-new)
                    (replace-once source-read "(candidate file-cid)")
                    (replace-once chunk-read "(candidate (car/cid-str (get-in c [\"cid\" :bytes])))"))
      writer (-> (str (subs original 0 start) verifier* (subs original end))
                 (replace-once stage-old stage-new)
                 (replace-once "(verify-file!)" "(verify-file! get-block)")
                 (replace-once old-adapter new-adapter))
      auth* (replace-once auth "(def script (System/getenv \"GIB_LINKED_WRITER\"))" "(def script (System/getenv \"GIB_DERIVED_WRITER\"))")]
 (Files/write (Paths/get derived (make-array String 0)) (.getBytes writer "UTF-8")
              (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))
 (load-string auth*))
