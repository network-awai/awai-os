(require '[clojure.test :refer [deftest is run-tests]] '[babashka.fs :as fs]
         '[bot-fleet.meiji-history :as history] '[otehon.storage :as storage]
         '[otehon.pack-store :as pack])

(defn fixture []
  (let [root (str (fs/path (fs/real-path ".") ".agent-output" (str "history-test-" (random-uuid))))
        source (str root "/old") target (str root "/new")]
    (fs/create-dirs source) (storage/init! (str source "/packs"))
    (pack/put-data! (str source "/packs") "original" (.getBytes "original result" "UTF-8"))
    (pack/checkpoint! (str source "/packs"))
    {:root root :source source :target target}))

(deftest original-results-and-newer-work-survive
  (let [{:keys [source target]} (fixture)]
    (is (= {:state "imported" :results 1} (history/import! source target)))
    (is (= "original result" (String. (pack/read-data (pack/recover (str target "/packs")) "original") "UTF-8")))
    (pack/put-data! (str target "/packs") "newer" (.getBytes "new work" "UTF-8"))
    (pack/checkpoint! (str target "/packs"))
    (is (= "already-imported" (:state (history/import! source target))))
    (is (= "new work" (String. (pack/read-data (pack/recover (str target "/packs")) "newer") "UTF-8")))))

(deftest existing-and-linked-state-refused
  (let [{:keys [root source target]} (fixture)]
    (fs/create-dirs target)
    (is (thrown-with-msg? Exception #"preserve-existing" (history/import! source target)))
    (is (thrown-with-msg? Exception #"preserve-existing" (history/import! source source)))
    (fs/create-sym-link (fs/path source "outside") (fs/path root "new"))
    (is (thrown-with-msg? Exception #"symlink" (history/import! source (str root "/another"))))))

(let [result (run-tests)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
