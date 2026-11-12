(require '[cheshire.core :as j] '[clojure.java.shell :as sh] '[clojure.string :as s])
(def installer-code (slurp "nixos/otehon/bot-fleet/etcd/install-runtime.py"))
(doseq [node ["levi" "benjamin" "joseph"]]
 (let [sent (sh/sh "scp" "-q" "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=yes" ".agent-output/itonami-etcd-runtime.tar"
                   (str "node@" node ":/Users/node/github/workspaces/codex/awai-2795-etcd-control-plane/itonami-runtime.tar"))]
  (assert (zero? (:exit sent)))
  (let [r (sh/sh "ssh" "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=yes" "-o" "ForwardAgent=no" "-T" (str "node@" node)
                 (str "python3 -c '" (s/replace installer-code "'" "'\\''") "'")
                 :in (j/generate-string {:node node :revision "02828b67ae0219d37c265960ffc7a71e102e7e62"
                                        :sha256 "d5846e3acb7eb89f35fc0b8f4b194e3c24cf81fca71b1b5775d6e85245448002"}))
        value (try (j/parse-string (:out r) true) (catch Exception _ nil))]
   (spit (str ".agent-output/etcd-source-install-" node ".json") (:out r))
   (when-not (and (= node (:node value)) (:installed value))
    (spit (str ".agent-output/etcd-source-install-error-" node ".log") (:err r))
    (throw (ex-info "source install unconfirmed; preserve" {:node node})))
   (println node "exact source installed"))))
