;; Hosted Otehon writer process-kill proof, not OS-cache or power-loss proof.
(require '[clojure.edn :as edn] '[clojure.string :as str] '[clojure.java.io :as io]
         '[babashka.classpath :as cp] '[awai.fs.car :as car] '[otehon.forest :as forest]
         '[otehon.forest-writer :as writer] '[otehon.ipld-forest :as catalog] '[otehon.storage :as store])
(import '[java.nio.file Files Paths LinkOption CopyOption] '[java.nio.file.attribute FileAttribute]
        '[java.util.concurrent TimeUnit])
(def helper (slurp "nixos/otehon/storage/test/otehon/ipld_forest_writer_proof.clj"))
(def stop (str/index-of helper "(let [[mode base tool]"))
(when-not stop (throw (ex-info "proof helpers not found" {})))
(load-string (subs helper 0 stop))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "FOREST_TOOL required" {}))))
(defn spawn [mode directory & args]
  (.start (doto (ProcessBuilder. ^java.util.List
                     (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath)
                            *file* mode directory] args)) (.redirectErrorStream true))))
(defn finish [p]
  (try (check! (.waitFor p 180 TimeUnit/SECONDS) "child timed out")
       (let [out (slurp (.getInputStream p))]
         (when-not (zero? (.exitValue p)) (throw (ex-info "child failed" {:output out})))
         (edn/read-string out))
       (finally (.destroyForcibly p))))
(defn copy-records [from to]
  (Files/createDirectory (Paths/get to (make-array String 0)) (make-array FileAttribute 0))
  (doseq [f (.listFiles (io/file from))
          :when (re-matches #"(?:root-[01]|[0-9a-f]{64})\.edn|[0-9a-f]{64}\.forest" (.getName f))]
    (check! (Files/isRegularFile (.toPath f) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])) "nonregular record")
    (Files/copy (.toPath f) (.toPath (io/file to (.getName f))) (make-array CopyOption 0))))
(defn publish [dir staging] (writer/put-ipld-blocks! dir "graph" basis (blocks) staging tool))
(defn writer-child [dir event role occurrence]
  (let [seen (atom 0)]
    (binding [store/*write-observer* (fn [e r]
             (when (and (= [event role] [e r]) (= occurrence (swap! seen inc)))
               (prn {:ready true}) (flush) (Thread/sleep 30000)))]
      (publish dir (str dir "-child-stage"))))
  (throw (ex-info "boundary not reached" {})))
(defn verify [dir expected]
  (let [h (catalog/recover-group dir "graph") bs (blocks)
        selected (if (= expected "old") (into (subvec bs 0 9) (subvec bs 11)) bs)
        archives (if (= expected "old") 1 2)]
    (check! (= basis (get-in h [:group :basis-cid])) "basis mismatch")
    (check! (= archives (count (get-in h [:group :archives]))) "partial group")
    (doseq [{:keys [cid bytes]} selected]
      (check! (java.util.Arrays/equals ^bytes bytes ^bytes (catalog/get-group-block h cid)) "block mismatch"))
    {:expected expected :archives archives :blocks (count selected) :pass true}))
(defn run-case [base event role occurrence]
  (let [label (str (name role) "-" (name event)) dir (str base "/" label) copy (str dir "-copy")
        bytes (Files/readAllBytes (Paths/get fixture (make-array String 0)))]
    (store/init! dir)
    (catalog/publish-group! dir "graph" basis [{:root-cid basis :bytes bytes}])
    (let [p (spawn "writer" dir (name event) (name role) (str occurrence))]
      (try
        (with-open [r (io/reader (.getInputStream p))]
          (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 180000 nil)]
            (check! (and line (:ready (edn/read-string line))) "writer boundary missing")))
        (.destroyForcibly p)
        (check! (.waitFor p 10 TimeUnit/SECONDS) "kill timeout")
        (check! (not (zero? (.exitValue p))) "writer not terminated")
        (copy-records dir copy)
        (let [expected (if (and (= role :root) (= event :renamed)) "new" "old")]
          (finish (spawn "verify" copy expected))
          (publish dir (str dir "-retry-stage"))
          (finish (spawn "verify" dir "new"))
          (prn {:event event :role role :recovered expected :retry true :pass true}))
        (finally (.destroyForcibly p))))))
(let [[mode dir a b c] *command-line-args*]
  (case mode
    "writer" (writer-child dir (keyword a) (keyword b) (Long/parseLong c))
    "verify" (prn (verify dir a))
    "run" (try
            (check! (.mkdir (io/file dir)) "output exists")
            (doseq [[event role occurrence] [[:half-written :forest 2] [:half-written :root 1] [:renamed :root 1]]]
              (run-case dir event role occurrence))
            (prn {:cases 3 :real-process-kill true :actual-writer true :pass true})
            (finally (shutdown-agents)))
    (throw (ex-info "unknown mode" {:mode mode}))))
