;; A new JVM verifies both durable frontier and newly published receipt.
(require '[clojure.string :as str])
(binding [*command-line-args* ["read"]]
  (load-string (str/replace (slurp "nixos/otehon/storage/oracle/signed_frontier_forest.clj") "(shutdown-agents)" "")))
(let [source (slurp "nixos/otehon/storage/oracle/proof_location_read.clj")
      common "(load-file \"nixos/otehon/storage/oracle/proof_location_common.clj\")"]
  (assert (str/includes? source common))
  (load-string (str/replace source common
                 (str common "\n(def request (assoc request :nonce \"fixture-persisted-frontier-20261114\"))"))))
