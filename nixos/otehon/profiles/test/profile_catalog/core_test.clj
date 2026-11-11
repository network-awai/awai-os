(ns profile-catalog.core-test
  (:require [clojure.test :refer [deftest is run-tests]]
            [clojure.java.io :as io]
            [profile-catalog.core :as core])
  (:import [java.nio.file Files]))
(def manifest {:itonami/schema "cloud.itonami.profile.v2" :profile/id "notes"
               :runtime {:engine :itonami-agent} :profile/description "記録"
               :bundle {:skills ["notes"]} :private "DO-NOT-PUBLISH"})
(deftest metadata-projection
  (is (= {:id "notes" :description "記録" :skills ["notes"]} (core/metadata manifest)))
  (is (nil? (core/metadata (assoc manifest :profile/id "../escape"))))
  (is (nil? (core/metadata (assoc manifest :runtime {:engine :hermes})))))
(deftest inventory-confines-files-and-fails-closed
  (let [root (.toFile (Files/createTempDirectory (.toPath (io/file (or (System/getenv "TEST_TMPDIR") (System/getProperty "java.io.tmpdir")))) "profile-catalog-test" (make-array java.nio.file.attribute.FileAttribute 0)))
        write! (fn [relative text] (let [file (io/file root relative)] (io/make-parents file) (spit file text)))]
    (try
      (is (thrown? Exception (core/catalog (str root))))
      (write! "profiles/notes/itonami.edn" (pr-str manifest))
      (write! "profiles/notes/.env" "DO-NOT-READ")
      (write! "profiles/wrong/itonami.edn" (pr-str manifest))
      (write! "profiles/large/itonami.edn" (apply str (repeat 262145 "x")))
      (write! "profiles/broken/itonami.edn" "{bad")
      (Files/createSymbolicLink (.toPath (io/file root "profiles/linked")) (.toPath (io/file root "profiles/notes")) (make-array java.nio.file.attribute.FileAttribute 0))
      (let [out (core/catalog (str root))]
        (is (= [{:id "notes" :description "記録" :skills ["notes"]}] (:profiles out)))
        (is (= 4 (:skipped out)))
        (is (not (.contains (pr-str out) "DO-NOT"))))
      (finally (doseq [f (reverse (file-seq root))] (io/delete-file f true))))))
(let [{:keys [fail error]} (run-tests 'profile-catalog.core-test)] (System/exit (if (zero? (+ fail error)) 0 1)))
