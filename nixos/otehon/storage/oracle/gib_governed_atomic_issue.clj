;; Run pinned governed fixture with a local atomic streamed receipt sink.
;; The preexisting data, authority and nonce are outside this publication.
(require '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def path (or (System/getenv "GIB_GOVERNED_PROBE") (throw (ex-info "governed probe required" {}))))
(def bytes (java.nio.file.Files/readAllBytes (java.nio.file.Paths/get path (make-array String 0))))
(assert (= "b396c68621caf109c500bdb307e216b082b70e170475f1b20f048975ae220896" (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") bytes))))
(defn replace-once [s old new]
 (assert (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote old)) s)))) (str/replace s old new))
(def helper
 "(require '[otehon.ipld-forest :as catalog] '[otehon.atomic-forest-stream :as atomic] '[otehon.forest :as forest])\n(defn atomic-publish-ports! [_ ref-name expected build verify]\n (let [prefix \"awai.ipld-forest-group/\" s (store/read-store (str out \"/store\")) dir (str out \"/store\")\n       cids (vec (distinct (for [k (keys (:state s)) :when (str/starts-with? k prefix) a (:archives (catalog/recover-group dir (subs k (count prefix)))) c (if (get-in a [:forest :file-backed?]) (get-in a [:forest :cids]) (map :cid (:blocks (car/carv1-decode (:carv1 (forest/open (store/read-forest dir (get-in a [:ref :archive-sha]))))))))] (car/cid-str c))))\n       stage (str receipt-out \"/stage/atomic-\" (java.util.UUID/randomUUID))]\n  (assert (not (:degraded? s))) (assert (seq cids))\n  (fb/publish-atomic-stream-ports! (str receipt-out \"/store\") (str receipt-out \"/stage\") tool ref-name expected\n   (fn [ports] (doseq [cid cids] ((:put! ports) cid (or (data-get cid) (throw (ex-info \"missing basis block\" {}))))) (build ports))\n   (fn [get-block target] (and (verify! get-block basis-cid) (verify get-block target))))))\n")
(def old-basis "(def basis-cid (:cid (storage/-read-ref (refs/open-ref-store (str out \"/store\")) \"gib-prolly\")))")
(def read-basis "(def basis-cid (:basis (edn/read-string (slurp (str receipt-out \"/ids.edn\")))))")
(def source (String. bytes "UTF-8"))
(def modified (-> source
 (replace-once "(fb/publish-ports! db ref-name nil" "(atomic-publish-ports! db ref-name nil")
 (replace-once "(case (first *command-line-args*)" (str helper "(case (first *command-line-args*)"))))
(load-string (if (= "read" (first *command-line-args*))
               (replace-once (replace-once modified old-basis read-basis)
                             ":after-reboot :verified" ":fresh-process :verified")
               modified))
