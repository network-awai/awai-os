(ns meiji.review-ledger
  "Single-key CAS for the separately granted review prefix. Occurrence transport
   remains unchanged and cannot accept this new service's keys."
  (:require [clojure.edn :as edn] [clojure.string :as str] [clojure.java.shell :as sh]
            [cheshire.core :as json] [itonami.otehon.etcd :as etcd] [meiji.policy :as p]))
(defn checked-key! [key]
  (p/require! (and (string? key) (re-matches #"/awai/meiji/review/v1/[a-f0-9]{64}" key)) "review-prefix-only"))
(defn transaction-text [{:keys [compare put]}]
  (p/require! (and (= 1 (count compare) (count put)) (= (set (keys compare)) (set (keys put)))) "single-review-key-required")
  (let [[key old] (first compare) value (get put key) q json/generate-string]
    (checked-key! key)
    (p/require! (and (or (nil? old) (and (string? old) (<= (count old) 65536)))
                     (string? value) (<= (count value) 65536)) "review-value-limit")
    (str (if (nil? old) "version(" "value(") (q key) ") = " (q (if (nil? old) "0" old))
         "\n\nput " (q key) " " (q value) "\n\n\n")))
(defn client [cfg]
  ;; Reuse canonical executable hash, certificate CN and endpoint validation.
  (etcd/client cfg)
  (let [argv [(:etcdctl cfg) (str "--endpoints=" (str/join "," (:endpoints cfg)))
              (str "--cacert=" (:ca cfg)) (str "--cert=" (:cert cfg)) (str "--key=" (:key cfg))
              "--dial-timeout=2s" "--command-timeout=6s" "--write-out=json"]
        call (fn [args input]
               (let [r (apply sh/sh (concat argv args [:in (or input "")]))]
                 (p/require! (and (zero? (:exit r)) (<= (count (:out r)) 1048576)) "review-ledger-uncertain")
                 (let [v (json/parse-string (:out r) true)]
                   (p/require! (= (:cluster-id cfg) (str (get-in v [:header :cluster_id]))) "review-cluster-mismatch") v)))]
    {:authenticated-node (:authenticated-node cfg)
     :read (fn [key]
             (checked-key! key)
             (when-let [v (get-in (call ["get" key "--consistency=l"] nil) [:kvs 0 :value])]
               (edn/read-string (String. (.decode (java.util.Base64/getDecoder) ^String v) "UTF-8"))))
     :transact (fn [txn] {:succeeded (true? (:succeeded (call ["txn"] (transaction-text txn))))})}))
