;; Hosted nonce-ledger composition; authority and receipt use separate stores.
(require '[clojure.string :as str])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def source-path (or (System/getenv "GIB_ATOMIC_ISSUE_PROBE") (throw (ex-info "issue probe required" {}))))
(def source-bytes (java.nio.file.Files/readAllBytes (java.nio.file.Paths/get source-path (make-array String 0))))
(when-not (= "e7af6f45d6d73c1f0410fca934825c13b3f473b366e9680642eb61c81f9f8913"
             (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") source-bytes)))
 (throw (ex-info "issue probe digest mismatch" {})))
(defn replace-one [s old new]
 (when-not (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote old)) s)))
  (throw (ex-info "replacement marker mismatch" {:marker old})))
 (str/replace s old new))
(def fixture-init "(store/init! (str receipt-out \"/store\"))")
(def nonce-init (str fixture-init " (assert (.mkdir (java.io.File. (str receipt-out \"/nonce-stage\")))) (store/init! (str receipt-out \"/nonce-store\"))"))
(def old-consumer ":consume-nonce! (constantly true)")
(def new-consumer ":consume-nonce! (nonce/consumer {:backend (nonce-backend) :scope (nonce-scope) :single-writer? true})")
(def case-marker "(case (first *command-line-args*)")
(def helpers (str "(require '[kotobase.nonce-store :as nonce])\n"
 "(defn nonce-backend [] (fb/open-backend (str receipt-out \"/nonce-store\") (str receipt-out \"/nonce-stage\") tool))\n"
 "(defn nonce-scope [] (codec/value-cid {:format :kotobase.nonce/request-scope-v1 :tenant \"test\" :principal \"fixture-principal\" :graph \"fixture-graph\" :epoch 7}))\n" case-marker))
(def read-marker "(assert (verify! data-get basis-cid))")
(def write-marker "(assert (= 1 @evals))")
(def write-replay (str write-marker " (let [before-receipts (store/read-store (str receipt-out \"/store\")) before-nonces (store/read-store (str receipt-out \"/nonce-store\")) replay (execute (decision resource) \"allow\")] "
 "(assert (= :nonce-replayed (get-in replay [:error :kotobase.authority-window/reason]))) (assert (= 1 @evals)) "
 "(assert (= before-receipts (store/read-store (str receipt-out \"/store\")))) "
 "(assert (= before-nonces (store/read-store (str receipt-out \"/nonce-store\")))) (prn {:governed-replay :refused :evaluations 1 :roots-unchanged true}))"))
(def read-replay (str "(let [before-receipts (store/read-store (str receipt-out \"/store\")) before-nonces (store/read-store (str receipt-out \"/nonce-store\")) consume (nonce/consumer {:backend (nonce-backend) :scope (nonce-scope) :single-writer? true})] "
 "(assert (false? (consume \"allow\"))) (assert (false? (consume \"deny\"))) "
 "(assert (= before-receipts (store/read-store (str receipt-out \"/store\")))) "
 "(assert (= before-nonces (store/read-store (str receipt-out \"/nonce-store\")))) (prn {:persistent-nonce-replay :refused :roots-unchanged true}))\n" read-marker))
(def substitutions [[fixture-init nonce-init] [old-consumer new-consumer] [case-marker helpers] [write-marker write-replay] [read-marker read-replay]])
(def modified-source-expression
 (str "(def source (-> (String. bytes \"UTF-8\") "
      (apply str (map (fn [[a b]] (str "(replace-once " (pr-str a) " " (pr-str b) ") ")) substitutions)) "))"))
(load-string (replace-one (String. source-bytes "UTF-8") "(def source (String. bytes \"UTF-8\"))" modified-source-expression))
