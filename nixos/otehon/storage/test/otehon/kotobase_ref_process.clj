;; Independent hosted processes over a private test store; no distributed claim.
(require '[babashka.classpath :as cp] '[clojure.edn :as edn]
         '[kotobase.storage.core :as contract] '[otehon.kotobase-ref :as refs]
         '[otehon.storage :as store])
(import '[java.util.concurrent TimeUnit])
(def a "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri")
(def b "bafyreia5f47e462gm43mxscjphe4n6wyi56ccevdmwq526i4jcjuuphala")
(defn check! [v message] (when-not v (throw (ex-info message {}))))
(defn spawn [& args]
  (.start (doto (ProcessBuilder. ^java.util.List
                  (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) *file*] args))
            (.redirectErrorStream true))))
(defn finish [p]
  (check! (.waitFor p 120 TimeUnit/SECONDS) "child timeout")
  (let [output (slurp (.getInputStream p))]
    (check! (zero? (.exitValue p)) (str "child failed: " output))
    (edn/read-string output)))
(let [[mode base choice] *command-line-args* dir (str base "/store")]
  (case mode
    "race-child" (let [r (refs/open-ref-store dir) next (if (= choice "a") a b)]
      (spit (str base "/ready-" choice) "ready")
      (loop [n 0]
        (when-not (.exists (java.io.File. (str base "/go")))
          (check! (< n 12000) "gate timeout") (Thread/sleep 10) (recur (inc n))))
      (prn (loop [n 0]
             (let [result (try (contract/-compare-and-set-ref! r "db" nil next)
                               (catch Exception e (if (= :writer-busy (:type (ex-data e))) :busy (throw e))))]
               (if (= :busy result)
                 (do (check! (< n 500) "writer busy timeout") (Thread/sleep 10) (recur (inc n)))
                 result)))))
    "read" (prn (contract/-read-ref (refs/open-ref-store dir) "db"))
    "run" (do
      (check! (.mkdir (java.io.File. base)) "output must not exist")
      (store/init! dir)
      (let [p (spawn "race-child" base "a") q (spawn "race-child" base "b")]
        (try
          (loop [n 0]
            (when-not (and (.exists (java.io.File. (str base "/ready-a")))
                           (.exists (java.io.File. (str base "/ready-b"))))
              (check! (< n 12000) "children not ready") (Thread/sleep 10) (recur (inc n))))
          (spit (str base "/go") "go")
          (let [results [(finish p) (finish q)]
                wins (filter :published? results) losses (remove :published? results)
                current (finish (spawn "read" base))]
            (check! (= 1 (count wins) (count losses)) "not exactly one winner")
            (check! (= (:current (first wins)) (:current (first losses)) (:cid current)) "inconsistent CAS result")
            (prn {:processes 2 :success 1 :refused 1 :fresh-process-read true :pass true}))
          (finally (.destroyForcibly p) (.destroyForcibly q)))))
    (throw (ex-info "unknown mode" {:mode mode}))))
