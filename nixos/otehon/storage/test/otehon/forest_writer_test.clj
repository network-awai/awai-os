(ns otehon.forest-writer-test
  (:require [clojure.test :refer [deftest is]]
            [otehon.forest-writer :as writer]
            [otehon.cli :as cli]
            [otehon.pack-store :as pack]
            [otehon.storage :as storage])
  (:import [java.nio.file Files Paths OpenOption] [java.nio.file.attribute FileAttribute]))
(def ^:dynamic *output* ".agent-output/forest-writer-test")
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
