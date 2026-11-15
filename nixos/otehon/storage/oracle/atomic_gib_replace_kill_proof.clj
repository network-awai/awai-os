;; Actual hosted atomic GiB writer: replace a nonempty root and SIGKILL at publication boundaries.
(require '[clojure.edn :as edn] '[clojure.java.io :as io] '[clojure.string :as str]
         '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.pack-store :as pack]
         '[otehon.atomic-forest-stream :as stream] '[otehon.kotobase-forest-blocks :as fb]
         '[otehon.kotobase-ref :as refs] '[kotobase.storage.core :as storage])
(import '[java.security MessageDigest] '[java.util Arrays HexFormat] '[java.util.concurrent TimeUnit])
(def manifest-cid "bafyreidk3dxbsrqaocvdhfr624j4n75v6ddgmyfgkyu24z3lirlg5aj4g4")
(def expected-sha "1f7e0c0d3fefe5579e556a04f7796b7de01278916e49a6d31df864e16adf1708")
(defn check! [x msg] (when-not x (throw (ex-info msg {}))))
(defn old-block [] (let [b (.getBytes "previous-published-content" "UTF-8") d (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
                     {:cid (car/cid-str (car/cid-bytes car/codec-raw d)) :bytes b}))
(defn chunks [manifest] (let [m (first (car/cbor-decode (mapv #(bit-and 255 %) manifest) 0)) c (get m "chunks")]
                         (check! (= 1073741824 (get m "fileSize")) "wrong size") (check! (= 1024 (count c)) "wrong chunks") c))
(defn verify-file! [get-block]
 (let [m (or (get-block manifest-cid) (throw (ex-info "missing manifest" {}))) md (MessageDigest/getInstance "SHA-256")]
  (doseq [c (chunks m)] (let [b (or (get-block (car/cid-str (get-in c ["cid" :bytes]))) (throw (ex-info "missing chunk" {})))]
                         (check! (= (get c "length") (alength ^bytes b)) "length mismatch") (.update md ^bytes b)))
  (check! (= expected-sha (.formatHex (HexFormat/of) (.digest md))) "digest mismatch") true))
(defn writer [base event role tool]
 (let [dir (str base "/store") old (old-block) src (or (System/getenv "GIB_SOURCE") (throw (ex-info "source required" {})))
       view (pack/logical-block-view (pack/recover (str src "/store")) "gib" manifest-cid) source (:get-block view)
       manifest (source manifest-cid) seen (atom 0)]
  (check! (.mkdir (io/file base)) "fresh case required") (store/init! dir)
  (stream/publish! dir (str base "/old-stage") tool "db" nil (constantly nil)
   (fn [p] ((:put! p) (:cid old) (:bytes old)) {:target (:cid old) :value (:cid old)})
   (fn [get-block cid] (and (= cid (:cid old)) (Arrays/equals ^bytes (:bytes old) ^bytes (get-block cid)))))
  (binding [store/*write-observer* (fn [e r] (when (and (= [e r] [event role]) (= 1 (swap! seen inc)))
                                               (prn {:ready true :event e :role r}) (flush) (Thread/sleep 30000)))]
   (stream/publish! dir (str base "/stage") tool "db" (:cid old) (constantly nil)
    (fn [p] (doseq [c (chunks manifest)] (let [cid (car/cid-str (get-in c ["cid" :bytes]))] ((:put! p) cid (source cid))))
      ((:put! p) manifest-cid manifest) {:target manifest-cid :value manifest-cid})
    (fn [get-block cid] (and (= cid manifest-cid) (verify-file! get-block)))))
 (throw (ex-info "boundary not reached" {}))))
(defn verify-case [base expected]
 (let [dir (str base "/store") s (store/read-store dir) ref (storage/-read-ref (refs/open-ref-store dir) "db")
       groups (filter #(str/starts-with? % "awai.ipld-forest-group/") (keys (:state s))) old (old-block)
       db (fb/open-backend dir (str base "/unused") "/absent-writer")]
  (check! (Arrays/equals ^bytes (:bytes old) ^bytes (storage/get-block db (:cid old))) "previous block lost")
  (if (= expected "old")
   (do (check! (= (:cid old) (:cid ref)) "old ref changed") (check! (= 1 (count groups)) "partial group visible"))
   (do (check! (= manifest-cid (:cid ref)) "new ref missing") (check! (= 2 (count groups)) "new group missing")
       (check! (verify-file! #(storage/get-block db %)) "new file invalid")))
  (prn {:expected expected :previous-block :verified :pass true})))
(defn spawn [& args] (.start (doto (ProcessBuilder. ^java.util.List (into [(str (System/getProperty "java.home") "/bin/java") "-Xmx768m" "-cp" (System/getProperty "java.class.path") "clojure.main" *file*] args)) (.redirectErrorStream true))))
(defn run-case [base tool event role]
 (let [dir (str base "/" (name role) "-" (name event)) p (spawn "writer" dir (name event) (name role) tool)]
  (try (let [r (io/reader (.getInputStream p)) line (deref (future (.readLine ^java.io.BufferedReader r)) 300000 nil)]
         (check! (and line (:ready (edn/read-string line))) "writer boundary missing")
         (.destroyForcibly p) (check! (.waitFor p 15 TimeUnit/SECONDS) "kill timeout") (check! (not (zero? (.exitValue p))) "writer survived")
         (let [expected (if (and (= role :root) (= event :renamed)) "new" "old") v (spawn "verify" dir expected)]
          (check! (.waitFor v 180 TimeUnit/SECONDS) "verify timeout")
          (let [out (slurp (.getInputStream v))] (when-not (zero? (.exitValue v)) (throw (ex-info "verify failed" {:output out})))
           (check! (:pass (edn/read-string out)) "verify failed"))
          (prn {:event event :role role :recovered expected :bytes 1073741824 :pass true}) (flush)))
       (finally (.destroyForcibly p)))))
(let [[mode base a b tool] *command-line-args*]
 (case mode
  "writer" (writer base (keyword a) (keyword b) tool)
  "verify" (verify-case base a)
  "run" (do (check! (.mkdir (io/file base)) "fresh output required")
            (doseq [[event role] [[:renamed :wal] [:half-written :root] [:renamed :root]]]
             (run-case base a event role))
            (prn {:cases 3 :old-nonempty true :gib true :sigkill true :pass true}))
  (throw (ex-info "unknown mode" {}))))
(shutdown-agents)
