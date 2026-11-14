(ns otehon.postgres-witness
  "Hosted PostgreSQL CAS port. Caller provisions/authenticates the service and
  binds a unique store ID to a separately administered primary. This adapter
  does not establish independence, protect DB backups from rollback, reconcile
  interrupted commits, or qualify Native. Never silently initialize a row."
  (:require [clojure.edn :as edn] [clojure.string :as str])
  (:import [java.io ByteArrayOutputStream PushbackReader StringReader]
           [java.nio.charset StandardCharsets] [java.util HexFormat]
           [java.util.concurrent TimeUnit]))

(defn- fail! [type msg] (throw (ex-info msg {:type type})))
(defn- digest? [v] (and (string? v) (boolean (re-matches #"[a-f0-9]{64}" v))))
(defn- root? [v]
  (and (map? v) (= #{:format :generation :checkpoint :tail :snapshot :log} (set (keys v)))
       (= :awai.otehon-store/root-v1 (:format v))
       (every? #(and (integer? %) (<= 0 % 9007199254740991)) ((juxt :generation :checkpoint :tail) v))
       (pos? (:generation v)) (<= (:checkpoint v) (:tail v))
       (digest? (:snapshot v)) (digest? (:log v))))
(defn- wire [root]
  (when-not (root? root) (fail! :invalid-witness "invalid witness root"))
  (.formatHex (HexFormat/of) (.getBytes (pr-str ((juxt :format :generation :checkpoint :tail :snapshot :log) root)) StandardCharsets/UTF_8)))
(defn- unwire [s]
  (when-not (and (string? s) (<= 2 (count s) 2048) (even? (count s)) (re-matches #"[a-f0-9]+" s))
    (fail! :invalid-witness "invalid witness encoding"))
  (let [text (String. (.parseHex (HexFormat/of) s) StandardCharsets/UTF_8)
        v (with-open [r (PushbackReader. (StringReader. text))]
            (let [v (edn/read {:eof ::eof :readers {} :default (fn [& _] (fail! :invalid-witness "unknown tag"))} r)]
              (when-not (= ::eof (edn/read {:eof ::eof :readers {}} r)) (fail! :invalid-witness "trailing witness data")) v))]
    (when-not (and (vector? v) (= 6 (count v))) (fail! :invalid-witness "invalid witness fields"))
    (let [root (zipmap [:format :generation :checkpoint :tail :snapshot :log] v)]
      (when-not (and (root? root) (= s (wire root))) (fail! :invalid-witness "noncanonical witness root")) root)))
(defn- read-bounded [stream]
  (with-open [in stream out (ByteArrayOutputStream.)]
    (let [buf (byte-array 1024)]
      (loop [total 0]
        (let [n (.read in buf)]
          (if (neg? n) (String. (.toByteArray out) StandardCharsets/UTF_8)
              (let [next (+ total n)]
                (when (> next 8192) (fail! :witness-service-error "witness response too large"))
                (.write out buf 0 n) (recur next))))))))
(defn- query! [psql service sql]
  (let [builder (doto (ProcessBuilder. ^java.util.List
                       [psql "-X" "-q" "-A" "-t" "-v" "ON_ERROR_STOP=1" "-d" (str "service=" service) "-f" "-"])
                  (.redirectErrorStream true))
        env (.environment builder)
        ;; Routing, session and TLS choices come from the selected service,
        ;; never ambient overrides. PGSERVICEFILE and credentials may remain.
        _ (doseq [k ["PGHOST" "PGHOSTADDR" "PGPORT" "PGDATABASE" "PGUSER" "PGSERVICE" "PGOPTIONS"
                     "PGTARGETSESSIONATTRS" "PGLOADBALANCEHOSTS" "PGHOSTRECHECKSECONDS"
                     "PGSSLMODE" "PGSSLCERT" "PGSSLKEY" "PGSSLROOTCERT" "PGSSLCRL" "PGSSLCRLDIR"
                     "PGREQUIRESSL" "PGSSLCOMPRESSION" "PGSSLNEGOTIATION" "PGSSLSNI" "PGSSLKEYLOGFILE"
                     "PGREQUIREAUTH" "PGCHANNELBINDING" "PGGSSENCMODE"]]
            (.remove env k))
        p (.start builder)
        output (future (read-bounded (.getInputStream p)))]
    (try
      (with-open [in (.getOutputStream p)] (.write in (.getBytes sql StandardCharsets/UTF_8)))
      (when-not (.waitFor p 15 TimeUnit/SECONDS) (fail! :witness-service-timeout "witness service timed out"))
      (let [s (deref output 1000 ::timeout)]
        (when (or (= s ::timeout) (not= 0 (.exitValue p))) (fail! :witness-service-error "witness query failed"))
        (str/trim s))
      (finally (.destroyForcibly p)))))
(defn- transition! [old next]
  (when-not (and (root? old) (root? next) (= (inc (:generation old)) (:generation next))
                 (<= (:tail old) (:tail next)) (<= (:checkpoint old) (:checkpoint next)))
    (fail! :invalid-witness "non-monotonic root update")))
(defn port
  "Return prepared-root read/CAS callbacks. The pre-provisioned table is
  awai_witness.root(store_id text primary key, root bytea not null, pending bytea). PSQL is
  an absolute executable path; SERVICE selects a trusted libpq service config.
  Routing, TLS and session choices must be in that service configuration;
  ambient libpq routing, TLS and session variables are not forwarded.
  Provisioning, authentication and rollback-resistant DB administration are
  external. A failed/ambiguous CAS must never be interpreted as success."
  [psql service store-id]
  (when-not (and (string? psql) (.isAbsolute (java.io.File. psql))
                 (string? service) (re-matches #"[A-Za-z0-9_-]{1,64}" service) (digest? store-id))
    (fail! :invalid-witness "invalid PostgreSQL witness configuration"))
  (letfn [(status []
            (let [v (query! psql service (str "SELECT CASE WHEN pg_is_in_recovery() THEN 'replica' ELSE COALESCE((SELECT encode(root,'hex')||':'||COALESCE(encode(pending,'hex'),'-') FROM awai_witness.root WHERE store_id='" store-id "'),'missing') END;\n"))
                  parts (str/split v #":" -1)]
              (when-not (= 2 (count parts)) (fail! :invalid-witness "missing or invalid witness row"))
              {:root (unwire (first parts)) :pending (when-not (= "-" (second parts)) (unwire (second parts)))}))
          (update! [set-clause where-clause]
            (let [result (query! psql service (str "SET synchronous_commit=on; WITH changed AS (UPDATE awai_witness.root SET " set-clause
                                                  " WHERE store_id='" store-id "' AND " where-clause
                                                  " RETURNING 1) SELECT count(*) FROM changed;\n"))]
              (cond (= result "1") true (= result "0") false
                    :else (fail! :witness-service-error "unexpected witness update result"))))]
    {:read! (fn [] (let [{:keys [root pending]} (status)]
                     (when pending (fail! :witness-pending "prepared root requires reconciliation"))
                     root))
     :status! status
     :prepare! (fn [old next]
                 (transition! old next)
                 (let [o (wire old) n (wire next)]
                   (update! (str "pending=decode('" n "','hex')")
                            (str "root=decode('" o "','hex') AND (pending IS NULL OR pending=decode('" n "','hex'))"))))
     :compare-and-set! (fn [old next]
                         (transition! old next)
                         (update! (str "root=decode('" (wire next) "','hex'), pending=NULL")
                                  (str "root=decode('" (wire old) "','hex') AND pending=decode('" (wire next) "','hex')")))}))
