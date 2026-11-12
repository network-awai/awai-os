(ns itonami.otehon.etcd
  "Owner-approved Otehon etcd host transport. Exact binary, cluster and TLS
  identity pins; gRPC etcdctl preserves certificate-CN RBAC (not HTTP gateway)."
  (:require [clojure.string :as str] [itonami.otehon.io :as hio]
            #?(:clj [clojure.java.shell :as sh])
            #?(:clj [clojure.edn :as edn])
            #?(:clj [cheshire.core :as json])))
(defn- scope! [k]
  (when-not (and (string? k) (re-matches #"/itonami/occurrence/v1/(enrollment|cursor|run)/[a-f0-9]{64}" k))
    (throw (ex-info "out-of-scope key" {}))))
(defn transaction-input [{:keys [compare put]}]
  (when-not (and (map? compare) (map? put) (<= 1 (count compare) 3) (<= 1 (count put) 2))
    (throw (ex-info "bounded CAS required" {})))
  (doseq [k (concat (keys compare) (keys put))] (scope! k))
  (doseq [v (concat (remove nil? (vals compare)) (vals put))]
    (when-not (and (string? v) (<= (count v) 65536)) (throw (ex-info "value limit" {}))))
  ;; JSON quoting prevents new txn lines/commands from values. This goes to the
  ;; official parser over stdin, never a shell command string.
  (let [q #?(:clj json/generate-string :default pr-str)]
    (str (str/join "\n" (for [[k v] compare]
                           (str (if (nil? v) "version(" "value(") (q k) ") = " (q (if (nil? v) "0" v)))))
         "\n\n" (str/join "\n" (for [[k v] put] (str "put " (q k) " " (q v)))) "\n\n\n")))
#?(:clj
   (defn binary-sha [path]
     (let [md (java.security.MessageDigest/getInstance "SHA-256") buf (byte-array 65536)]
       (with-open [f (java.io.FileInputStream. path)]
         (loop [] (let [n (.read f buf)] (when (pos? n) (.update md buf 0 n) (recur)))))
       (apply str (map #(format "%02x" (bit-and (int %) 255)) (.digest md))))))
(defn client [{:keys [endpoints ca cert key cluster-id authenticated-node etcdctl etcdctl-sha256]}]
  #?(:clj
     (do
       (when-not (and (vector? endpoints) (= 3 (count endpoints))
                      (= 3 (count (distinct endpoints)))
                      (every? #(and (string? %) (re-matches #"https://[A-Za-z0-9.:-]+" %)) endpoints)
                      (string? cluster-id) (re-matches #"[0-9]+" cluster-id)
                      (string? authenticated-node) (re-matches #"[A-Za-z0-9-]{1,64}" authenticated-node)
                      (every? #(and (string? %) (.isFile (java.io.File. %))) [ca cert key etcdctl])
                      (= etcdctl-sha256 (binary-sha etcdctl)))
         (throw (ex-info "pinned binary/cluster/TLS configuration required" {})))
       (let [subject (sh/sh "openssl" "x509" "-in" cert "-noout" "-subject" "-nameopt" "RFC2253")
             cn (second (re-find #"(?:^|[,=])CN=([^,\n]+)" (str/replace (:out subject) "subject=" "")))]
         (when-not (and (zero? (:exit subject)) (= cn authenticated-node))
           (throw (ex-info "certificate identity mismatch" {}))))
       (let [argv [etcdctl (str "--endpoints=" (str/join "," endpoints))
                   (str "--cacert=" ca) (str "--cert=" cert) (str "--key=" key)
                   "--dial-timeout=2s" "--command-timeout=6s" "--write-out=json"]
             call (fn [args input]
                    (let [r (apply sh/sh (concat argv args [:in (or input "")]))]
                      (when-not (and (zero? (:exit r)) (<= (count (:out r)) 1048576))
                        (throw (ex-info "authenticated etcd request uncertain" {})))
                      (let [v (json/parse-string (:out r) true)]
                        (when-not (= cluster-id (str (get-in v [:header :cluster_id])))
                          (throw (ex-info "cluster identity mismatch" {}))) v)))]
         {:authenticated-node authenticated-node
          :read (fn [k]
                  (scope! k)
                  (let [r (call ["get" k "--consistency=l"] nil)]
                    (when-let [v (get-in r [:kvs 0 :value])]
                      (edn/read-string (String. (.decode (java.util.Base64/getDecoder) ^String v) "UTF-8")))))
          :transact (fn [txn]
                      (let [r (call ["txn"] (transaction-input txn))]
                        {:succeeded (true? (:succeeded r)) :revision (get-in r [:header :revision])}))}))
     :default (throw (ex-info "etcd host transport requires Babashka Otehon" {}))))
