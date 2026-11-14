;; This test driver pauses its own child inside real adapter I/O. It never
;; signals a process it did not spawn, or opens an operational data volume.
(require '[clojure.edn :as edn]
         '[clojure.java.io :as io]
         '[babashka.classpath :as cp]
         '[otehon.storage :as store])

(defn write-child [directory operation event role]
  (binding [store/*write-observer*
            (fn [e r]
              (when (= [event role] [e r])
                (prn {:ready true :event e :role r})
                (flush)
                (Thread/sleep 30000)
                (throw (ex-info "fault driver was not killed" {}))))]
    (case operation
      :put (store/transact! directory :put {:key "a" :value "new"})
      :checkpoint (store/checkpoint! directory)))
  (throw (ex-info "requested write boundary was never reached" {})))

(defn child [script mode directory & args]
  (.start (doto (ProcessBuilder.
                 ^java.util.List
                 (into [(or (System/getenv "BABASHKA") "bb") "--classpath"
                        (cp/get-classpath) script mode directory] args))
            (.redirectErrorStream true))))

(defn read-child [script directory]
  (let [reader (child script "read" directory)]
    (try
      (when-not (.waitFor reader 10 java.util.concurrent.TimeUnit/SECONDS)
        (throw (ex-info "reader timeout" {})))
      (let [text (slurp (.getInputStream reader))]
        (when-not (zero? (.exitValue reader))
          (throw (ex-info "fresh reader failed" {:output text})))
        (edn/read-string text))
      (finally
        (.destroyForcibly reader)
        (.waitFor reader 10 java.util.concurrent.TimeUnit/SECONDS)))))

(defn run-case [script output operation event role]
  (let [directory (str (io/file output (str (name operation) "-" (name role) "-" (name event))))]
    (store/init! directory)
    (store/transact! directory :put {:key "a" :value "old"})
    (store/transact! directory :put {:key "b" :value "keep"})
    (let [writer (child script "write" directory (name operation) (name event) (name role))]
      (try
        (with-open [out (io/reader (.getInputStream writer))]
          (let [text (deref (future (.readLine ^java.io.BufferedReader out)) 10000 nil)]
            (when-not (and text (:ready (edn/read-string text)))
              (throw (ex-info "writer did not reach boundary" {:output text :operation operation :role role :event event})))))
        (let [denial (try (store/transact! directory :delete {:key "b"}) nil
                          (catch Exception e (:type (ex-data e))))]
          (when-not (= :writer-busy denial)
            (throw (ex-info "concurrent process bypassed writer lock" {:observed denial}))))
        ;; The writer is paused before completing the selected I/O phase.
        (.destroyForcibly writer)
        (when-not (.waitFor writer 10 java.util.concurrent.TimeUnit/SECONDS)
          (throw (ex-info "writer kill timed out" {})))
        (when-not (= 137 (.exitValue writer))
          (throw (ex-info "expected force-killed writer" {:exit (.exitValue writer)})))
        ;; OS-visible atomic rename is the commit boundary for process death.
        ;; Host/power-loss durability is a different test model.
        (let [published? (and (= role :root) (#{:renamed :dir-synced} event))
              expected-state (if (and (= operation :put) published?)
                               {"a" "new" "b" "keep"} {"a" "old" "b" "keep"})
              expected-tail (if (and (= operation :put) published?) 3 2)
              expected-cp (if (and (= operation :checkpoint) published?) 2 0)
              result (read-child script directory)]
          (when-not (and (= expected-state (:state result))
                         (= expected-tail (get-in result [:root :tail]))
                         (= expected-cp (get-in result [:root :checkpoint]))
                         (false? (:degraded? result)))
            (throw (ex-info "crash recovery mismatch" {:operation operation :role role :event event :observed result})))
          ;; Cross-process lock must have been released by process death.
          (store/transact! directory :put {:key "after-kill" :value "ok"})
          (when-not (= "ok" (get-in (read-child script directory) [:state "after-kill"]))
            (throw (ex-info "cannot write after killed writer" {})))
          (prn {:operation operation :role role :event event :writer-exit (.exitValue writer)
                :tail expected-tail :checkpoint expected-cp :concurrent-writer :denied :pass true}))
        (finally
          (.destroyForcibly writer)
          (.waitFor writer 10 java.util.concurrent.TimeUnit/SECONDS))))))

(defn run-initial-case [script output event]
  (let [directory (str (io/file output (str "first-root-" (name event))))]
    (store/init! directory)
    (let [writer (child script "write" directory "put" (name event) "root")]
      (try
        (with-open [out (io/reader (.getInputStream writer))]
          (let [text (deref (future (.readLine ^java.io.BufferedReader out)) 10000 nil)]
            (when-not (and text (:ready (edn/read-string text)))
              (throw (ex-info "writer did not reach first-root boundary" {:event event :output text})))))
        (.destroyForcibly writer)
        (when-not (and (.waitFor writer 10 java.util.concurrent.TimeUnit/SECONDS) (= 137 (.exitValue writer)))
          (throw (ex-info "first-root writer kill failed" {:event event})))
        (let [published? (boolean (#{:renamed :dir-synced} event))
              recovered (read-child script directory)]
          (when-not (and (= (if published? {"a" "new"} {}) (:state recovered))
                         (= (if published? 2 1) (get-in recovered [:root :generation]))
                         (false? (:degraded? recovered)))
            (throw (ex-info "first-root recovery mismatch" {:event event :observed recovered})))
          (store/transact! directory :put {:key "after-kill" :value "ok"})
          (when-not (= "ok" (get-in (read-child script directory) [:state "after-kill"]))
            (throw (ex-info "first-root writer lock not released" {:event event})))
          (prn {:event event :generation (get-in recovered [:root :generation]) :writer-exit 137 :pass true}))
        (finally (.destroyForcibly writer) (.waitFor writer 10 java.util.concurrent.TimeUnit/SECONDS))))))

(let [[mode directory operation event role] *command-line-args*]
  (case mode
    "write" (write-child directory (keyword operation) (keyword event) (keyword role))
    "read" (prn (store/read-store directory))
    "run-initial" (try
                    (when-not (.mkdir (io/file directory))
                      (throw (ex-info "output directory must be new" {})))
                    (doseq [event [:half-written :written :file-synced :renamed :dir-synced]]
                      (run-initial-case *file* directory event))
                    (prn {:cases 5 :pass true})
                    (finally (shutdown-agents)))
    "run" (try
            (when-not (.mkdir (io/file directory))
              (throw (ex-info "output directory must be new" {})))
            (doseq [operation [:put :checkpoint]
                    role (if (= operation :put) [:wal :root] [:snapshot :wal :root])
                    event [:half-written :written :file-synced :renamed :dir-synced]]
              (run-case *file* directory operation event role))
            (prn {:cases 25 :pass true})
            (finally (shutdown-agents)))
    (throw (ex-info "usage: crash_runner.clj run NEW_OUTPUT_DIRECTORY" {}))))
