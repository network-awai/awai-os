(ns meiji.trust-rotation
  "Explicit operator CLI for the existing three-node Otehon client trust bundle.
   Does not touch peer/server keys, data directories, users, roles or membership."
  (:require [babashka.fs :as fs] [cheshire.core :as json]
            [clojure.java.shell :as sh] [clojure.string :as str]
            [meiji.host :as host] [meiji.policy :as policy])
  (:import [java.nio.file StandardCopyOption]))

(def cluster "15997540139816619698")
(def nodes #{"levi" "benjamin" "joseph"})
(defn ca-bundle [old additional]
  (policy/require! (and (str/includes? old "-----BEGIN CERTIFICATE-----")
                        (str/starts-with? additional "-----BEGIN CERTIFICATE-----")
                        (str/includes? additional "-----END CERTIFICATE-----")) "ca-pem-required")
  (if (str/includes? old (str/trim additional)) old
    (str old (when-not (str/ends-with? old "\n") "\n") additional)))

(defn status! [cfg]
  (policy/require! (= (:etcdctl-sha256 cfg) (host/sha256 (:etcdctl cfg))) "etcdctl-pin-mismatch")
  (let [result (apply sh/sh [(:etcdctl cfg) (str "--endpoints=" (str/join "," (:endpoints cfg)))
                           (str "--cacert=" (:ca cfg)) (str "--cert=" (:cert cfg)) (str "--key=" (:key cfg))
                           "--dial-timeout=4s" "--command-timeout=8s" "endpoint" "status" "-w" "json"])]
    (policy/require! (zero? (:exit result)) "cluster-status-unconfirmed")
    (let [members (json/parse-string (:out result) true)]
      (policy/require! (and (= 3 (count members))
                            (every? #(and (= cluster (str (get-in % [:Status :header :cluster_id])))
                                          (pos? (get-in % [:Status :leader] 0)) (empty? (get-in % [:Status :errors]))) members))
                       "healthy-original-cluster-required")
      (mapv #(select-keys (:Status %) [:header :leader]) members))))

(defn -main [& [phase additional-path expected-sha]]
  (policy/require! (contains? #{"prepare" "apply"} phase) "fixed-phase-required")
  (policy/require! (= "node" (System/getProperty "user.name")) "owning-node-account-required")
  (let [root (str (System/getProperty "user.home") "/.itonami/control-plane/etcd/awai-bots-v1")
        cfg (json/parse-string (slurp (str root "/worker-client.json")) true)
        node (:authenticated-node cfg)
        ca-path (str root "/pki/client-ca.pem")
        backup (str root "/pki/client-ca.before-meiji-20261116.pem")
        staging (str root "/pki/client-ca.meiji-20261116.pending.pem")
        config-file (str (System/getProperty "user.home") "/github/workspaces/codex/awai-2795-etcd-control-plane/config/etcd.yml")
        config (slurp config-file)
        _ (policy/require! (and (contains? nodes node) (= cluster (:cluster-id cfg))
                                (str/includes? config (str "trusted-ca-file: " ca-path))
                                (str/includes? config "client-cert-auth: true")
                                (not (fs/sym-link? ca-path)) (not (fs/sym-link? additional-path))) "original-trust-configuration-required")
        before (status! cfg)
        _ (policy/require! (= expected-sha (host/sha256 additional-path)) "recovery-ca-pin-mismatch")
        validate (sh/sh "/usr/bin/openssl" "x509" "-in" additional-path "-noout" "-text")
        _ (policy/require! (and (zero? (:exit validate)) (str/includes? (:out validate) "CA:TRUE")) "recovery-ca-invalid")
        old (slurp ca-path) additional (slurp additional-path) bundle (ca-bundle old additional)]
    (when-not (fs/exists? backup)
      (fs/create-file backup) (fs/set-posix-file-permissions backup "rw-------") (spit backup old))
    (if (= phase "prepare")
      (do (spit staging bundle) (fs/set-posix-file-permissions staging "rw-------")
          (println (json/generate-string {:node node :prepared true :oldCaRetained true :cluster cluster :members before})))
      (do
        (policy/require! (and (fs/regular-file? staging) (= bundle (slurp staging))) "prepared-bundle-required")
        (when-not (= old bundle)
          (java.nio.file.Files/move (fs/path staging) (fs/path ca-path)
            (into-array java.nio.file.CopyOption [StandardCopyOption/ATOMIC_MOVE StandardCopyOption/REPLACE_EXISTING]))
          (let [uid (str/trim (:out (sh/sh "/usr/bin/id" "-u")))
                restart (sh/sh "/bin/launchctl" "kickstart" "-k" (str "user/" uid "/network.awai.otehon.etcd"))]
            (policy/require! (zero? (:exit restart)) "restart-unconfirmed")))
        (let [members (loop [attempt 0]
                        (let [result (try {:members (status! cfg)} (catch Exception _ {:retry true}))]
                          (if (:members result) (:members result)
                            (if (< attempt 8) (do (Thread/sleep 1000) (recur (inc attempt)))
                              (policy/fail "post-update-quorum-unconfirmed")))))]
          (println (json/generate-string {:node node :applied true :cluster cluster :members members
                                         :oldCaRetained true :oldCredentialRevoked false})))))))
