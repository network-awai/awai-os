;; Hosted process-kill proof for group/ref/nonce in one WAL frame; not power loss.
(require '[clojure.edn :as edn] '[clojure.java.io :as io] '[babashka.classpath :as cp]
         '[otehon.ipld-forest :as catalog] '[otehon.kotobase-ref :as refs]
         '[otehon.storage :as store] '[kotobase.storage.core :as contract])
(import '[java.nio.file Files Paths LinkOption CopyOption] '[java.nio.file.attribute FileAttribute]
        '[java.util.concurrent TimeUnit])
(def large-path (System/getenv "ATOMIC_LARGE_FOREST"))
(def roots [(if large-path "bafkreigp5rn4uqshssw3l36zq7mbvs47omqaqjsd3vl7bcd6wldn2uumlq"
               "bafyreia5f47e462gm43mxscjphe4n6wyi56ccevdmwq526i4jcjuuphala")
            "bafyreidb7f6i335vyhbordfkte377frwmtq5axfpd44gpvxodjor643mhy"])
(def fixture (or (System/getenv "IPLD_SPLIT_FIXTURES") "nixos/otehon/storage/test/fixtures/prolly-forest/split"))
(def entries (mapv (fn [i cid] {:root-cid cid :path (if (and large-path (zero? i)) large-path (str fixture "/" i ".forest"))}) (range 2) roots))
(def nonce-ref (str "nonce/v1/" (first roots)))
(def nonce {:ref-name nonce-ref :marker-cid (second roots)})
(defn check! [v message] (when-not v (throw (ex-info message {}))))
(defn publish-to [directory ref-name]
 (let [gen (get-in (store/read-store directory) [:root :generation])]
  (catalog/publish-file-group-and-ref! directory "graph" (first roots) entries gen ref-name nil (first roots)
   (fn [get-block target] (and (= target (first roots)) (every? #(some? (get-block %)) roots))) nonce)))
(defn publish [directory] (publish-to directory "db"))
(defn spawn [mode directory & args]
 (.start (doto (ProcessBuilder. ^java.util.List
                  (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) *file* mode directory] args))
           (.redirectErrorStream true))))
(defn finish [p]
 (try (check! (.waitFor p 180 TimeUnit/SECONDS) "child timeout")
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
  (binding [store/*write-observer* (fn [e r] (when (and (= [e r] [event role]) (= occurrence (swap! seen inc)))
                                               (prn {:ready true :event e :role r}) (flush) (Thread/sleep 30000)))]
   (publish directory)))
 (throw (ex-info "boundary not reached" {})))
(defn verify [directory expected]
 (let [s (store/read-store directory) ref (contract/-read-ref (refs/open-ref-store directory) "db")
       consumed (contract/-read-ref (refs/open-ref-store directory) nonce-ref)
       group (get (:state s) "awai.ipld-forest-group/graph")]
  (if (= expected "old")
   (do (check! (nil? group) "group unexpectedly visible") (check! (nil? ref) "ref unexpectedly visible")
       (check! (nil? consumed) "nonce unexpectedly visible"))
   (do (check! (= (first roots) (:cid ref)) "ref missing or incorrect")
       (check! (= (second roots) (:cid consumed)) "nonce missing or incorrect")
       (let [h (catalog/recover-group directory "graph")]
        (check! (= 2 (count (get-in h [:group :archives]))) "partial archive group")
        (doseq [cid roots] (check! (some? (catalog/get-group-block h cid)) "archive root missing")))))
  {:expected expected :pass true}))
(defn run-case [base event role occurrence]
 (let [label (str (name role) "-" (name event)) dir (str base "/" label) copy (str dir "-copy")]
  (store/init! dir)
  (let [p (spawn "writer" dir (name event) (name role) (str occurrence))]
   (try (with-open [r (io/reader (.getInputStream p))]
          (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 180000 nil)]
           (check! (and line (:ready (edn/read-string line))) "writer boundary missing")))
        (.destroyForcibly p)
        (check! (.waitFor p 10 TimeUnit/SECONDS) "kill timeout")
        (check! (not (zero? (.exitValue p))) "writer was not killed")
        (copy-records dir copy)
        (let [expected (if (and (= role :root) (contains? #{:renamed :dir-synced} event)) "new" "old")]
         (finish (spawn "verify" copy expected))
         (if (= expected "old")
           (do (check! (true? (:published? (publish copy))) "retry failed")
               (verify copy "new"))
           (let [before (store/read-store copy)
                 reason (try (publish-to copy "db2") nil (catch Exception e (:type (ex-data e))))]
             (check! (= :nonce-replayed reason) "nonce replay accepted")
             (check! (= before (store/read-store copy)) "nonce replay changed root")
             (check! (nil? (contract/-read-ref (refs/open-ref-store copy) "db2")) "replay published ref")))
         (prn {:event event :role role :recovered expected :pass true}))
        (finally (.destroyForcibly p))))))
(let [[mode directory a b c] *command-line-args*]
 (case mode
  "writer" (writer directory (keyword a) (keyword b) (Long/parseLong c))
  "verify" (prn (verify directory a))
  "run" (try (check! (.mkdir (io/file directory)) "fresh output required")
             (doseq [[event role occurrence] [[:half-written :forest 2] [:renamed :forest 2]
                                             [:half-written :wal 1] [:renamed :wal 1]
                                             [:half-written :root 1] [:renamed :root 1] [:dir-synced :root 1]]]
              (run-case directory event role occurrence))
             (prn {:cases 7 :real-process-kill true :pass true})
             (finally (shutdown-agents)))
  (throw (ex-info "unknown mode" {:mode mode}))))
