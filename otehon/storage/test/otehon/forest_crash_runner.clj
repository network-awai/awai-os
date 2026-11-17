;; Process-kill tests for the bounded Forest publication path.
(require '[clojure.edn :as edn] '[clojure.java.io :as io]
         '[babashka.classpath :as cp] '[otehon.storage :as store]
         '[otehon.pack-store :as pack])
(import '[java.nio.file Files Paths CopyOption LinkOption] '[java.util Arrays]
        '[java.nio.file.attribute FileAttribute])
(defn demand [v msg] (when-not v (throw (ex-info msg {}))))
(defn fixture [] (Files/readAllBytes (Paths/get (System/getenv "FOREST_FIXTURE") (make-array String 0))))
(defn child [script mode dir & args]
  (.start (doto (ProcessBuilder. ^java.util.List (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) script mode dir] args))
            (.redirectErrorStream true))))
(defn finish [p]
  (try (demand (.waitFor p 20 java.util.concurrent.TimeUnit/SECONDS) "child timeout")
       (let [s (slurp (.getInputStream p))]
         (when-not (zero? (.exitValue p)) (throw (ex-info "child failed" {:output s})))
         (edn/read-string s))
       (finally (.destroyForcibly p))))
(defn copy-records [source target]
  (Files/createDirectory (Paths/get target (make-array String 0)) (make-array FileAttribute 0))
  (doseq [f (.listFiles (io/file source))
          :when (re-matches #"(?:root-[01]|[0-9a-f]{64})\.edn|[0-9a-f]{64}\.(?:car|zpack|forest)" (.getName f))]
    (demand (Files/isRegularFile (.toPath f) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])) "nonregular record")
    (Files/copy (.toPath f) (.toPath (io/file target (.getName f))) (make-array CopyOption 0))))
(defn child-write [dir event role]
  (binding [store/*write-observer* (fn [e r] (when (= [e r] [event role])
                                               (prn {:ready true}) (flush) (Thread/sleep 30000)))]
    (pack/import-forest-direct! dir "file" (fixture)))
  (throw (ex-info "boundary not reached" {})))
(defn child-read [dir expected]
  (let [h (pack/recover dir) result (pack/read-data h "file")
        data (if (= expected "new")
               (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range 140000)))
               (.getBytes "old" "UTF-8"))]
    (demand (Arrays/equals result data) "recovered bytes differ")
    (demand (zero? (get-in (pack/summary h) [:stats :cache-entries-before])) "cache not empty")
    (when (= expected "new")
      (demand (Arrays/equals (Arrays/copyOfRange data 65530 65552)
                             (pack/read-range-verified-leaves h "file" 65530 22)) "range differs"))
    {:pass true :fresh-process true :expected expected}))
(defn run-case [script output event role]
  (let [dir (str output "/" (name role) "-" (name event)) restored (str dir "-cold")]
    (store/init! dir)
    (pack/put-data! dir "file" (.getBytes "old" "UTF-8"))
    (let [p (child script "write" dir (name event) (name role))]
      (try
        (with-open [r (io/reader (.getInputStream p))]
          (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 20000 nil)]
            (demand (and line (:ready (edn/read-string line))) "writer did not pause")))
        (.destroyForcibly p)
        (demand (.waitFor p 10 java.util.concurrent.TimeUnit/SECONDS) "writer kill timeout")
        (demand (= 137 (.exitValue p)) "writer did not exit 137")
        (copy-records dir restored)
        (let [expected (if (and (= role :root) (#{:renamed :dir-synced} event)) "new" "old")]
          (finish (child script "read" restored expected))
          (pack/import-forest-direct! dir "file" (fixture))
          (finish (child script "read" dir "new"))
          (prn {:event event :role role :expected expected :retry true :pass true}))
        (finally (.destroyForcibly p))))))
(let [[mode dir event role] *command-line-args*]
  (case mode
    "write" (child-write dir (keyword event) (keyword role))
    "read" (prn (child-read dir event))
    "run" (try
            (demand (.mkdir (io/file dir)) "new output directory required")
            (doseq [r [:forest :wal :root] e [:half-written :written :file-synced :renamed :dir-synced]]
              (run-case *file* dir e r))
            (prn {:cases 15 :pass true})
            (finally (shutdown-agents)))
    (throw (ex-info "expected run, read or write" {}))))
