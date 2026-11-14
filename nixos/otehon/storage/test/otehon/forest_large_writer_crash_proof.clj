;; Otehon full writer SIGKILL proof. Not OS-cache-loss or power-failure evidence.
(require '[clojure.edn :as edn] '[clojure.java.io :as io] '[babashka.classpath :as cp]
         '[otehon.storage :as store] '[otehon.pack-store :as pack] '[otehon.forest-writer :as writer])
(import '[java.nio.file Files Paths OpenOption CopyOption LinkOption StandardOpenOption]
        '[java.nio.file.attribute FileAttribute] '[java.security MessageDigest]
        '[java.util Random HexFormat] '[java.util.concurrent TimeUnit])
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn spawn [mode base directory & args]
 (.start (doto (ProcessBuilder. ^java.util.List (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) *file* mode base directory] args)) (.redirectErrorStream true))))
(defn finish [p]
 (try (check! (.waitFor p 180 TimeUnit/SECONDS) "child timeout")
      (let [output (slurp (.getInputStream p))]
       (when-not (zero? (.exitValue p)) (throw (ex-info "child failed" {:output output}))) (edn/read-string output))
      (finally (.destroyForcibly p))))
(defn copy-records [from to]
 (Files/createDirectory (Paths/get to (make-array String 0)) (make-array FileAttribute 0))
 (doseq [f (.listFiles (io/file from))
         :when (re-matches #"(?:root-[01]|[0-9a-f]{64})\.edn|[0-9a-f]{64}\.forest" (.getName f))]
  (check! (Files/isRegularFile (.toPath f) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])) "nonregular record")
  (Files/copy (.toPath f) (.toPath (io/file to (.getName f))) (make-array CopyOption 0))))
(defn verify [base directory expected]
 (let [h (pack/recover directory) input (str base "/" expected) n (if (= expected "old") 1 17)
       refs (get-in (pack/summary h) [:groups "file" :packs]) md (MessageDigest/getInstance "SHA-256")]
  (check! (= (if (= expected "old") 1 2) (count refs)) "partial pack group")
  (dotimes [i n] (.update md ^bytes (pack/read-group-range h "file" (* i 1048576) 1048576)))
  (check! (= (:sha (store/forest-source-digest input)) (.formatHex (HexFormat/of) (.digest md))) "full file differs")
  {:expected expected :packs (count refs) :bytes (* n 1048576) :pass true}))
(defn writer-child [base directory event role tool occurrence]
 (let [seen (atom 0)]
 (binding [store/*write-observer* (fn [e r] (when (and (= [event role] [e r]) (= occurrence (swap! seen inc)))
                                               (prn {:ready true :event e :role r}) (flush) (Thread/sleep 300000)))]
  (writer/put-file-large! directory "file" (str base "/new") (str directory "-new-stage") tool))
 (throw (ex-info "boundary not reached" {}))))
(defn run-case [base tool event role occurrence]
 (let [case-name (str (name role) "-" (name event) "-" occurrence) directory (str base "/" case-name) copy (str directory "-copy")]
  (store/init! directory)
  (writer/put-file-large! directory "file" (str base "/old") (str directory "-old-stage") tool)
  (let [p (spawn "writer" base directory (name event) (name role) tool (str occurrence))]
   (try
    (with-open [r (io/reader (.getInputStream p))]
     (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 180000 nil)]
      (check! (and line (:ready (edn/read-string line))) "writer boundary missing")))
    (.destroyForcibly p) (check! (.waitFor p 10 TimeUnit/SECONDS) "kill timeout")
    (check! (= 137 (.exitValue p)) "writer not killed")
    (copy-records directory copy)
    (let [expected (if (and (= role :root) (contains? #{:renamed :dir-synced} event)) "new" "old")
          got (finish (spawn "verify" base copy expected))]
     (check! (:pass got) "readback failed")
     (when (and (= role :forest) (= occurrence 2))
      (writer/put-file-large! directory "file" (str base "/new") (str directory "-retry-stage") tool)
      (check! (:pass (finish (spawn "verify" base directory "new"))) "retry readback failed"))
     (prn {:event event :role role :occurrence occurrence :recovered expected :verified-bytes (:bytes got) :retry (and (= role :forest) (= occurrence 2)) :pass true}))
    (finally (.destroyForcibly p))))))
(let [[mode base directory a b c d] *command-line-args*]
 (case mode
  "run" (try
    (check! (.mkdir (io/file base)) "output exists")
    (let [random (Random. 532) b (byte-array 1048576)]
     (doseq [[name count] [["old" 1] ["new" 17]]]
      (with-open [out (Files/newOutputStream (Paths/get (str base "/" name) (make-array String 0)) (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
       (dotimes [_ count] (.nextBytes random b) (.write out b)))))
    (doseq [[event role occurrence] [[:half-written :forest 1] [:half-written :forest 2] [:half-written :wal 1] [:renamed :wal 1] [:half-written :root 1] [:renamed :root 1] [:dir-synced :root 1]]]
     (run-case base directory event role occurrence))
    (prn {:cases 7 :real-product-writer true :sigkill true :pass true})
    (finally (shutdown-agents)))
  "writer" (writer-child base directory (keyword a) (keyword b) c (Long/parseLong d))
  "verify" (prn (verify base directory a))
  (throw (ex-info "unknown mode" {:mode mode}))))
