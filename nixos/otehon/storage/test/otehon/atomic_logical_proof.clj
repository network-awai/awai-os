;; Exercise canonical logical manifest plus product Forest group at crash boundaries.
(require '[clojure.edn :as edn] '[clojure.java.io :as io]
         '[babashka.classpath :as cp] '[otehon.forest :as forest]
         '[otehon.segmented :as segmented] '[otehon.storage :as store]
         '[otehon.pack-store :as pack] '[awai.fs.car :as car])
(import '[java.nio.file Files Paths CopyOption LinkOption]
        '[java.nio.file.attribute FileAttribute])
(def fixture-dir (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack"))
(defn ensure! [v msg] (when-not v (throw (ex-info msg {}))))
(defn fixtures [] (mapv #(Files/readAllBytes (Paths/get (str fixture-dir "/part-" % ".forest.car.zst") (make-array String 0))) (range 4)))
(defn spawn [script mode dir & args]
  (.start (doto (ProcessBuilder. ^java.util.List (into [(or (System/getenv "BABASHKA") "bb") "--classpath" (cp/get-classpath) script mode dir] args)) (.redirectErrorStream true))))
(defn finish [p]
  (try (ensure! (.waitFor p 90 java.util.concurrent.TimeUnit/SECONDS) "reader timeout")
       (let [s (slurp (.getInputStream p))]
         (when-not (zero? (.exitValue p)) (throw (ex-info "reader failed" {:output s})))
         (edn/read-string s))
       (finally (.destroyForcibly p))))
(defn copy-records [source target]
  (Files/createDirectory (Paths/get target (make-array String 0)) (make-array FileAttribute 0))
  (doseq [f (.listFiles (io/file source))
          :when (re-matches #"(?:root-[01]|[0-9a-f]{64})\.edn|[0-9a-f]{64}\.forest" (.getName f))]
    (ensure! (Files/isRegularFile (.toPath f) (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])) "nonregular record")
    (Files/copy (.toPath f) (.toPath (io/file target (.getName f))) (make-array CopyOption 0))))
(defn manifest [files]
  (let [blocks (mapcat #(butlast (:blocks (car/carv1-decode (:carv1 (forest/open %))))) files)
        chunks (mapv (fn [i block] {"cid" {:tag 42 :bytes (:cid block)}
                                    "offset" (* i 65536) "length" (count (:bytes block))})
                     (range) blocks)
        value {"format" "awai.logical-file" "version" 1 "fileSize" (* (count chunks) 65536)
               "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" 65536} "chunks" chunks}
        v (car/cbor-encode value)
        bytes (byte-array (map unchecked-byte v))
        digest (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))]
    {:bytes bytes :cid (car/cid-str (car/cid-bytes car/codec-dag-cbor digest))}))
(defn publish [dir files]
  (if (= 4 (count files))
    (let [{:keys [bytes cid]} (manifest files)]
      (ensure! (= cid "bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny") "native corpus CID mismatch")
      (pack/import-logical-forest! dir "proof" files bytes cid))
    (pack/import-forest-group! dir "proof" files)))
(defn writer [dir event role occurrence]
  (let [n (atom 0) files (fixtures)]
    (binding [store/*write-observer*
              (fn [e r] (when (= [e r] [event role])
                          (when (= (swap! n inc) occurrence)
                            (prn {:ready true :event e :role r :occurrence occurrence}) (flush)
                            (Thread/sleep 30000))))]
      (publish dir files))
    (throw (ex-info "kill boundary not reached" {}))))
(defn read-state [dir expected]
  (let [handle (pack/recover dir)
        refs (get-in (pack/summary handle) [:groups "proof" :packs])
        files (fixtures)
        wanted (if (= expected "old") (subvec files 0 1) files)]
    (ensure! (= (mapv :stored-sha refs) (mapv segmented/sha wanted)) "incomplete or changed group")
    (when (= expected "new")
      (ensure! (= "bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny"
                  (get-in (pack/summary handle) [:groups "proof" :manifest-cid])) "logical CID missing")
      (let [offset (- (* 8 65536) 20)
            expected-bytes (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256))
                                            (range offset (+ offset 40))))]
        (ensure! (java.util.Arrays/equals expected-bytes (pack/read-group-range handle "proof" offset 40))
                 "cross-Pack range differs")))
    {:expected expected :all-packs-verified true :pass true}))
(defn run-case [script output role event occurrence]
  (let [case-name (str (name role) "-" (name event) "-" occurrence)
        dir (str output "/" case-name) cold (str dir "-cold")]
    (store/init! dir)
    (publish dir (subvec (fixtures) 0 1))
    (let [p (spawn script "write" dir (name event) (name role) (str occurrence))]
      (try
        (with-open [r (io/reader (.getInputStream p))]
          (let [line (deref (future (.readLine ^java.io.BufferedReader r)) 25000 nil)]
            (ensure! (and line (:ready (edn/read-string line))) "writer did not reach boundary")))
        (.destroyForcibly p)
        (ensure! (.waitFor p 10 java.util.concurrent.TimeUnit/SECONDS) "writer termination timeout")
        (ensure! (= 137 (.exitValue p)) "writer not killed")
        (copy-records dir cold)
        (let [expected (if (and (= role :root) (#{:renamed :dir-synced} event)) "new" "old")]
          (finish (spawn script "read" cold expected))
          ;; Retry also exercises orphan reuse and lock release.
          (publish dir (fixtures))
          (finish (spawn script "read" dir "new"))
          (prn {:role role :event event :occurrence occurrence :cold expected :retry true :pass true}))
        (finally (.destroyForcibly p))))))
(let [[mode dir a b c] *command-line-args*]
  (case mode
    "write" (writer dir (keyword a) (keyword b) (Long/parseLong c))
    "read" (prn (read-state dir a))
    "run" (try
            (ensure! (.mkdir (io/file dir)) "output must be new")
            (doseq [[role event occurrence] [[:forest :half-written 1] [:forest :renamed 3]
                                              [:forest :dir-synced 3] [:wal :half-written 1]
                                              [:wal :renamed 1] [:root :half-written 1]
                                              [:root :renamed 1] [:root :dir-synced 1]]]
              (run-case *file* dir role event occurrence))
            (let [dir (str dir "/negative") files (fixtures)]
              (store/init! dir)
              (publish dir files)
              (let [root (:root (store/read-store dir))
                    ref (first (get-in (pack/summary (pack/recover dir)) [:groups "proof" :packs]))
                    path (Paths/get (str dir "/" (:stored-sha ref) ".forest") (make-array String 0))
                    moved (Paths/get (str dir "/preserved-forest") (make-array String 0))]
                (ensure! (try (pack/import-forest-group! dir "bad" []) false (catch Exception _ true)) "empty group accepted")
                (ensure! (try (pack/import-forest-group! dir "bad" [(byte-array 5)]) false (catch Exception _ true)) "corrupt input accepted")
                (ensure! (= root (:root (store/read-store dir))) "bad input published")
                (Files/move path moved (make-array CopyOption 0))
                (try
                  (ensure! (try (pack/recover dir) false (catch Exception _ true)) "missing group Pack accepted")
                  (ensure! (try (pack/checkpoint! dir) false (catch Exception _ true)) "missing group Pack checkpointed")
                  (ensure! (= root (:root (store/read-store dir))) "missing Pack changed root")
                  (finally (Files/move moved path (make-array CopyOption 0))))))
            (prn {:cases 8 :cross-pack-range true :negative-cases true :pass true})
            (finally (shutdown-agents)))
    (throw (ex-info "use run, read or write" {}))))
