(ns otehon.forest-writer-test
  (:require [clojure.test :refer [deftest is]]
            [otehon.forest-writer :as writer]
            [otehon.cli :as cli]
            [otehon.pack-store :as pack]
            [otehon.storage :as storage])
  (:import [java.nio.file Files Paths OpenOption] [java.nio.file.attribute FileAttribute]))
(def ^:dynamic *output* ".agent-output/forest-writer-test")

(deftest export-publication-sync-and-interruption
  (.mkdirs (java.io.File. *output*))
  (doseq [stop [nil :linked :link-dir-synced]]
    (let [dir (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "export-sync-" (make-array FileAttribute 0))
          dest (.resolve dir "result")
          data (.getBytes "verified group bytes" "UTF-8")
          events (atom [])]
      (with-redefs [pack/recover (fn [_] :handle)
                    pack/group-size (fn [_ _] (alength data))
                    pack/read-group-range (fn [_ _ _ _] data)]
        (let [error (binding [cli/*export-observer* (fn [event]
                                                      (swap! events conj event)
                                                      (when (= stop event)
                                                        (throw (ex-info "injected interruption" {}))))]
                      (try (with-out-str (cli/-main "forest-group-export" "store" "file" (str dest)))
                           nil (catch Exception e e)))]
          (is (= (boolean stop) (boolean error)))
          (is (= (seq data) (seq (Files/readAllBytes dest))))
          (if stop
            (is (= 2 (count (seq (.list (.toFile dir))))))
            (do (is (= [:file-synced :linked :link-dir-synced :staging-unlinked :unlink-dir-synced] @events))
                (is (= ["result"] (vec (.list (.toFile dir)))))
                (is (thrown? java.nio.file.FileAlreadyExistsException
                             (cli/-main "forest-group-export" "store" "file" (str dest))))
                (is (= (seq data) (seq (Files/readAllBytes dest)))))))))))

(deftest export-refuses-failed-directory-sync
  (.mkdirs (java.io.File. *output*))
  (doseq [fail-at [1 2]]
    (let [dir (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "export-sync-failure-" (make-array FileAttribute 0))
          dest (.resolve dir "result")
          data (.getBytes "published bytes" "UTF-8")
          calls (atom 0)
          sync-dir @#'otehon.cli/sync-dir!]
      (with-redefs [pack/recover (fn [_] :handle)
                    pack/group-size (fn [_ _] (alength data))
                    pack/read-group-range (fn [_ _ _ _] data)]
        (with-redefs-fn {#'otehon.cli/sync-dir!
                         (fn [path]
                           (if (= fail-at (swap! calls inc))
                             (throw (java.io.IOException. "injected directory sync failure"))
                             (sync-dir path)))}
          (fn []
            (is (thrown? java.io.IOException
                         (cli/-main "forest-group-export" "store" "file" (str dest))))))
        (is (= fail-at @calls))
        (is (= (seq data) (seq (Files/readAllBytes dest))))
        (is (= (if (= fail-at 1) 2 1) (count (seq (.list (.toFile dir))))))
        (is (thrown? java.nio.file.FileAlreadyExistsException
                     (cli/-main "forest-group-export" "store" "file" (str dest))))
        (is (= (seq data) (seq (Files/readAllBytes dest))))))))
(deftest generic-writer-requires-explicit-valid-witness
  (.mkdirs (java.io.File. *output*))
  (let [d (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "ipld-witness-" (make-array FileAttribute 0))
        stage (str d "/stage")]
    (is (= :invalid-witness
           (try (writer/put-ipld-blocks! "missing" "x" "x" [] stage "missing" 1 nil) nil
                (catch Exception e (:type (ex-data e))))))
    (is (not (.exists (java.io.File. stage))))))
(deftest rejects-unpinned-tool-before-publication
  (.mkdirs (java.io.File. *output*))
  (let [dir (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "writer-" (make-array FileAttribute 0))
        store (str dir "/store") source (str dir "/input") tool (str dir "/tool") stage (str dir "/stage")]
    (Files/write (Paths/get source (make-array String 0)) (byte-array [1 2]) (make-array OpenOption 0))
    (Files/write (Paths/get tool (make-array String 0)) (byte-array [3 4]) (make-array OpenOption 0))
    (storage/init! store)
    (let [before (:root (storage/read-store store))]
      (is (= :untrusted-forest-tool
             (try (writer/put-file! store "file" source stage tool) nil
                  (catch Exception e (:type (ex-data e))))))
      (is (= before (:root (storage/read-store store))))
      (is (not (.exists (java.io.File. stage)))))))

(deftest large-writer-refuses-invalid-generation-before-staging
  (.mkdirs (java.io.File. *output*))
  (let [dir (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "large-generation-" (make-array FileAttribute 0))
        stage (str dir "/stage")]
    (doseq [options [{:expected-generation nil} {:expected-generation 0}
                     {:expected-generation 9007199254740992} {:expected-generation false} {:unknown 1}]]
      (is (= :invalid-generation
             (try (writer/put-file-large! (str dir "/store") "file" (str dir "/source") stage (str dir "/tool") options) nil
                  (catch Exception e (:type (ex-data e))))))
      (is (not (.exists (java.io.File. stage)))))))

(deftest large-cli-refuses-degraded-before-writing
  (let [called (atom false)]
    (with-redefs [storage/read-store (fn [_] {:degraded? true :root {:generation 1}})
                  writer/put-file-large! (fn [& _] (reset! called true))]
      (is (= :degraded-store
             (try (cli/-main "forest-file-put-large" "store" "file" "source" "stage" "tool") nil
                  (catch Exception e (:type (ex-data e))))))
      (is (false? @called)))))

(deftest logical-import-refuses-degraded-before-reading
  (let [called (atom false)]
    (with-redefs [storage/read-store (fn [_] {:degraded? true :root {:generation 1}})
                  pack/import-logical-forest-files! (fn [& _] (reset! called true))]
      (is (= :degraded-store
             (try (cli/-main "logical-forest-import" "store" "file" "missing" "cid" "pack") nil
                  (catch Exception e (:type (ex-data e))))))
      (is (false? @called)))))

(deftest degraded-root-never-exports-older-file
  (.mkdirs (java.io.File. *output*))
  (let [dir (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "degraded-export-" (make-array FileAttribute 0))
        store (str dir "/store") output (str dir "/export")]
    (storage/init! store)
    (pack/put-data! store "file" (.getBytes "old" "UTF-8"))
    (pack/put-data! store "file" (.getBytes "new" "UTF-8"))
    (spit (str store "/root-1.edn") "broken root")
    (is (= :degraded-store
           (try (cli/-main "pack-get" store "file" output) nil
                (catch Exception e (:type (ex-data e))))))
    (is (not (.exists (java.io.File. output))))))
