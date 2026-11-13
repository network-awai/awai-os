(require '[cheshire.core :as j] '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as s])
(def worker-script (slurp "nixos/otehon/bot-fleet/etcd/worker-client.py"))
(def root (str (System/getProperty "user.home") "/.itonami/control-plane/etcd/awai-bots-v1"))
(defn shell! [& a] (let [r (apply sh/sh a)] (assert (zero? (:exit r))) (:out r)))
(defn remote! [node payload flag]
 (let [r (sh/sh "ssh" "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=yes" "-o" "ForwardAgent=no" "-T" (str "node@" node)
                 (str "python3 -c '" (s/replace worker-script "'" "'\\''") "'") :in (j/generate-string payload))
       out (try (j/parse-string (:out r) true) (catch Exception _ nil))]
  (when-not (and (= node (:node out)) (true? (get out flag)))
   (spit (str ".agent-output/worker-cert-error-" node ".log") (str (:err r) (:out r)))
   (throw (ex-info "unconfirmed worker credential phase; preserve" {:node node}))) out))
(doseq [node ["levi" "benjamin" "joseph"]]
 (let [csr-path (str ".agent-output/" node "-worker.csr")
       out (remote! node {:node node :mode "request"} :clientPrepared)
       cert-path (str root "/" node "-worker.pem")
       ext (str ".agent-output/" node "-worker.ext")
       cluster (select-keys (edn/read-string (slurp (str root "/cluster.edn"))) [:endpoints :cluster-id])]
  (spit csr-path (:csr out))
  (assert (s/includes? (shell! "openssl" "req" "-in" csr-path "-noout" "-subject" "-nameopt" "RFC2253") (str "CN=" node)))
  (spit ext "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n")
  (shell! "openssl" "x509" "-req" "-in" csr-path "-CA" (str root "/client-ca.pem")
          "-CAkey" (str root "/client-ca.key") "-CAcreateserial" "-out" cert-path "-days" "90" "-sha256" "-extfile" ext)
  (let [r (remote! node {:node node :mode "install" :cert (slurp cert-path) :config cluster} :clientInstalled)]
   (spit (str ".agent-output/etcd-worker-" node ".json") (j/generate-string r {:pretty true}))
   (println node "host-owned worker certificate installed"))))
