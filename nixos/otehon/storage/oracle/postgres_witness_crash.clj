;; Real PostgreSQL witness, task-owned local cluster, SIGKILLed writer.
;; No claim of independent failure domains, OS cache loss or power failure.
(require '[clojure.edn :as edn] '[clojure.java.io :as io] '[babashka.classpath :as cp]
         '[otehon.storage :as store] '[otehon.pack-store :as pack]
         '[otehon.postgres-witness :as pg] '[otehon.witnessed-pack-test])
(def base (or (System/getenv "PG_WITNESS_PROOF") (throw (ex-info "output required" {}))))
(def psql (or (System/getenv "PG_WITNESS_PSQL") (throw (ex-info "psql required" {}))))
(def service (or (System/getenv "PG_WITNESS_SERVICE") (throw (ex-info "service required" {}))))
(def cases [{:name "forest" :role :forest :event :dir-synced :id "c" :want {:generation 1 :packs 0}}
            {:name "prepared" :role :witness :event :after-prepare :id "8" :want {:error :witness-pending}}
            {:name "root" :role :root :event :renamed :id "d" :want {:error :witness-pending}}
            {:name "before" :role :witness :event :before-cas :id "e" :want {:error :witness-pending}}
            {:name "after" :role :witness :event :after-cas :id "f" :want {:generation 2 :packs 4}}])
(defn ensure! [v msg data] (when-not v (throw (ex-info msg data))))
(defn id [c] (apply str (repeat 64 (:id c))))
(defn path [c] (str base "/crash-" (:name c)))
(defn port [c] (pg/port psql service (id c)))
(defn bootstrap! [c root]
  (#'pg/query! psql service (str "INSERT INTO awai_witness.root (store_id,root) VALUES ('" (id c) "',decode('" (#'pg/wire root) "','hex'));\n")))
(defn spawn [mode name]
  (.start (doto (ProcessBuilder. ^java.util.List [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) *file* mode name]) (.redirectErrorStream true))))
(defn finish [p]
  (try (ensure! (.waitFor p 90 java.util.concurrent.TimeUnit/SECONDS) "reader timeout" {})
       (let [s (slurp (.getInputStream p))]
         (ensure! (zero? (.exitValue p)) "reader failed" {:output s}) (edn/read-string s))
       (finally (.destroyForcibly p))))
(defn reader [c]
  (try (let [h (pack/recover-witnessed (path c) (:read! (port c)))
             n (count (get-in (pack/summary h) [:groups "proof" :packs]))]
         (when (= 4 n)
           (let [offset (- (* 8 65536) 20)
                 expected (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range offset (+ offset 40))))]
             (ensure! (java.util.Arrays/equals expected (pack/read-group-range h "proof" offset 40)) "cross-Pack range changed" {})))
         {:generation (get-in (pack/summary h) [:basis :generation]) :packs n})
       (catch clojure.lang.ExceptionInfo e {:error (:type (ex-data e))})))
(defn writer [c]
  (let [{:keys [paths bytes cid]} (#'otehon.witnessed-pack-test/fixture)]
    (binding [store/*write-observer*
              (fn [e r] (when (= [e r] [(:event c) (:role c)])
                          (prn {:ready true}) (flush) (Thread/sleep 120000)
                          (throw (ex-info "expected kill" {}))))]
      (pack/import-logical-forest-files! (path c) "proof" paths bytes cid {:expected-generation 1 :witness (port c)}))
    (throw (ex-info "boundary not reached" {}))))
(defn verify-case [c]
  (let [result (finish (spawn "read" (:name c)))]
    (ensure! (= (:want c) result) "unexpected witnessed recovery" {:case (:name c) :actual result :expected (:want c)})
    (prn {:case (:name c) :result result :pass true}) (flush)))
(defn reconcile-case [c]
  (let [w (port c) before ((:status! w))
        result (try (pack/reconcile-witnessed! (path c) w)
                    (catch clojure.lang.ExceptionInfo e {:error (:type (ex-data e))}))
        expected (case (:name c) "prepared" :witness-review-required
                       "root" :committed-pending "before" :committed-pending :already-consistent)]
    (if (= "prepared" (:name c))
      (do (ensure! (= expected (:error result)) "missing candidate should require review" {:result result})
          (ensure! (= before ((:status! w))) "review changed witness" {}))
      (do (ensure! (= expected (:outcome result)) "reconcile failed" {:result result})
          (ensure! (= :already-consistent (:outcome (pack/reconcile-witnessed! (path c) w))) "reconcile not idempotent" {})
          (when (#{"root" "before"} (:name c))
            (ensure! (= {:generation 2 :packs 4} (reader c)) "reconciled data missing" {}))))
    (prn {:case (:name c) :reconcile expected :pass true}) (flush)))
(defn run-case [c]
  (store/init! (path c)) (bootstrap! c (:root (store/read-store (path c))))
  (let [p (spawn "write" (:name c))]
    (try
      (with-open [r (io/reader (.getInputStream p))]
        (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 90000 nil)]
          (ensure! (and line (:ready (edn/read-string line))) "writer boundary not reached" {:case (:name c) :output line})))
      (.destroyForcibly p)
      (ensure! (and (.waitFor p 15 java.util.concurrent.TimeUnit/SECONDS) (= 137 (.exitValue p))) "writer kill failed" {:case (:name c)})
      (verify-case c)
      (finally (.destroyForcibly p)))))
(let [[mode name] *command-line-args* c (first (filter #(= name (:name %)) cases))]
  (case mode
    "run" (try (doseq [item cases] (run-case item)) (prn {:mode :run :cases 5 :pass true}) (finally (shutdown-agents)))
    "verify" (try (doseq [item cases] (verify-case item)) (prn {:mode :verify :cases 5 :pass true}) (finally (shutdown-agents)))
    "reconcile" (try (doseq [item cases] (reconcile-case item)) (prn {:mode :reconcile :cases 5 :pass true}) (finally (shutdown-agents)))
    "write" (do (ensure! c "unknown case" {}) (writer c))
    "read" (do (ensure! c "unknown case" {}) (prn (reader c)))
    (throw (ex-info "run, verify, write or read required" {}))))
