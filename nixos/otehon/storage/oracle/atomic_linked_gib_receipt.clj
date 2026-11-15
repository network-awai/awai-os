;; Compose the pinned Kotobase linked-GiB fixture with atomic receipt ports.
(require '[clojure.string :as str])
(let [project (or (System/getenv "KOTOBASE_ORACLE_ROOT") (throw (ex-info "oracle root required" {})))
      source (slurp (str project "/oracle/awai-174/linked_governed_gib_file.clj"))
      original "(fb/streamed-receipt-publication-adapter backend \"linked-gib\" nil {:max-bytes (* 8 1024 1024) :max-blocks 500} (:build! callbacks) (:verify! callbacks))"
      replacement "(fb/atomic-receipt-publication-adapter dir stage tool \"linked-gib\" nil (:build! callbacks) (:verify! callbacks))"]
  (when-not (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote original)) source)))
    (throw (ex-info "expected exact pinned adapter expression" {})))
  (load-string (str/replace source original replacement)))
