;; Compose the pinned authenticated linked-GiB fixture with atomic receipt ports.
(require '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util HexFormat])
(let [project (or (System/getenv "KOTOBASE_ORACLE_ROOT") (throw (ex-info "oracle root required" {})))
      bytes (java.nio.file.Files/readAllBytes (java.nio.file.Paths/get (str project "/oracle/awai-174/linked_governed_gib_authenticated.clj") (make-array String 0)))
      digest (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") bytes))
      source (String. bytes "UTF-8")
      marker "(def result (read/read-registry-linked-persistent!"
      replacement (str "(def publication (fb/atomic-receipt-publication-adapter dir stage tool \"linked-gib\" nil (:build! callbacks) (:verify! callbacks)))\n"
                       "(def req (assoc-in req [:commit :publication] publication))\n" marker)]
  (when-not (= digest "11a8b58eaa7f99b3a3212657561b48453d68f332f11c25ebd33dd096e1c1110b")
    (throw (ex-info "authenticated fixture digest differs" {})))
  (when-not (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote marker)) source)))
    (throw (ex-info "authenticated fixture marker differs" {})))
  (load-string (str/replace source marker replacement)))
