;; Hosted Otehon v2 group proof. Uses real SIGKILL, not OS-cache loss.
(require '[clojure.edn :as edn] '[clojure.java.io :as io] '[babashka.classpath :as cp]
         '[otehon.forest :as forest] '[otehon.pack-store :as pack] '[otehon.storage :as store] '[awai.fs.car :as car])
(import '[java.nio.file Files Paths OpenOption LinkOption CopyOption] '[java.nio.file.attribute FileAttribute]
        '[java.security MessageDigest] '[java.util Random Arrays] '[java.util.concurrent TimeUnit])
(defn check! [v m] (when-not v (throw (ex-info m {}))))
(defn arr [v] (byte-array (map unchecked-byte v)))
(defn digest [v] (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") (if (bytes? v) v (arr v)))))
(defn paths [base n] (mapv #(str base "/fixtures/" % ".forest") (range n)))
(defn manifest [base n]
  (let [leaves (mapv #(first (:index (forest/verify-file %))) (paths base n))
        chunks (mapv (fn [i leaf] {"cid" {:tag 42 :bytes (:cid leaf)} "offset" (* i 1048576) "length" (:length leaf)}) (range) leaves)
        v (car/cbor-encode {"format" "awai.logical-file" "version" 1 "fileSize" (* n 1048576)
                            "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" 1048576} "chunks" chunks})]
    {:bytes (arr v) :cid (car/cid-str (car/cid-bytes car/codec-dag-cbor (digest v)))}))
(defn publish [base directory n]
  (let [m (manifest base n)]
    (pack/import-logical-forest-files! directory "proof" (paths base n) (:bytes m) (:cid m) {:file-backed? true})))
(defn spawn [script mode base directory & args]
  (.start (doto (ProcessBuilder. ^java.util.List (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) script mode base directory] args)) (.redirectErrorStream true))))
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
(defn writer [base directory event role]
  (binding [store/*write-observer* (fn [e r] (when (= [event role] [e r])
                                                (prn {:ready true :event e :role r}) (flush) (Thread/sleep 30000)))]
    (publish base directory 2))
  (throw (ex-info "boundary not reached" {})))
(defn verify [base directory expected]
  (let [h (pack/recover directory) n (if (= expected "old") 1 2)
        refs (get-in (pack/summary h) [:groups "proof" :packs])]
    (check! (= n (count refs)) "partial group")
    (check! (every? #(= :awai.otehon-store/pack-forest-file-v2 (:format %)) refs) "wrong format")
    (check! (= (:cid (manifest base n)) (get-in (pack/summary h) [:groups "proof" :manifest-cid])) "wrong logical root")
    (doseq [i (range n)]
      (let [expected (Files/readAllBytes (Paths/get (str base "/fixtures/" i ".raw") (make-array String 0)))
            actual (pack/read-group-range h "proof" (* i 1048576) 1048576)]
        (check! (Arrays/equals expected actual) "restored bytes differ")))
    {:expected expected :packs n :bytes-verified true :pass true}))
(defn run-case [script base event role]
  (let [case-name (str (name role) "-" (name event)) directory (str base "/" case-name) copy (str directory "-copy")]
    (store/init! directory) (publish base directory 1)
    (let [p (spawn script "writer" base directory (name event) (name role))]
      (try
        (with-open [r (io/reader (.getInputStream p))]
          (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 180000 nil)]
            (check! (and line (:ready (edn/read-string line))) "writer boundary missing")))
        (.destroyForcibly p) (check! (.waitFor p 10 TimeUnit/SECONDS) "kill timeout")
        (check! (= 137 (.exitValue p)) "writer was not killed")
        (copy-records directory copy)
        (let [expected (if (and (= role :root) (contains? #{:renamed :dir-synced} event)) "new" "old")]
          (finish (spawn script "verify" base copy expected))
          (publish base directory 2)
          (finish (spawn script "verify" base directory "new"))
          (prn {:event event :role role :recovered expected :retry true :pass true}))
        (finally (.destroyForcibly p))))))
(defn mutation-case [base]
  (let [local (str base "/mutation-input") directory (str base "/mutation-store")]
    (check! (.mkdir (io/file local)) "mutation input exists")
    (check! (.mkdir (io/file (str local "/fixtures"))) "mutation fixtures exist")
    (doseq [i (range 2) extension ["forest" "raw"]]
      (Files/copy (Paths/get (str base "/fixtures/" i "." extension) (make-array String 0))
                  (Paths/get (str local "/fixtures/" i "." extension) (make-array String 0))
                  (make-array CopyOption 0)))
    (store/init! directory) (publish local directory 1)
    (let [before (:root (store/read-store directory)) m (manifest local 2) changed (atom false)]
      (binding [store/*write-observer*
                (fn [event role]
                  (when (and (= [event role] [:reused-dir-synced :forest])
                             (compare-and-set! changed false true))
                    (with-open [f (java.io.RandomAccessFile. (str local "/fixtures/1.forest") "rw")]
                      (.seek f 100) (let [old (.read f)] (.seek f 100) (.write f (bit-xor old 1))))))]
        (check! (try (pack/import-logical-forest-files! directory "proof" (paths local 2) (:bytes m) (:cid m) {:file-backed? true})
                     false (catch Exception e (= :forest-changed (:type (ex-data e)))))
                "changed file accepted"))
      (check! @changed "mutation was not injected")
      (check! (= before (:root (store/read-store directory))) "changed source published root")
      (check! (:pass (verify base directory "old")) "old group unavailable")
      (prn {:same-size-source-change :rejected :root-unchanged true :pass true}))))
(let [[mode base directory a b] *command-line-args*]
  (case mode
    "generate" (let [_ (check! (.mkdir (io/file base)) "output exists")
                     _ (check! (.mkdir (io/file (str base "/fixtures"))) "fixtures exist")
                     rng (Random. 532174)]
                 (doseq [i (range 2)]
                   (let [raw (byte-array 1048576) _ (.nextBytes rng raw)
                         v (mapv #(bit-and 255 %) raw)
                         pack (:car (car/assemble-pack [{:bytes v :digest (digest raw)}] digest))
                         end (first (car/decode-u64-le pack 43))]
                     (Files/write (Paths/get (str base "/fixtures/" i ".raw") (make-array String 0)) raw (make-array OpenOption 0))
                     (Files/write (Paths/get (str base "/fixtures/" i ".car") (make-array String 0)) (arr (subvec pack 51 end)) (make-array OpenOption 0))))
                 (prn {:generated 2 :leaf-bytes 1048576}))
    "writer" (writer base directory (keyword a) (keyword b))
    "verify" (prn (verify base directory a))
    "mutation" (mutation-case base)
    "run" (try
            (doseq [[event role] [[:half-written :forest] [:renamed :forest]
                                  [:half-written :wal] [:renamed :wal] [:half-written :root]
                                  [:renamed :root] [:dir-synced :root]]]
              (run-case *file* base event role))
            (mutation-case base)
            (prn {:cases 7 :real-process-kill true :pass true})
            (finally (shutdown-agents)))
    (throw (ex-info "unknown mode" {:mode mode}))))
