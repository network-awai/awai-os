(ns otehon-c1.replica-fixture-test
  (:require [clojure.test :refer [deftest is run-tests]]
            [babashka.fs :as fs]
            [otehon.storage :as store]))
(load-file (str (fs/parent *file*) "/replica_fixture.clj"))
(require '[otehon-c1.replica-fixture :as f])
(def output ".agent-output/replica-fixture-tests")
(fs/create-dirs output)
(defn temp [] (str (fs/create-temp-dir {:dir output :prefix "case-"})))

(deftest immutable-import-and-new-recovery
  (let [parent (temp) source (str parent "/source") target (str parent "/target")
        original (f/seed! source)]
    (is (= 3 (:leaf-count original)))
    (is (= original (f/import! target (str source "/fixture.car"))))
    (is (= original (f/read! target)))
    (is (thrown? Exception (f/import! target (str source "/fixture.car"))))
    (is (= original (f/read! target)))))

(deftest corruption-is-confined-to-new-public-clone
  (let [parent (temp) source (str parent "/source") bad (str parent "/bad")
        restored (str parent "/restored") original (f/seed! source)]
    (is (:source-unchanged (f/corrupt-copy! (str source "/store") bad)))
    (is (= :corrupt-car (try (f/read! bad) nil (catch Exception e (:type (ex-data e))))))
    (is (= original (f/import! restored (str source "/fixture.car"))))
    (is (= original (f/read! (str source "/store"))))))

(let [result (run-tests)] (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
