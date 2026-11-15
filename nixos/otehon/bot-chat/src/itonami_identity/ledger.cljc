(ns itonami-identity.ledger
 (:require [clojure.string :as str] [itonami-identity.mail :as m]
  #?(:clj [cheshire.core :as j]) #?(:clj [clojure.edn :as edn]) #?(:clj [clojure.java.shell :as sh])
  #?(:clj [clojure.java.io :as io]) #?(:clj [itonami-identity.custody :as custody])
  #?(:clj [itonami.otehon.etcd :as etcd])))
(defn key-for [namespace digest] (str "/itonami/identity/v1/" namespace "/" digest))
#?(:clj
 (do
  (defn client [cfg]
   (if (:identityFixture cfg)
    ;; CI-only in-process ledger is explicit; production never falls back here.
    (if-let [state (:fixtureLedger cfg)]
     {:read #(get @state %) :claim (fn [k v] (get (swap! state #(if (contains? % k) % (assoc % k v))) k))
      :cas (fn [k expected value] (let [old @state] (and (= (get old k) expected) (compare-and-set! state old (assoc old k value)))))}
     (let [root (:fixtureLedgerRoot cfg) file (str root "/ledger.edn")
           _ (m/require! (and (string? root) (.isAbsolute (io/file root))) "fixture-ledger-required")
           read-all #(if (.exists (io/file file)) (edn/read-string (slurp file)) {})
           locked #(custody/locked {:identityRoot root} %)]
      {:read (fn [k] (locked #(get (read-all) k)))
       :claim (fn [k v] (locked #(let [state (read-all)]
          (if-let [old (get state k)] old
           (do (custody/file! file (.getBytes (pr-str (assoc state k v)) "UTF-8") (.exists (io/file file))) v)))))
       :cas (fn [k expected value] (locked #(let [state (read-all)] (when (= expected (get state k))
            (custody/file! file (.getBytes (pr-str (assoc state k value)) "UTF-8") (.exists (io/file file))) true))))}))
    (let [c (edn/read-string (slurp (:identityEtcdConfig cfg)))
          _ (etcd/client c) ; validates pinned binary, three endpoints, TLS CN and cluster contract
          argv [(:etcdctl c) (str "--endpoints=" (str/join "," (:endpoints c))) (str "--cacert=" (:ca c)) (str "--cert=" (:cert c)) (str "--key=" (:key c)) "--dial-timeout=2s" "--command-timeout=6s" "--write-out=json"]
          scoped (fn [k] (m/require! (and (string? k) (re-matches #"/itonami/identity/v1/[A-Za-z0-9_-]{8,100}/[a-f0-9]{64}" k)) "identity-ledger-scope"))
          call (fn [args input] (let [r (apply sh/sh (concat argv args [:in (or input "")]))]
             (m/require! (and (zero? (:exit r)) (<= (count (:out r)) 1048576)) "identity-ledger-unavailable")
             (let [v (j/parse-string (:out r) true)] (m/require! (= (:cluster-id c) (str (get-in v [:header :cluster_id]))) "identity-cluster-mismatch") v)))
          read (fn [k] (scoped k) (when-let [v (get-in (call ["get" k "--consistency=l"] nil) [:kvs 0 :value])]
                      (j/parse-string (String. (.decode (java.util.Base64/getDecoder) ^String v) "UTF-8") true)))]
     {:read read
      :cas (fn [k expected value]
       (scoped k)
       (let [condition (if (nil? expected) (str "version(" (j/generate-string k) ") = \"0\"")
                          (str "value(" (j/generate-string k) ") = " (j/generate-string (j/generate-string expected))))
             payload (j/generate-string value)]
        (m/require! (< (count payload) 8192) "identity-ledger-value-limit")
        (true? (:succeeded (call ["txn"] (str condition "\n\nput " (j/generate-string k) " " (j/generate-string payload) "\n\n\n"))))))
      :claim (fn [k v]
       (scoped k)
       (let [value (j/generate-string v)] (m/require! (< (count value) 8192) "identity-ledger-value-limit")
        (call ["txn"] (str "version(" (j/generate-string k) ") = \"0\"\n\nput " (j/generate-string k) " " (j/generate-string value) "\n\n\n"))
        (or (read k) (throw (ex-info "identity-registration-unconfirmed" {})))))})))))
