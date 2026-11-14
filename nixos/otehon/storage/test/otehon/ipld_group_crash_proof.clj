;; Hosted Otehon real process termination proof; not OS-cache or power loss.
(require '[clojure.edn :as edn] '[clojure.java.io :as io] '[babashka.classpath :as cp]
         '[awai.fs.car :as car] '[otehon.forest :as forest]
         '[otehon.ipld-forest :as catalog] '[otehon.storage :as store])
(import '[java.nio.file Files Paths LinkOption CopyOption] '[java.nio.file.attribute FileAttribute]
        '[java.util.concurrent TimeUnit])
(def basis "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri")
(def roots ["bafyreia5f47e462gm43mxscjphe4n6wyi56ccevdmwq526i4jcjuuphala"
            "bafyreidb7f6i335vyhbordfkte377frwmtq5axfpd44gpvxodjor643mhy"])
(def full-path (or (System/getenv "IPLD_POLICY_FIXTURE") "nixos/otehon/storage/test/fixtures/prolly-forest/policy.forest"))
(def split-path (or (System/getenv "IPLD_SPLIT_FIXTURES") "nixos/otehon/storage/test/fixtures/prolly-forest/split"))
(defn check! [v message] (when-not v (throw (ex-info message {}))))
(defn read-bytes [path] (Files/readAllBytes (Paths/get path (make-array String 0))))
(defn parts [] (mapv (fn [i r] {:root-cid r :bytes (read-bytes (str split-path "/" i ".forest"))}) (range 2) roots))
(defn old [] [{:root-cid basis :bytes (read-bytes full-path)}])
(defn publish [directory entries] (catalog/publish-group! directory "graph" basis entries))
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
    (check! (Files/isRegularFile (.toPath f) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])) "nonregular object")
    (Files/copy (.toPath f) (.toPath (io/file to (.getName f))) (make-array CopyOption 0))))
(defn writer [directory event role occurrence]
  (let [seen (atom 0)]
    (binding [store/*write-observer* (fn [e r]
                                       (when (and (= [e r] [event role]) (= occurrence (swap! seen inc)))
                                         (prn {:ready true :event e :role r :occurrence occurrence})
                                         (flush) (Thread/sleep 30000)))]
      (publish directory (parts))))
  (throw (ex-info "boundary not reached" {})))
(defn verify [directory expected]
  (let [h (catalog/recover-group directory "graph")
        blocks (:blocks (car/carv1-decode (:carv1 (forest/open (read-bytes full-path)))))
        count-expected (if (= expected "old") 1 2)]
    (check! (= count-expected (count (get-in h [:group :archives]))) "partial group")
    (check! (= basis (get-in h [:group :basis-cid])) "basis mismatch")
    (doseq [{:keys [cid bytes]} blocks]
      (check! (= bytes (mapv #(bit-and 255 %) (catalog/get-group-block h (car/cid-str cid)))) "block mismatch"))
    {:expected expected :archives count-expected :blocks (count blocks) :pass true}))
(defn run-case [base event role occurrence]
  (let [label (str (name role) "-" (name event)) dir (str base "/" label) copy (str dir "-copy")]
    (store/init! dir) (publish dir (old))
    (let [p (spawn "writer" dir (name event) (name role) (str occurrence))]
      (try
        (with-open [r (io/reader (.getInputStream p))]
          (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 180000 nil)]
            (check! (and line (:ready (edn/read-string line))) "writer boundary missing")))
        (.destroyForcibly p)
        (check! (.waitFor p 10 TimeUnit/SECONDS) "kill timeout")
        (check! (not (zero? (.exitValue p))) "writer not terminated")
        (copy-records dir copy)
        (let [expected (if (and (= role :root) (contains? #{:renamed :dir-synced} event)) "new" "old")]
          (finish (spawn "verify" copy expected))
          (publish dir (parts))
          (finish (spawn "verify" dir "new"))
          (prn {:event event :role role :recovered expected :retry true :pass true}))
        (finally (.destroyForcibly p))))))
(let [[mode directory a b c] *command-line-args*]
  (case mode
    "writer" (writer directory (keyword a) (keyword b) (Long/parseLong c))
    "verify" (prn (verify directory a))
    "run" (try
            (check! (.mkdir (io/file directory)) "output exists")
            (doseq [[event role occurrence] [[:half-written :forest 2] [:renamed :forest 2]
                                            [:half-written :wal 1] [:renamed :wal 1]
                                            [:half-written :root 1] [:renamed :root 1] [:dir-synced :root 1]]]
              (run-case directory event role occurrence))
            (prn {:cases 7 :real-process-kill true :pass true})
            (finally (shutdown-agents)))
    (throw (ex-info "unknown mode" {:mode mode}))))
