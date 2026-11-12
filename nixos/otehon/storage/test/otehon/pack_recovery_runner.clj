;; Uses only disposable fixtures and child processes created by this driver.
(require '[clojure.edn :as edn]
         '[clojure.java.io :as io]
         '[babashka.classpath :as cp]
         '[otehon.storage :as store]
         '[otehon.pack-store :as pack])
(import '[java.nio.file Files Paths CopyOption LinkOption]
        '[java.nio.file.attribute PosixFilePermissions FileAttribute])

(def use-zstd3? (= "1" (System/getenv "OTEHON_TEST_ZSTD3")))
(def put! (if use-zstd3? pack/put-data-zstd3! pack/put-data!))
(def import! (if use-zstd3? pack/import-car-zstd3! pack/import-car!))

(defn data [kind]
  (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191) (if (= kind :new) 73 0)) 256))
                   (range (if (= kind :large) 131085 4099)))))
(defn same-bytes? [a b] (java.util.Arrays/equals ^bytes a ^bytes b))
(defn demand [condition message details]
  (when-not condition (throw (ex-info message details))))

(defn child [script mode directory & args]
  (.start (doto (ProcessBuilder.
                 ^java.util.List
                 (into [(or (System/getenv "BABASHKA") "bb") "--classpath"
                        (cp/get-classpath) script mode directory] args))
            (.redirectErrorStream true))))
(defn finish [process]
  (try
    (demand (.waitFor process 15 java.util.concurrent.TimeUnit/SECONDS) "reader timeout" {})
    (let [text (slurp (.getInputStream process))]
      (demand (zero? (.exitValue process)) "fresh process refused" {:output text})
      (edn/read-string text))
    (finally (.destroyForcibly process)
             (.waitFor process 10 java.util.concurrent.TimeUnit/SECONDS))))

(defn durable-copy! [source target]
  (Files/createDirectory (Paths/get target (make-array String 0))
                         (into-array FileAttribute
                           [(PosixFilePermissions/asFileAttribute
                              (PosixFilePermissions/fromString "rwx------"))]))
  (let [files (filter #(re-matches #"(?:root-[01]|[0-9a-f]{64})\.edn|[0-9a-f]{64}\.(?:car|zpack)" (.getName %))
                      (.listFiles (io/file source)))]
    (doseq [file files]
      (demand (Files/isRegularFile (.toPath file) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
              "fixture must be a regular file" {})
      (Files/copy (.toPath file) (.toPath (io/file target (.getName file))) (make-array CopyOption 0)))
    {:copied (count files) :excluded-pending-and-lock true}))

(defn read-fresh [directory kind]
  (let [h (pack/recover directory)
        before (pack/summary h)
        original (data kind)
        payload (pack/read-data h "file")
        offset (if (= kind :large) 65530 30)
        expected-range (java.util.Arrays/copyOfRange original offset (+ offset 22))]
    (demand (same-bytes? original payload) "recovered payload differs" {:kind kind})
    (demand (same-bytes? expected-range (pack/read-range h "file" offset 22)) "range differs" {})
    (demand (and (= 0 (get-in before [:stats :cache-entries-before]))
                 (= 1 (get-in before [:stats :index-rebuilds]))
                 (= 1 (get-in before [:stats :index-cache-entries]))
                 (false? (:degraded? before))) "cache was not rebuilt" {:summary before})
    (assoc before :byte-equal true :range-equal true :fresh-process true)))

(defn write-paused [directory operation event role]
  (binding [store/*write-observer*
            (fn [e r]
              (when (= [e r] [event role])
                (prn {:ready true :event e :role r}) (flush)
                (Thread/sleep 30000)
                (throw (ex-info "parent failed to kill writer" {}))))]
    (case operation
      :put (put! directory "file" (data :new))
      :checkpoint (pack/checkpoint! directory)))
  (throw (ex-info "selected write boundary was not reached" {})))

(defn run-case [script output operation event role]
  (let [base (str (io/file output (str (name operation) "-" (name role) "-" (name event))))
        directory (str base "-writer")
        restored (str base "-empty-cache")]
    (store/init! directory)
    (put! directory "file" (data :old))
    (let [writer (child script "write" directory (name operation) (name event) (name role))]
      (try
        (with-open [out (io/reader (.getInputStream writer))]
          (let [text (deref (future (.readLine ^java.io.BufferedReader out)) 15000 nil)]
            (demand (and text (:ready (edn/read-string text))) "writer did not pause" {:output text})))
        (demand (= :writer-busy (try (pack/checkpoint! directory) nil
                                    (catch Exception e (:type (ex-data e)))))
                "writer lock was bypassed" {})
        (.destroyForcibly writer)
        (demand (.waitFor writer 10 java.util.concurrent.TimeUnit/SECONDS) "kill timed out" {})
        (demand (= 137 (.exitValue writer)) "writer was not force-killed" {:exit (.exitValue writer)})
        (let [copy (durable-copy! directory restored)
              published? (and (= :root role) (#{:renamed :dir-synced} event))
              kind (if (and (= :put operation) published?) :new :old)
              observed (finish (child script "read" restored (name kind)))
              expected-tail (if (and (= :put operation) published?) 2 1)
              expected-cp (if (and (= :checkpoint operation) published?) 1 0)]
          (demand (and (= expected-tail (get-in observed [:basis :tail]))
                       (= expected-cp (get-in observed [:basis :checkpoint])))
                  "publication boundary differs" {:observed observed})
          ;; Also exercise orphan reuse and prove process death released its lock.
          (put! directory "file" (data :new))
          (finish (child script "read" directory "new"))
          (prn {:operation operation :role role :event event :writer-exit 137
                :tail expected-tail :checkpoint expected-cp :concurrent-writer :denied
                :copy copy :recovery observed :retry true :pass true}))
        (finally (.destroyForcibly writer)
                 (.waitFor writer 10 java.util.concurrent.TimeUnit/SECONDS))))))

(defn cold-roundtrip [script output]
  (let [source (str (io/file output "multi-leaf-source"))
        target (str (io/file output "multi-leaf-empty-cache"))
        imported (str (io/file output "imported"))]
    (store/init! source)
    (put! source "file" (data :old))
    (pack/checkpoint! source)
    ;; Replay a replacement after the checkpoint. The old CAR is retained but
    ;; must not become the selected file or a recovered cache entry.
    (put! source "file" (data :large))
    (let [copy (durable-copy! source target)
          observed (finish (child script "read" target "large"))
          bytes (pack/export-car (pack/recover target) "file")]
      (demand (and (= 1 (get-in observed [:basis :checkpoint]))
                   (= 2 (get-in observed [:basis :tail]))) "checkpoint/WAL replay basis differs" {})
      (store/init! imported)
      (import! imported "file" bytes)
      (let [back (finish (child script "read" imported "large"))]
        (demand (= (:files observed) (:files back)) "CAR import changed identity" {})
        (demand (same-bytes? bytes (pack/export-car (pack/recover imported) "file"))
                "CAR import changed bytes" {}))
      ;; Export a synthetic fixture for the independent, one-off IPLD oracle.
      (with-open [out (io/output-stream (io/file output "multi-leaf.car"))] (.write out ^bytes bytes))
      (with-open [out (io/output-stream (io/file output "multi-leaf.bin"))] (.write out ^bytes (data :large)))
      (prn {:case :multi-leaf-checkpoint-import :copy copy :recovery observed :pass true}))))

(let [[mode directory operation event role] *command-line-args*]
  (case mode
    "write" (write-paused directory (keyword operation) (keyword event) (keyword role))
    "read" (prn (read-fresh directory (keyword operation)))
    "run" (try
            (demand (.mkdir (io/file directory)) "output must be new" {})
            (doseq [operation [:put :checkpoint]
                    role (if (= operation :put) [(if use-zstd3? :zpack :pack) :wal :root] [:snapshot :wal :root])
                    event [:half-written :written :file-synced :renamed :dir-synced]]
              (run-case *file* directory operation event role))
            (cold-roundtrip *file* directory)
            (prn {:crash-cases 30 :multi-leaf-roundtrip 1 :pass true})
            (finally (shutdown-agents)))
    (throw (ex-info "usage: pack_recovery_runner.clj run NEW_OUTPUT_DIRECTORY" {}))))
