;; Read pinned authenticated fixture but fetch GiB bytes from the committed group.
(require '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util HexFormat] '[java.nio.file Files Paths])
(defn replace-once [s old new]
 (when-not (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote old)) s)))
  (throw (ex-info "reader replacement marker differs" {:marker old})))
 (str/replace s old new))
(let [project (or (System/getenv "KOTOBASE_ORACLE_ROOT") (throw (ex-info "project required" {})))
      raw (Files/readAllBytes (Paths/get (str project "/oracle/awai-174/linked_governed_gib_authenticated_read.clj") (make-array String 0)))
      digest (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") raw))
      source (String. raw "UTF-8")
      _ (when-not (= digest "93c5d321918dd90bee9221b6648cbde56644306c4f248172957186233af6e90d")
          (throw (ex-info "reader fixture digest differs" {})))
      postlude "(let [s (store/read-store dir) log (:value (edn/read-string (slurp (str dir \"/\" (get-in s [:root :log]) \".edn\")))) frame (last (:frames log)) puts (into {} (get-in frame [:payload :puts])) ks (filter #(str/starts-with? % \"awai.ipld-forest-group/kotobase-blocks/\") (keys puts)) k (first ks)] (assert (= :put-many (:op frame))) (assert (= 2 (count puts))) (assert (= 1 (count ks))) (assert (= (:commit ids) (get puts \"awai.kotobase-ref/linked-gib\"))) (assert (= (get puts k) (get-in s [:state k]))) (let [h (catalog/recover-group dir (subs k (count \"awai.ipld-forest-group/\")))] (assert (catalog/get-group-block h file-cid)) (assert (catalog/get-group-block h (:commit ids))) (prn {:same-group true :archives (count (get-in h [:group :archives])) :group-and-ref-one-frame true :pass true})))\n(shutdown-agents)"
      modified (-> source
                   (replace-once "((:get-block file-view) file-cid)" "(storage/get-block backend file-cid)")
                   (replace-once "((:get-block file-view) (car/cid-str (get-in c [\"cid\" :bytes])))" "(storage/get-block backend (car/cid-str (get-in c [\"cid\" :bytes])))")
                   (replace-once "(shutdown-agents)" postlude))]
 (load-string modified))
