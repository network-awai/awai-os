;; Experiment: publish four prevalidated Forest objects before ONE WAL/root update.
;; Harness-only group metadata; not a production multi-pack writer or filesystem.
(require '[clojure.edn :as edn] '[clojure.java.io :as io]
         '[babashka.classpath :as cp] '[otehon.forest :as forest]
         '[otehon.segmented :as segmented] '[otehon.storage :as store])
(import '[java.nio.file Files Paths CopyOption LinkOption]
        '[java.nio.file.attribute FileAttribute])
(def fixture-dir (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack"))
(defn ensure! [v msg] (when-not v (throw (ex-info msg {}))))
(defn fixtures [] (mapv #(Files/readAllBytes (Paths/get (str fixture-dir "/part-" % ".forest.car.zst") (make-array String 0))) (range 4)))
(defn group-value [files]
  (pr-str {:format :proof/forest-group-v1 :objects (mapv segmented/sha files)}))
(defn spawn [script mode dir & args]
  (.start (doto (ProcessBuilder. ^java.util.List (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) script mode dir] args)) (.redirectErrorStream true))))
(defn finish [p]
  (try (ensure! (.waitFor p 90 java.util.concurrent.TimeUnit/SECONDS) "reader timeout")
       (let [s (slurp (.getInputStream p))]
         (when-not (zero? (.exitValue p)) (throw (ex-info "reader failed" {:output s})))
         (edn/read-string s))
       (finally (.destroyForcibly p))))
(defn copy-records [source target]
  (Files/createDirectory (Paths/get target (make-array String 0)) (make-array FileAttribute 0))
  (doseq [f (.listFiles (io/file source))
          :when (re-matches #"(?:root-[01]|[0-9a-f]{64})\.edn|[0-9a-f]{64}\.forest" (.getName f))]
    (ensure! (Files/isRegularFile (.toPath f) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])) "nonregular record")
    (Files/copy (.toPath f) (.toPath (io/file target (.getName f))) (make-array CopyOption 0))))
(defn publish [dir files]
  ;; Validate before admission, then persist every object while the single
  ;; writer lock is held, before atomically publishing the one metadata key.
  (doseq [f files] (forest/open f))
  (let [value (group-value files) refs (:objects (edn/read-string value))]
    (store/transact! dir :put {:key "proof/atomic-group" :value value}
      (fn [directory _]
        (doseq [[b expected] (map vector files refs)]
          (ensure! (= expected (store/write-forest! directory b)) "published digest mismatch"))))))
(defn writer [dir event role occurrence]
  (let [n (atom 0) files (fixtures)]
    (binding [store/*write-observer*
              (fn [e r] (when (= [e r] [event role])
                          (when (= (swap! n inc) occurrence)
                            (prn {:ready true :event e :role r :occurrence occurrence}) (flush)
                            (Thread/sleep 30000))))]
      (publish dir files))
    (throw (ex-info "kill boundary not reached" {}))))
(defn read-state [dir expected]
  (let [value (get-in (store/read-store dir) [:state "proof/atomic-group"])]
    (if (= expected "old")
      (ensure! (= "old" value) "old root was not retained")
      (let [{:keys [format objects]} (edn/read-string value)]
        (ensure! (and (= format :proof/forest-group-v1) (= objects (mapv segmented/sha (fixtures)))) "incomplete or changed group")
        (doseq [id objects] (forest/open (store/read-forest dir id)))))
    {:expected expected :all-packs-verified (= expected "new") :pass true}))
(defn run-case [script output role event occurrence]
  (let [case-name (str (name role) "-" (name event) "-" occurrence)
        dir (str output "/" case-name) cold (str dir "-cold")]
    (store/init! dir)
    (store/transact! dir :put {:key "proof/atomic-group" :value "old"})
    (let [p (spawn script "write" dir (name event) (name role) (str occurrence))]
      (try
        (with-open [r (io/reader (.getInputStream p))]
          (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 25000 nil)]
            (ensure! (and line (:ready (edn/read-string line))) "writer did not reach boundary")))
        (.destroyForcibly p)
        (ensure! (.waitFor p 10 java.util.concurrent.TimeUnit/SECONDS) "writer termination timeout")
        (ensure! (= 137 (.exitValue p)) "writer not killed")
        (copy-records dir cold)
        (let [expected (if (and (= role :root) (#{:renamed :dir-synced} event)) "new" "old")]
          (finish (spawn script "read" cold expected))
          ;; Retry also exercises orphan reuse and lock release.
          (publish dir (fixtures))
          (finish (spawn script "read" dir "new"))
          (prn {:role role :event event :occurrence occurrence :cold expected :retry true :pass true}))
        (finally (.destroyForcibly p))))))
(let [[mode dir a b c] *command-line-args*]
  (case mode
    "write" (writer dir (keyword a) (keyword b) (Long/parseLong c))
    "read" (prn (read-state dir a))
    "run" (try
            (ensure! (.mkdir (io/file dir)) "output must be new")
            (doseq [[role event occurrence] [[:forest :half-written 1] [:forest :renamed 3]
                                              [:forest :dir-synced 4] [:wal :half-written 1]
                                              [:wal :renamed 1] [:root :half-written 1]
                                              [:root :renamed 1] [:root :dir-synced 1]]]
              (run-case *file* dir role event occurrence))
            (prn {:cases 8 :pass true})
            (finally (shutdown-agents)))
    (throw (ex-info "use run, read or write" {}))))
