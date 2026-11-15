;; Local hosted JVM process-kill proof for the actual multi-archive streamed writer.
(require '[clojure.edn :as edn] '[clojure.java.io :as io] '[clojure.string :as str]
         '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.atomic-forest-stream :as stream]
         '[otehon.kotobase-forest-blocks :as fb] '[otehon.kotobase-ref :as refs]
         '[kotobase.storage.core :as storage])
(import '[java.security MessageDigest] '[java.util Random Arrays] '[java.util.concurrent TimeUnit])
(defn check! [v message] (when-not v (throw (ex-info message {}))))
(defn mkblock [i] (let [b (byte-array (* 1024 1024)) _ (.nextBytes (Random. (+ i 532)) b)
                       d (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
                   {:cid (car/cid-str (car/cid-bytes car/codec-raw d)) :bytes b}))
(defn batch [] (mapv mkblock (range 18)))
(defn run-writer [base event role occurrence tool]
 (let [dir (str base "/store") stage (str base "/stage") bs (batch) target (:cid (last bs)) seen (atom 0)]
  (check! (.mkdir (io/file base)) "fresh case required") (store/init! dir)
  (binding [store/*write-observer* (fn [e r] (when (and (= [e r] [event role]) (= occurrence (swap! seen inc)))
                                               (prn {:ready true :event e :role r}) (flush) (Thread/sleep 30000)))]
   (stream/publish! dir stage tool "db" nil (constantly nil)
    (fn [p] (doseq [{:keys [cid bytes]} bs] ((:put! p) cid bytes)) {:target target :value target})
    (fn [get-block cid] (and (= cid target) (every? (fn [{:keys [cid bytes]}] (Arrays/equals ^bytes bytes ^bytes (get-block cid))) bs)))))
 (throw (ex-info "boundary not reached" {}))))
(defn verify-case [base expected]
 (let [dir (str base "/store") s (store/read-store dir) ref (storage/-read-ref (refs/open-ref-store dir) "db")
       groups (filter #(str/starts-with? % "awai.ipld-forest-group/") (keys (:state s)))]
  (if (= expected "old")
   (do (check! (nil? ref) "partial ref visible") (check! (empty? groups) "partial group visible"))
   (let [bs (batch) db (fb/open-backend dir (str base "/unused") "/absent-writer")]
    (check! (= (:cid (last bs)) (:cid ref)) "new ref missing") (check! (= 1 (count groups)) "group missing")
    (doseq [{:keys [cid bytes]} bs] (check! (Arrays/equals ^bytes bytes ^bytes (storage/get-block db cid)) "block missing or changed"))))
  (prn {:expected expected :pass true})))
(defn spawn [& args]
 (.start (doto (ProcessBuilder. ^java.util.List (into [(str (System/getProperty "java.home") "/bin/java") "-Xmx512m" "-cp" (System/getProperty "java.class.path") "clojure.main" *file*] args)) (.redirectErrorStream true))))
(defn run-case [base tool event role occurrence]
 (let [dir (str base "/" (name role) "-" (name event)) p (spawn "writer" dir (name event) (name role) (str occurrence) tool)]
  (try
   (let [reader (io/reader (.getInputStream p)) line (deref (future (.readLine ^java.io.BufferedReader reader)) 180000 nil)]
    (check! (and line (:ready (edn/read-string line))) "writer boundary missing")
    (.destroyForcibly p) (check! (.waitFor p 15 TimeUnit/SECONDS) "kill timeout") (check! (not (zero? (.exitValue p))) "writer survived")
    (let [expected (if (and (= role :root) (contains? #{:renamed :dir-synced} event)) "new" "old")
          v (spawn "verify" dir expected)]
      (check! (.waitFor v 180 TimeUnit/SECONDS) "verify timeout")
      (let [out (slurp (.getInputStream v))] (when-not (zero? (.exitValue v)) (throw (ex-info "verify failed" {:output out})))
       (check! (:pass (edn/read-string out)) "verify returned failure"))
      (prn {:event event :role role :recovered expected :pass true}) (flush)))
   (finally (.destroyForcibly p)))))
(let [[mode base a b c tool] *command-line-args*]
 (case mode
  "writer" (run-writer base (keyword a) (keyword b) (Long/parseLong c) tool)
  "verify" (verify-case base a)
  "run" (do (check! (.mkdir (io/file base)) "fresh output required")
            (doseq [[event role occurrence] [[:half-written :forest 2] [:renamed :forest 2]
                                             [:half-written :wal 1] [:renamed :wal 1]
                                             [:half-written :root 1] [:renamed :root 1] [:dir-synced :root 1]]]
             (run-case base a event role occurrence))
            (prn {:cases 7 :multi-archive true :sigkill true :pass true}))
  (throw (ex-info "unknown mode" {}))))
(shutdown-agents)
