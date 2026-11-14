;; Real hosted transaction, two archive group and ref publication kill boundaries.
(require '[clojure.edn :as edn] '[clojure.set :as set] '[clojure.java.io :as io] '[clojure.string :as str]
         '[babashka.classpath :as cp] '[otehon.storage :as store]
         '[otehon.kotobase-forest-blocks :as backend] '[kotobase.storage.core :as storage]
         '[otehon.ipld-forest :as catalog])
(import '[java.nio.file Files Paths LinkOption CopyOption] '[java.nio.file.attribute FileAttribute]
        '[java.util Arrays] '[java.util.concurrent TimeUnit])
(def helper (slurp "nixos/otehon/storage/test/otehon/ipld_forest_writer_proof.clj"))
(def marker (str/index-of helper "(let [[mode base tool]"))
(when-not marker (throw (ex-info "fixture helper not found" {})))
(load-string (subs helper 0 marker))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "FOREST_TOOL required" {}))))
(def seed (or (System/getenv "KOTOBASE_SEED_STORE") (throw (ex-info "KOTOBASE_SEED_STORE required" {}))))
(defn open-db [base]
  (backend/open-backend (str base "/store") (str base "/staging") tool
    (fn [get-block root]
      (check! (= basis root) "unexpected root")
      (doseq [{:keys [cid bytes]} (blocks)]
        (let [got (get-block cid)]
          (check! (and got (Arrays/equals ^bytes got ^bytes bytes)) "guard block mismatch")))
      true)))
(defn group-names [dir]
  (->> (:state (store/read-store dir)) keys
       (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/")) set))
(defn copy-records [from to]
  (Files/createDirectory (Paths/get to (make-array String 0)) (make-array FileAttribute 0))
  (doseq [f (.listFiles (io/file from))
          :when (re-matches #"(?:root-[01]|[0-9a-f]{64})\.edn|[0-9a-f]{64}\.forest" (.getName f))]
    (check! (Files/isRegularFile (.toPath f) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])) "nonregular seed record")
    (Files/copy (.toPath f) (.toPath (io/file to (.getName f))) (make-array CopyOption 0))))
(defn child [base event role occurrence]
  (let [db (open-db base) old (:cid (storage/-read-ref db "db")) tx (backend/open-transaction db)
        seen (atom 0)]
    (check! (and old (not= old basis)) "invalid seed ref")
    (doseq [{:keys [cid bytes]} (blocks)] ((:put! tx) cid bytes))
    (binding [store/*write-observer*
              (fn [e r] (when (and (= [event role] [e r]) (= occurrence (swap! seen inc)))
                          (prn {:ready true}) (flush) (Thread/sleep 30000)))]
      ((:publish! tx) "db" old basis))
    (throw (ex-info "requested kill boundary not reached" {}))))
(defn verify [base expected groups-before]
  (let [db (open-db base) head (:cid (storage/-read-ref db "db"))
        old (edn/read-string (slurp (str base "/old.edn")))
        new-groups (clojure.set/difference (group-names (str base "/store")) groups-before)]
    (check! (= (if (= expected "new") basis old) head) "wrong recovered ref")
    (when (not= expected "before-group")
      (check! (= 1 (count new-groups)) "new group missing or repeated")
      (let [key (first new-groups) name (subs key (count "awai.ipld-forest-group/"))
            group (catalog/recover-group (str base "/store") name)]
        (check! (= 2 (count (get-in group [:group :archives]))) "group not two complete archives")
        (doseq [{:keys [cid bytes]} (blocks)]
          (check! (Arrays/equals ^bytes bytes ^bytes (storage/get-block db cid)) "block readback mismatch"))))
    (when (= expected "before-group") (check! (empty? new-groups) "partial group visible"))
    (prn {:phase :reopen :expected expected :ref head :new-groups (count new-groups) :pass true})))
(defn spawn [& args]
  (.start (doto (ProcessBuilder. ^java.util.List (into ["bb" "--classpath" (cp/get-classpath) *file*] args))
            (.redirectErrorStream true))))
(defn run-case [base label event role occurrence expected]
  (let [dir (str base "/" label)]
    (check! (.mkdir (io/file dir)) "case exists")
    (check! (.mkdir (io/file dir "staging")) "staging exists")
    (copy-records seed (str dir "/store"))
    (let [db (open-db dir) old (:cid (storage/-read-ref db "db")) before (group-names (str dir "/store"))]
      (spit (str dir "/old.edn") (pr-str old))
      (spit (str dir "/groups.edn") (pr-str before))
      (let [p (spawn "child" dir (name event) (name role) (str occurrence))]
        (try
          (with-open [r (io/reader (.getInputStream p))]
            (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 180000 nil)]
              (check! (and line (:ready (edn/read-string line))) (str "boundary missing: " line))))
          (.destroyForcibly p)
          (check! (.waitFor p 10 TimeUnit/SECONDS) "kill timeout")
          (check! (not (zero? (.exitValue p))) "child not killed")
          (let [v (spawn "verify" dir expected)]
            (check! (.waitFor v 180 TimeUnit/SECONDS) "verify timeout")
            (let [out (slurp (.getInputStream v))]
              (check! (zero? (.exitValue v)) (str "verify failed " out))
              (prn {:boundary label :verification (edn/read-string out) :pass true})))
          (finally (.destroyForcibly p)))))))
(let [[mode a b c d] *command-line-args*]
  (case mode
    "child" (child a (keyword b) (keyword c) (Long/parseLong d))
    "verify" (verify a b (edn/read-string (slurp (str a "/groups.edn"))))
    "run" (do (check! (.mkdir (io/file a)) "output exists")
              (run-case a "second-archive" :half-written :forest 2 "before-group")
              (run-case a "ref-half-written" :half-written :root 2 "old")
              (run-case a "ref-renamed" :renamed :root 2 "new")
              (prn {:cases 3 :process-kill true :pass true}))
    (throw (ex-info "expected run, child or verify" {}))))
(shutdown-agents)
