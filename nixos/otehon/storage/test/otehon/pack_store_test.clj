(ns otehon.pack-store-test
  (:require [clojure.test :refer [deftest is]]
            [clojure.edn :as edn]
            [otehon.storage :as store]
            [otehon.segmented :as segmented]
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

(deftest compressed-parity-fast-ranges-and-incompressible-policy
  (let [raw (new-store) zipped (new-store) original (bytes-of 524288)]
    (pack/put-data! raw "file" original)
    (let [result (pack/put-data-zstd3! zipped "file" original)
          a (pack/recover raw) b (pack/recover zipped)]
      (is (= :segmented-zstd3 (get-in result [:compression :representation])))
      (is (= (get-in a [:files "file" :root-cid]) (get-in b [:files "file" :root-cid])))
      (is (= (seq (pack/export-car a "file")) (seq (pack/export-car b "file"))))
      (is (not (.exists (java.io.File. (str zipped "/" (get-in b [:files "file" :car-sha]) ".car")))))
      (doseq [h [a b] [offset length] [[0 4096] [65000 4096] [524280 8] [524288 0]]]
        (is (= (seq (java.util.Arrays/copyOfRange original offset (+ offset length)))
               (seq (pack/read-range-verified-leaves h "file" offset length)))))
      (doseq [h [a b]]
        (is (= :invalid-range (error-type #(pack/read-range-verified-leaves h "file" -1 4))))
        (is (= :invalid-range (error-type #(pack/read-range-verified-leaves h "file" 0 524289)))))
      (let [before (:bytes-read @(:stats a))]
        (pack/read-range-verified-leaves a "file" 0 4096)
        (is (= 65536 (- (:bytes-read @(:stats a)) before))))
      (pack/checkpoint! zipped)
      (is (= (seq original) (seq (pack/read-data (pack/recover zipped) "file")))))
    (let [entropy (byte-array 131109)]
      (.nextBytes (java.util.Random. 53120261112) entropy)
      (let [r (pack/put-data-zstd3! zipped "entropy" entropy)]
        (is (= :raw-car (get-in r [:compression :representation])))
        (is (= :awai.otehon-store/pack-v1 (get-in r [:pack :format])))))))

(deftest selected-leaf-and-frame-corruption-even-after-cache-hit
  (doseq [zipped? [false true]]
    (let [d (new-store) original (bytes-of 524288)
          _ ((if zipped? pack/put-data-zstd3! pack/put-data!) d "file" original)
          h (pack/recover d) ref (get-in h [:files "file"])
          checked (get @(:index-cache h) (or (:stored-sha ref) (:car-sha ref)))
          _ (pack/read-range-verified-leaves h "file" 0 4096)
          _ (pack/read-range-verified-leaves h "file" 0 4096)
          filename (str d "/" (or (:stored-sha ref) (:car-sha ref)) (if zipped? ".zpack" ".car"))
          offset (if zipped? (:prefix-size (:layout checked)) (:offset (first (:index checked))))]
      (with-open [f (java.io.RandomAccessFile. filename "rw")]
        (.seek f offset) (let [b (.read f)] (.seek f offset) (.write f (bit-xor b 1))))
      (is (= (if zipped? :corrupt-frame :cid-mismatch)
             (error-type #(pack/read-range-verified-leaves h "file" 0 4096))))
      (is (some? (error-type #(pack/read-data h "file"))))
      (is (some? (error-type #(pack/recover d))))
      (is (some? (error-type #(pack/checkpoint! d)))))))

(deftest unread-damage-is-not-silently-claimed-scrubbed
  (doseq [zipped? [false true]]
    (let [d (new-store) original (bytes-of 524288)
          _ ((if zipped? pack/put-data-zstd3! pack/put-data!) d "file" original)
          h (pack/recover d) ref (get-in h [:files "file"])
          checked (get @(:index-cache h) (or (:stored-sha ref) (:car-sha ref)))
          filename (str d "/" (or (:stored-sha ref) (:car-sha ref)) (if zipped? ".zpack" ".car"))
          offset (if zipped? (+ (:prefix-size (:layout checked)) (:stored-offset (last (get-in checked [:layout :frames]))))
                             (:offset (last (:index checked))))]
      (with-open [f (java.io.RandomAccessFile. filename "rw")]
        (.seek f offset) (let [b (.read f)] (.seek f offset) (.write f (bit-xor b 1))))
      (is (= (seq (java.util.Arrays/copyOfRange original 0 4096))
             (seq (pack/read-range-verified-leaves h "file" 0 4096))))
      (is (some? (error-type #(pack/export-car h "file"))))
      (is (some? (error-type #(pack/recover d)))))))

(deftest zpack-truncation-symlink-and-reference-tampering
  (doseq [damage [:truncate :symlink :ref]]
    (let [d (new-store) _ (pack/put-data-zstd3! d "file" (bytes-of 131109))
          h (pack/recover d) ref (get-in h [:files "file"])
          p (Paths/get (str d "/" (:stored-sha ref) ".zpack") (make-array String 0))]
      (case damage
        :truncate (with-open [f (java.io.RandomAccessFile. (str p) "rw")] (.setLength f 10))
        :symlink (do (Files/delete p) (Files/createSymbolicLink p (Paths/get "not-a-payload" (make-array String 0)) (make-array FileAttribute 0)))
        :ref (store/transact! d :put {:key "awai.pack/file" :value (pr-str (update ref :stored-size inc))}))
      (is (thrown? Exception (pack/recover d)))
      (when-not (= damage :ref)
        (is (thrown? Exception (pack/read-range-verified-leaves h "file" 0 4)))))))

(deftest segmented-directory-is-bounded-and-closed
  (let [blob (segmented/encode (bytes-of 131109))]
    (doseq [bad [(byte-array 12)
                 (doto (aclone blob) (aset-byte 0 (byte 0)))
                 (doto (aclone blob) (-> (java.nio.ByteBuffer/wrap 8 4) (.putInt -1)))
                 (doto (aclone blob) (-> (java.nio.ByteBuffer/wrap 8 4) (.putInt 32769)))
                 (java.util.Arrays/copyOf blob (dec (alength blob)))
                 (byte-array (concat blob [(byte 0)]))]]
      (is (thrown? Exception (segmented/decode bad))))))

(deftest mixed-ranges-and-snapshot-wide-cache-ceiling
  (let [d (new-store) original (bytes-of 131109)]
    (doseq [i (range 3)]
      (let [b (aclone original)] (aset-byte b 0 (byte i)) (pack/put-data-zstd3! d (str i) b)))
    (let [h (pack/recover d) random (java.util.Random. 531)]
      (dotimes [_ 20]
        (let [i (.nextInt random 3) b (aclone original)
              start (.nextInt random (inc (alength b)))
              length (.nextInt random (inc (min 70000 (- (alength b) start))))]
          (aset-byte b 0 (byte i))
          (is (= (seq (java.util.Arrays/copyOfRange b start (+ start length)))
                 (seq (pack/read-range-verified-leaves h (str i) start length))))))
      (let [caches (map :decoded-cache (vals @(:index-cache h)))]
        (is (apply identical? (take 2 caches)))
        (is (<= (count (:values @(first caches))) 4))))))
