(require '[otehon.storage :as store])
(let [[event role occurrence] *command-line-args*
      event (keyword event) role (keyword role) n (Long/parseLong occurrence)
      seen (atom 0)]
  (binding [store/*write-observer* (fn [e r]
                                      (when (and (= [event role] [e r]) (= n (swap! seen inc)))
                                        (println "BOUNDARY") (flush) (Thread/sleep 300000)))
            *command-line-args* ["publish"]]
    (load-file "nixos/otehon/storage/oracle/signed_basis_multipack.clj"))
  (throw (ex-info "expected boundary not reached" {:event event :role role})))
