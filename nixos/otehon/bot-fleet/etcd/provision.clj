(ns etcd-provision
  "Operator-only staged provisioner. No bot commands, credentials in output or VM updates."
  (:require [cheshire.core :as j] [clojure.java.shell :as sh] [clojure.string :as s]
            [clojure.edn :as edn]))
(def base "nixos/otehon/bot-fleet/etcd/")
(def hosts ["levi" "benjamin" "joseph"])
(def private-root (str (System/getProperty "user.home") "/.itonami/control-plane/etcd/awai-bots-v1"))
(defn run! [& argv]
  (let [r (apply sh/sh argv)] (when-not (zero? (:exit r)) (throw (ex-info "operator step failed; preserve partial state" {:program (first argv) :exit (:exit r)}))) (:out r)))
(defn quote-sh [x] (str "'" (s/replace x "'" "'\\''") "'"))
(defn remote [host script payload]
  (when-not (some #{host} hosts) (throw (ex-info "unknown deployment host" {})))
  (let [r (sh/sh "ssh" "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=yes" "-o" "ConnectTimeout=8"
                 "-o" "ForwardAgent=no" "-o" "ClearAllForwardings=yes" "-o" "PermitLocalCommand=no"
                 "-T" (str "node@" host) (str "python3 -c " (quote-sh (slurp (str base script))))
                 :in (j/generate-string payload))]
    (let [v (try (j/parse-string (:out r) true) (catch Exception _ nil))
          field (if (= script "prepare.py") :prepared :activated)]
      (when-not (and (zero? (:exit r)) (map? v) (= host (:node v)) (true? (get v field)))
        (spit (str ".agent-output/etcd-error-" script "-" host ".log") (str (:err r) "\n" (:out r)))
        (throw (ex-info "remote application status unconfirmed; retain partial deployment" {:node host :exit (:exit r)}))) v)))
(defn put-new [path data]
  (when (.exists (java.io.File. path)) (throw (ex-info "existing output preserved" {:path path})))
  (spit path data))
(defn preflight []
  (let [rows (j/parse-string (slurp ".agent-output/etcd-preflight.json") true)
        old (:nodes (j/parse-string (slurp ".agent-output/ten-mac-mini-runtime-20261112.json") true))
        identity (into {} (map (juxt :node #(get-in % [:observation :identity_sha256])) old))]
    (when-not (and (= (set hosts) (set (map :node rows))) (= 3 (count (set (map :ip rows))))
                   (= 3 (count (set (map :identity_sha256 rows))))
                   (every? #(and (= (:identity_sha256 %) (identity (:node %)))
                                  (re-matches #"100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}" (:ip %))
                                  (every? false? (vals (:portsUsed %)))) rows))
      (throw (ex-info "verified separate hosts/free ports required" {}))) rows))
(defn prepare []
  (preflight)
  (let [source (j/parse-string (slurp (str base "sources.json")) true)
        pending (mapv (fn [host] (future (try
                      (let [r (remote host "prepare.py" {:node host :version (:version source) :sha256 (get-in source [:darwin-arm64 :sha256])})]
                        (put-new (str ".agent-output/etcd-prepared-" host ".json") (j/generate-string r {:pretty true}))
                        {:node host :prepared (:prepared r)})
                      (catch Exception e {:node host :error (.getMessage e)})))) hosts)
        results (mapv deref pending)]
    (put-new ".agent-output/etcd-prepare-results.json" (j/generate-string results {:pretty true}))
    (prn results)))
(defn ca-config [name]
  (str "[req]\ndistinguished_name=dn\nx509_extensions=v3_ca\nprompt=no\n[dn]\nCN=" name
       "\n[v3_ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n"))
(defn sign-csr [ca csr cert ext]
  (run! "openssl" "x509" "-req" "-in" csr "-CA" (str private-root "/" ca ".pem")
        "-CAkey" (str private-root "/" ca ".key") "-CAcreateserial" "-out" cert "-days" "90" "-sha256" "-extfile" ext))
(defn init-pki []
  (preflight)
  (when (.exists (java.io.File. private-root)) (throw (ex-info "existing PKI root preserved" {})))
  (run! "mkdir" "-p" private-root)
  (run! "chmod" "700" private-root)
  (doseq [ca ["peer-ca" "client-ca"]]
    (let [key (str private-root "/" ca ".key") cfg (str ".agent-output/" ca ".cnf")]
      (spit cfg (ca-config (str "Awai-Itonami-" ca "-v1")))
      (run! "openssl" "ecparam" "-name" "prime256v1" "-genkey" "-noout" "-out" key)
      (run! "chmod" "600" key)
      (run! "openssl" "req" "-new" "-x509" "-key" key "-out" (str private-root "/" ca ".pem") "-days" "365" "-sha256" "-config" cfg)))
  (doseq [{:keys [node ip]} (preflight) kind ["server" "peer"]]
    (let [r (j/parse-string (slurp (str ".agent-output/etcd-prepared-" node ".json")) true)
          csr (str ".agent-output/" node "-" kind ".csr") ext (str ".agent-output/" node "-" kind ".ext")
          subject (str "awai-etcd-" node "-" kind) cert (str private-root "/" node "-" kind ".pem")]
      (spit csr (get (:csrs r) (keyword kind)))
      (when-not (s/includes? (run! "openssl" "req" "-in" csr "-noout" "-subject" "-nameopt" "RFC2253") (str "CN=" subject))
        (throw (ex-info "CSR identity mismatch" {})))
      (spit ext (str "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nsubjectAltName=IP:" ip
                     "\nextendedKeyUsage=" (if (= kind "peer") "serverAuth,clientAuth" "serverAuth") "\n"))
      (sign-csr (if (= kind "peer") "peer-ca" "client-ca") csr cert ext)))
  (doseq [name ["root" "jun-control" "soshiki-observer"]]
    (let [key (str private-root "/" name ".key") csr (str private-root "/" name ".csr") ext (str ".agent-output/" name ".ext")]
      (run! "openssl" "ecparam" "-name" "prime256v1" "-genkey" "-noout" "-out" key)
      (run! "chmod" "600" key)
      (run! "openssl" "req" "-new" "-key" key "-out" csr "-subj" (str "/CN=" name))
      (spit ext "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n")
      (sign-csr "client-ca" csr (str private-root "/" name ".pem") ext)))
  (println "Dedicated PKI created; private node keys stayed on their hosts"))
(defn activate []
  (let [rows (preflight) members (into (sorted-map) (map (juxt :node :ip) rows))
        pending (mapv (fn [host] (future (try
                     (let [payload {:node host :members members
                                    :certs {:server.pem (slurp (str private-root "/" host "-server.pem"))
                                            :peer.pem (slurp (str private-root "/" host "-peer.pem"))
                                            :client-ca.pem (slurp (str private-root "/client-ca.pem"))
                                            :peer-ca.pem (slurp (str private-root "/peer-ca.pem"))}}
                           r (remote host "activate.py" payload)]
                       (put-new (str ".agent-output/etcd-activated-confirmed-" host ".json") (j/generate-string r {:pretty true})) r)
                     (catch Exception e {:node host :error (.getMessage e)})))) hosts)]
    (prn (mapv deref pending))))
(case (first *command-line-args*) "prepare" (prepare) "pki" (init-pki) "activate" (activate)
  (throw (ex-info "usage: bb provision.clj prepare|pki|activate (staged; review each output)" {})))
