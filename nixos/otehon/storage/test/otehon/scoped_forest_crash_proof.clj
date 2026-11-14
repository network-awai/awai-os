;; Real hosted writer SIGKILL boundaries; no OS-cache/power-loss claim.
(require '[clojure.edn :as edn] '[clojure.string :as str] '[clojure.java.io :as io]
         '[babashka.classpath :as cp] '[kotobase.storage.core :as contract]
         '[otehon.kotobase-forest-blocks :as adapter] '[otehon.storage :as store])
(import '[java.nio.file Files Paths LinkOption CopyOption] '[java.nio.file.attribute FileAttribute]
        '[java.util Arrays] '[java.util.concurrent TimeUnit])
(def helper (slurp "nixos/otehon/storage/test/otehon/ipld_forest_writer_proof.clj"))
(def split-at (str/index-of helper "(let [[mode base tool]"))
(when-not split-at (throw (ex-info "proof helpers unavailable" {})))
(load-string (subs helper 0 split-at))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "FOREST_TOOL required" {}))))
(def old (let [bytes (.getBytes "old-scoped-reference" "UTF-8")
               hash (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))]
           {:cid (car/cid-str (car/cid-bytes car/codec-raw hash)) :bytes bytes}))
(defn spawn [mode dir & args]
  (.start (doto (ProcessBuilder. ^java.util.List
                    (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath)
                           *file* mode dir] args)) (.redirectErrorStream true))))
(defn finish [p]
  (try (check! (.waitFor p 180 TimeUnit/SECONDS) "child timeout")
       (let [out (slurp (.getInputStream p))]
         (when-not (zero? (.exitValue p)) (throw (ex-info "child failed" {:output out})))
         (edn/read-string out))
       (finally (.destroyForcibly p))))
(defn copy-store [from to]
  (Files/createDirectory (Paths/get to (make-array String 0)) (make-array FileAttribute 0))
  (doseq [f (.listFiles (io/file from))
          :when (re-matches #"(?:root-[01]|[0-9a-f]{64})\.edn|[0-9a-f]{64}\.forest" (.getName f))]
    (check! (Files/isRegularFile (.toPath f) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])) "invalid source record")
    (Files/copy (.toPath f) (.toPath (io/file to (.getName f))) (make-array CopyOption 0))))
(defn publish [dir staging expected items ports?]
  (let [db (adapter/open-backend dir staging tool) target (:cid (first items))]
    (let [verify! (fn [get-block cid] (and (= target cid)
                        (every? (fn [{:keys [cid bytes]}] (Arrays/equals ^bytes bytes ^bytes (get-block cid))) items)))]
      (if ports?
        (adapter/publish-ports! db "db" expected
          (fn [ports] (doseq [{:keys [cid bytes]} items] (check! (= cid ((:put! ports) cid bytes)) "staging mismatch"))
                      {:target target :value :published}) verify!)
        (adapter/publish-scoped! db "db" expected
          (fn [scoped] (check! (= (mapv :cid items) (contract/-put-blocks! scoped items)) "staging mismatch")
                       {:target target :value :published}) verify!)))))
(defn child-write [dir staging event role occurrence ports?]
  (let [seen (atom 0)]
    (binding [store/*write-observer* (fn [e r]
              (when (and (= [event role] [e r]) (= occurrence (swap! seen inc)))
                (prn {:ready true}) (flush) (Thread/sleep 30000)))]
      (publish dir staging (:cid old) (blocks) ports?)))
  (throw (ex-info "boundary not reached" {})))
(defn verify-store [dir staging expected]
  (let [db (adapter/open-backend dir staging "/nonexistent/forest-tool")
        items (if (= expected "old") [old] (blocks)) target (:cid (first items))]
    (check! (= target (:cid (contract/-read-ref db "db"))) "unexpected ref")
    (let [got (contract/-get-blocks db (mapv :cid items))]
      (doseq [{:keys [cid bytes]} items] (check! (Arrays/equals ^bytes bytes ^bytes (get got cid)) "block mismatch")))
    (when (= expected "new")
      (let [prefix "awai.ipld-forest-group/"
            state (:state (store/read-store dir))
            names (->> (keys state) (filter #(str/starts-with? % (str prefix "kotobase-blocks/")))
                       (map #(subs % (count prefix))))
            groups (map #(catalog/recover-group dir %) names)
            matching (filter #(catalog/get-group-block % target) groups)]
        (check! (= 1 (count matching)) "expected one target group")
        (check! (= 2 (count (get-in (first matching) [:group :archives]))) "expected two physical Packs")))
    {:expected expected :blocks (count items) :pass true}))
(defn run-case [base seed event role occurrence expected ports?]
  (let [case-root (str base "/" (name role) "-" (name event) "-" occurrence)
        dir (str case-root "/store") stage (str case-root "/stage") copy (str case-root "/copy")]
    (Files/createDirectory (Paths/get case-root (make-array String 0)) (make-array FileAttribute 0))
    (Files/createDirectory (Paths/get stage (make-array String 0)) (make-array FileAttribute 0))
    (copy-store seed dir)
    (let [p (spawn (if ports? "writer-ports" "writer") dir stage (name event) (name role) (str occurrence))]
      (try
        (with-open [r (io/reader (.getInputStream p))]
          (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 180000 nil)]
            (check! (and line (:ready (edn/read-string line))) "writer boundary missing")))
        (.destroyForcibly p)
        (check! (.waitFor p 10 TimeUnit/SECONDS) "kill timeout")
        (check! (not (zero? (.exitValue p))) "writer was not killed")
        (copy-store dir copy)
        (finish (spawn "verify" copy stage expected))
        (let [retry (try (publish dir stage (:cid old) (blocks) ports?) (catch Exception e (:type (ex-data e))))]
          (check! (= (if (= expected "old") :published :stale-ref) retry) "unexpected retry result"))
        (finish (spawn "verify" dir stage "new"))
        (prn {:event event :role role :occurrence occurrence :recovered expected :retry :verified :pass true})
        (finally (.destroyForcibly p))))))
(let [[mode dir a b c d] *command-line-args*]
 (case mode
  "writer" (child-write dir a (keyword b) (keyword c) (Long/parseLong d) false)
  "writer-ports" (child-write dir a (keyword b) (keyword c) (Long/parseLong d) true)
  "verify" (prn (verify-store dir a b))
  ("run" "run-ports") (try
          (check! (.mkdir (io/file dir)) "output exists")
          (check! (not= (:cid old) (:cid (first (blocks)))) "old and new refs must differ")
          (let [seed (str dir "/seed") staging (str dir "/seed-stage") ports? (= mode "run-ports")]
            (check! (.mkdir (io/file staging)) "seed staging exists")
            (store/init! seed)
            (check! (= :published (publish seed staging nil [old] ports?)) "seed failed")
            (run-case dir seed :half-written :forest 2 "old" ports?)
            (run-case dir seed :renamed :root 2 "new" ports?))
          (prn {:cases 2 :two-pack true :api mode :sigkill true :pass true})
          (finally (shutdown-agents)))
  (throw (ex-info "unknown mode" {:mode mode}))))
