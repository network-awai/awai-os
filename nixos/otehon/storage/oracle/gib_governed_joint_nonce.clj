;; Hosted governed query with fixture authority; nonce/receipt publication shares one local root.
(require '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def path (or (System/getenv "GIB_GOVERNED_PROBE") (throw (ex-info "governed probe required" {}))))
(def raw (java.nio.file.Files/readAllBytes (java.nio.file.Paths/get path (make-array String 0))))
(when-not (= "b396c68621caf109c500bdb307e216b082b70e170475f1b20f048975ae220896"
             (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") raw)))
 (throw (ex-info "governed probe digest mismatch" {})))
(defn replace-one [s old new]
 (when-not (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote old)) s)))
  (throw (ex-info "replacement marker mismatch" {:marker old})))
 (str/replace s old new))
(def helper
 "(require '[otehon.ipld-forest :as catalog] '[otehon.forest :as forest] '[kotobase.nonce-store :as nonce])
(defn nonce-scope [] (codec/value-cid {:format :kotobase.nonce/request-scope-v1 :tenant \"test\" :principal \"fixture-principal\" :graph \"fixture-graph\" :epoch 7}))
(defn atomic-publish-ports! [_ ref-name expected receipt prepared build verify]
 (let [prefix \"awai.ipld-forest-group/\" s (store/read-store (str out \"/store\")) dir (str out \"/store\")
       cids (vec (distinct (for [k (keys (:state s)) :when (str/starts-with? k prefix) a (:archives (catalog/recover-group dir (subs k (count prefix)))) c (if (get-in a [:forest :file-backed?]) (get-in a [:forest :cids]) (map :cid (:blocks (car/carv1-decode (:carv1 (forest/open (store/read-forest dir (get-in a [:ref :archive-sha]))))))))] (car/cid-str c))))
       marker (nonce/prepare-marker (nonce-scope) ref-name) result (atom nil)]
  (assert (not (:degraded? s))) (assert (seq cids))
  (let [adapter (fb/atomic-stream-receipt-publication-adapter (str receipt-out \"/store\") (str receipt-out \"/stage\") tool ref-name expected
     (fn [ports _ _]
      (doseq [cid cids] ((:put! ports) cid (or (data-get cid) (throw (ex-info \"missing basis block\" {})))))
      (let [x (build ports)] (reset! result (:value x)) (:target x)))
     (fn [get-block target _ _]
      (and (= (:marker marker) (codec/verify-value-cid-structurally-bounded (:marker-cid marker) (get-block (:marker-cid marker)) {:max-bytes 4096 :max-depth 8 :max-items 32}))
           (verify! get-block basis-cid) (verify get-block target))) marker)]
   ((:publish! adapter) {:receipt receipt :prepared prepared}) @result)))
")
(def source (String. raw "UTF-8"))
(def modified (-> source
 (replace-one ":consume-nonce! (constantly true)" ":consume-nonce! (fn [n] (nonce/available? db (nonce-scope) n))")
 (replace-one "(fb/publish-ports! db ref-name nil" "(atomic-publish-ports! db ref-name nil receipt prepared")
 (replace-one "(assert (= 1 @evals))"
  "(assert (= 1 @evals)) (let [before (store/read-store (str receipt-out \"/store\")) replay (execute (decision resource) \"allow\")] (assert (= :nonce-replayed (get-in replay [:error :kotobase.authority-window/reason]))) (assert (= 1 @evals)) (assert (= before (store/read-store (str receipt-out \"/store\")))) (prn {:governed-replay :refused :roots-unchanged true}))")
 (replace-one "(assert (verify! data-get basis-cid))"
  "(let [before (store/read-store (str receipt-out \"/store\")) consume (nonce/consumer {:backend db :scope (nonce-scope) :single-writer? true})] (assert (false? (consume \"allow\"))) (assert (false? (consume \"deny\"))) (assert (= before (store/read-store (str receipt-out \"/store\")))) (prn {:persistent-nonce-replay :refused :root-unchanged true})) (assert (verify! data-get basis-cid))")
 (replace-one "(case (first *command-line-args*)" (str helper "(case (first *command-line-args*)"))))
(def old-basis "(def basis-cid (:cid (storage/-read-ref (refs/open-ref-store (str out \"/store\")) \"gib-prolly\")))")
(def read-basis "(def basis-cid (:basis (edn/read-string (slurp (str receipt-out \"/ids.edn\")))))")
(load-string (if (= "read" (first *command-line-args*))
               (replace-one (replace-one modified old-basis read-basis) ":after-reboot :verified" ":fresh-process :verified")
               modified))
