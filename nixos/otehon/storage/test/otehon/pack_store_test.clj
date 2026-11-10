(ns otehon.pack-store-test
  (:require [clojure.test :refer [deftest is]]
            [clojure.edn :as edn]
            [otehon.storage :as store]
            [otehon.pack-store :as pack])
  (:import [java.nio.file Files Paths]
           [java.nio.file.attribute FileAttribute]))

(def ^:dynamic *output* ".agent-output/pack-unit")
(defn- new-store []
  (.mkdirs (java.io.File. *output*))
  (let [parent (Files/createTempDirectory (Paths/get *output* (make-array String 0))
                                         "case-" (make-array FileAttribute 0))
        directory (str parent "/store")]
    (store/init! directory)
    directory))
(defn- error-type [f]
  (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn- bytes-of [n]
  (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range n))))

(deftest multi-leaf-checkpoint-cold-recovery-and-ranges
  (let [d (new-store)
        original (bytes-of (+ (* 2 pack/leaf-size) 13))
        result (pack/put-data! d "写真/日本語.bin" original)]
    (is (= 3 (get-in result [:pack :leaf-count])))
    (pack/checkpoint! d)
    (let [h (pack/recover d)]
      (is (= 1 (get-in (pack/summary h) [:basis :checkpoint])))
      (is (= 0 (get-in (pack/summary h) [:stats :cache-entries-before])))
      (is (= 1 (get-in (pack/summary h) [:stats :index-rebuilds])))
      (is (= (seq original) (seq (pack/read-data h "写真/日本語.bin"))))
      (is (= (seq (java.util.Arrays/copyOfRange original 65530 65552))
             (seq (pack/read-range h "写真/日本語.bin" 65530 22))))
      (is (empty? (pack/read-range h "写真/日本語.bin" (alength original) 0)))
      (is (= :invalid-range (error-type #(pack/read-range h "写真/日本語.bin" 0 (inc (alength original)))))))))

(deftest car-export-import-and-duplicate-reference
  (let [a (new-store) b (new-store) data (.getBytes "CAR roundtrip" "UTF-8")]
    (pack/put-data! a "file" data)
    (let [h (pack/recover a)
          bytes (pack/export-car h "file")
          ref (get-in (pack/summary h) [:files "file"])]
      (pack/import-car! b "copy" bytes)
      (pack/import-car! b "link" bytes)
      (let [back (pack/recover b)]
        (is (= ref (get-in (pack/summary back) [:files "copy"])))
        (is (= (seq bytes) (seq (pack/export-car back "copy"))))
        (is (= (seq data) (seq (pack/read-data back "copy"))))
        (is (= 1 (get-in (pack/summary back) [:stats :index-rebuilds])))
        (is (= 2 (count (:files (pack/summary back)))))))))

(deftest committed-car-loss-and-corruption-refuse
  (doseq [damage [:missing :corrupt]]
    (let [d (new-store)
          result (pack/put-data! d "file" (.getBytes "protected" "UTF-8"))
          file (str d "/" (get-in result [:pack :car-sha]) ".car")
          before (:root (store/read-store d))]
      (case damage
        :missing (Files/delete (Paths/get file (make-array String 0)))
        :corrupt (spit file "broken CAR"))
      (is (= (if (= damage :missing) :missing-car :corrupt-car) (error-type #(pack/recover d))))
      (is (some? (error-type #(pack/checkpoint! d))))
      (is (some? (error-type #(pack/put-data! d "another" (.getBytes "new" "UTF-8")))))
      (is (= before (:root (store/read-store d)))))))

(deftest tampered-cid-root-index-and-truncation-never-publish
  (let [d (new-store)
        _ (pack/put-data! d "file" (.getBytes "before" "UTF-8"))
        bytes (pack/export-car (pack/recover d) "file")
        before (store/read-store d)]
    (doseq [bad [(java.util.Arrays/copyOf bytes 40)
                 (doto (aclone bytes) (aset-byte 100 (unchecked-byte 99)))
                 (doto (aclone bytes) (aset-byte 43 (unchecked-byte 51)))
                 (byte-array (concat bytes [(unchecked-byte 0)]))]]
      (is (thrown? Exception (pack/import-car! d "bad" bad)))
      (is (= before (store/read-store d))))))

(deftest committed-reference-attributes-are-bound
  (let [d (new-store)]
    (pack/put-data! d "file" (.getBytes "data" "UTF-8"))
    (let [key "awai.pack/file"
          ref (edn/read-string (get-in (store/read-store d) [:state key]))]
      (store/transact! d :put {:key key :value (pr-str (update ref :size inc))})
      (is (= :pack-ref-mismatch (error-type #(pack/recover d)))))))

(deftest interrupted-payload-is-not-visible-and-retry-finishes-sync
  (let [d (new-store)
        data (.getBytes "after" "UTF-8")]
    (pack/put-data! d "file" (.getBytes "before" "UTF-8"))
    (binding [store/*write-observer* (fn [event role]
                                      (when (= [:renamed :pack] [event role])
                                        (throw (ex-info "injected before directory sync" {:type :injected}))))]
      (is (= :injected (error-type #(pack/put-data! d "file" data)))))
    (is (= "before" (String. (pack/read-data (pack/recover d) "file") "UTF-8")))
    (pack/put-data! d "file" data)
    (is (= "after" (String. (pack/read-data (pack/recover d) "file") "UTF-8")))))

(deftest imported-byte-array-is-frozen-before-publication
  (let [a (new-store) b (new-store)]
    (pack/put-data! a "file" (.getBytes "frozen" "UTF-8"))
    (let [bytes (pack/export-car (pack/recover a) "file")
          saved (aclone bytes)]
      (binding [store/*write-observer* (fn [event role]
                                        (when (= [:half-written :pack] [event role])
                                          (java.util.Arrays/fill ^bytes bytes (byte 0))))]
        (pack/import-car! b "file" bytes))
      (is (= (seq saved) (seq (pack/export-car (pack/recover b) "file")))))))

(deftest empty-pack-and-bounds
  (let [d (new-store)]
    (pack/put-data! d "empty" (byte-array 0))
    (is (empty? (pack/read-data (pack/recover d) "empty")))
    (is (= :too-large (error-type #(pack/put-data! d "huge" (byte-array (inc pack/max-data-bytes))))))
    (is (= :invalid-name (error-type #(pack/put-data! d "" (byte-array 0)))))
    (is (= :pack-not-found (error-type #(pack/read-data (pack/recover d) "unknown"))))))
