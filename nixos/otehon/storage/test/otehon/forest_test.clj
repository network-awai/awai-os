(ns otehon.forest-test
  (:require [clojure.test :refer [deftest is]]
            [awai.fs.car :as car]
            [otehon.forest :as forest]
            [otehon.pack-store :as pack]
            [otehon.storage :as storage])
  (:import [java.nio.file Files Paths] [java.nio.file.attribute FileAttribute]
           [java.security MessageDigest] [java.util Arrays]))

(def ^:dynamic *output* ".agent-output/forest-test")
(defn- fixture [] (Files/readAllBytes (Paths/get (or (System/getenv "FOREST_FIXTURE") "nixos/otehon/storage/test/fixtures/forest/sha256-pack.forest.car.zst") (make-array String 0))))
(defn- new-store []
  (.mkdirs (java.io.File. *output*))
  (let [p (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "forest-" (make-array FileAttribute 0))
        d (str p "/store")]
    (storage/init! d) d))
(defn- digest [bytes] (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes)))
(defn- digest [bytes] (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes)))

(deftest file-verifier-matches-existing-reader-and-refuses-corruption
  (let [bytes (fixture) old (forest/open bytes) blocks (:blocks (car/carv1-decode (:carv1 old)))
        dir (new-store) path (Paths/get (str dir "/input.forest") (make-array String 0))
        write! #(Files/write path % (make-array java.nio.file.OpenOption 0))]
    (write! bytes)
    (let [actual (forest/verify-file (str path))
          expected (#'pack/verify-car (#'pack/forest-car old))]
      (is (= (mapv :cid blocks) (mapv :cid (:blocks actual))))
      (is (= (mapv #(count (:bytes %)) blocks) (mapv :length (:blocks actual))))
      (is (= (:frame-sha old) (:frame-sha actual)))
      (is (= (:ref expected) (:ref actual)))
      (is (= (:index expected) (:index actual)))
      (is (= (:car-size expected) (:car-size actual))))
    (doseq [offset [(dec (alength bytes)) 100 (+ (:index-pos old) 8) (+ (:index-pos old) 40)]]
      (let [bad (doto (aclone bytes) (aset-byte offset (unchecked-byte (bit-xor 1 (aget bytes offset)))))]
        (write! bad)
        (is (thrown? Exception (forest/verify-file (str path))))))
    (write! (Arrays/copyOf bytes 30))
    (is (thrown? Exception (forest/verify-file (str path))))))

(deftest independent-forest-fixture-blocks-and-cold-import
  (let [bytes (fixture) h (forest/open bytes)
        {:keys [blocks]} (car/carv1-decode (:carv1 h))
        data (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range 140000)))
        missing (car/cid-bytes car/codec-raw (digest (.getBytes "missing" "UTF-8")))
        dir (new-store)]
    (is (= 4 (count blocks)))
    (doseq [{:keys [cid bytes]} blocks]
      (is (= bytes (vec (map #(bit-and 255 %) (forest/get-block h cid))))))
    (let [entries (vec (remove nil? (:slots h)))
          matching (first blocks)
          hash-a (#'forest/hash-cid (:cid matching))
          pos-a (second (first (filter #(= hash-a (first %)) entries)))
          pos-b (second (first (remove #(= pos-a (second %)) entries)))
          i (.indexOf ^java.util.List (:slots h) [hash-a pos-a])
          collision (-> h (assoc-in [:slots i] [hash-a pos-b]) (assoc-in [:slots (inc i)] [hash-a pos-a]))]
      (is (some? matching))
      (is (= (:bytes matching) (vec (map #(bit-and 255 %) (forest/get-block collision (:cid matching)))))))
    (is (nil? (forest/get-block h missing)))
    (pack/import-forest! dir "file" bytes)
    (pack/checkpoint! dir)
    (let [fresh (pack/recover dir)]
      (is (zero? (get-in (pack/summary fresh) [:stats :cache-entries-before])))
      (is (Arrays/equals data (pack/read-data fresh "file")))
      (is (= (:carv1 h) (vec (map #(bit-and 255 %) (Arrays/copyOfRange (pack/export-car fresh "file") 51 (+ 51 (count (:carv1 h)))))))))))

(deftest forest-corruption-never-publishes
  (let [bytes (fixture) h (forest/open bytes) dir (new-store)
        before (storage/read-store dir)
        bad-footer (doto (aclone bytes) (aset-byte (dec (alength bytes)) (byte 127)))
        bad-frame (doto (aclone bytes) (aset-byte 100 (unchecked-byte (bit-xor 1 (aget bytes 100)))))
        bad-version (doto (aclone bytes) (aset-byte (+ (:index-pos h) 8) (byte 0)))
        bad-index (doto (aclone bytes) (aset-byte (+ (:index-pos h) 40) (byte 0)))
        bad-probe (doto (aclone bytes) (aset-byte (+ (:index-pos h) 32) (byte 1)))]
    (doseq [bad [bad-footer bad-frame bad-version bad-index bad-probe (Arrays/copyOf bytes 30)]]
      (is (thrown? Exception (pack/import-forest! dir "bad" bad)))
      (is (= before (storage/read-store dir))))))

(deftest interrupted-forest-import-keeps-old-root
  (let [dir (new-store) bytes (fixture)]
    (pack/put-data! dir "old" (.getBytes "old" "UTF-8"))
    (let [root (:root (storage/read-store dir))]
      (is (thrown? Exception
                   (binding [storage/*write-observer* (fn [event role]
                                                        (when (= [:renamed :zpack] [event role])
                                                          (throw (ex-info "interrupted" {}))))]
                     (pack/import-forest! dir "new" bytes))))
      (is (= root (:root (storage/read-store dir))))
      (is (= "old" (String. (pack/read-data (pack/recover dir) "old") "UTF-8")))
      (pack/import-forest! dir "new" bytes)
      (is (= 140000 (alength (pack/read-data (pack/recover dir) "new")))))))

(deftest durable-forest-selected-cid-and-ranges
  (let [bytes (fixture) source (forest/open bytes)
        blocks (:blocks (car/carv1-decode (:carv1 source)))
        dir (new-store)
        result (pack/import-forest-direct! dir "file" bytes)
        path (str dir "/" (get-in result [:pack :stored-sha]) ".forest")]
    (is (Arrays/equals bytes (Files/readAllBytes (Paths/get path (make-array String 0)))))
    (pack/checkpoint! dir)
    (let [h (pack/recover dir) before (:bytes-read @(:stats h))]
      (is (zero? (get-in (pack/summary h) [:stats :cache-entries-before])))
      (is (Arrays/equals bytes (pack/export-forest h "file")))
      (is (= (:bytes (first blocks)) (vec (map #(bit-and 255 %) (pack/read-forest-block h "file" (:cid (first blocks)))))))
      (is (< (- (:bytes-read @(:stats h)) before) (alength bytes)))
      (doseq [{:keys [cid bytes]} blocks]
        (is (= bytes (vec (map #(bit-and 255 %) (pack/read-forest-block h "file" cid))))))
      (let [data (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range 140000)))]
        (is (Arrays/equals (Arrays/copyOfRange data 65530 65552)
                           (pack/read-range-verified-leaves h "file" 65530 22)))
        (is (Arrays/equals data (pack/read-data h "file"))))
      (let [p (first (keys (:frame-sha source)))
            changed (doto (aclone bytes) (aset-byte (int (+ p 10)) (unchecked-byte (bit-xor 1 (aget bytes (+ p 10))))))]
        (Files/write (Paths/get path (make-array String 0)) changed (make-array java.nio.file.OpenOption 0))
        (is (thrown? Exception (pack/recover dir)))
        (is (thrown? Exception (pack/read-data h "file")))
        ;; Every block in the changed frame must refuse even with an old verified handle.
        (is (some (fn [{:keys [cid]}] (try (pack/read-forest-block h "file" cid) false (catch Exception _ true))) blocks))))))

(deftest durable-forest-publication-interruptions
  (doseq [event [:half-written :written :file-synced :renamed :dir-synced]]
    (let [dir (new-store) bytes (fixture)]
      (pack/put-data! dir "file" (.getBytes "old" "UTF-8"))
      (let [root (:root (storage/read-store dir))]
        (is (thrown? Exception (binding [storage/*write-observer*
                                         (fn [e role] (when (= [event :forest] [e role]) (throw (ex-info "interrupt" {}))))]
                                 (pack/import-forest-direct! dir "file" bytes))))
        (is (= root (:root (storage/read-store dir))))
        (is (= "old" (String. (pack/read-data (pack/recover dir) "file") "UTF-8")))
        (pack/import-forest-direct! dir "file" bytes)
        (is (= 140000 (:size (get-in (pack/summary (pack/recover dir)) [:files "file"]))))))))

(deftest committed-forest-loss-never-falls-back
  (doseq [damage [:missing :corrupt]]
    (let [dir (new-store) bytes (fixture)]
      (pack/put-data! dir "file" (.getBytes "old" "UTF-8"))
      (let [ref (:pack (pack/import-forest-direct! dir "file" bytes))
            path (Paths/get (str dir "/" (:stored-sha ref) ".forest") (make-array String 0))
            published (:root (storage/read-store dir))]
        (case damage
          :missing (Files/delete path)
          :corrupt (Files/write path (.getBytes "broken" "UTF-8") (make-array java.nio.file.OpenOption 0)))
        (is (thrown? Exception (pack/recover dir)))
        (is (thrown? Exception (pack/put-data! dir "other" (.getBytes "new" "UTF-8"))))
        (is (= published (:root (storage/read-store dir))))))))
