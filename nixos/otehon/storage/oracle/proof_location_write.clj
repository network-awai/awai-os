(load-file "nixos/otehon/storage/oracle/proof_location_common.clj")
(def csrc (slurp "nixos/otehon/storage/oracle/causal_forest_receipt.clj"))
(assert (clojure.string/includes? csrc "@stage-blocks)]"))
(def csrc (clojure.string/replace csrc "@stage-blocks)]"
  "@stage-blocks) blocks (into blocks [(block request) (block manifest) (block location)])]"))
(load-string (subs csrc (inc (clojure.string/index-of csrc "\n"))))
