(ns otehon.forest-writer-test
  (:require [clojure.test :refer [deftest is]]
            [otehon.forest-writer :as writer]
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
