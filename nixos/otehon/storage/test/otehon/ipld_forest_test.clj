(ns otehon.ipld-forest-test
  (:require [clojure.test :refer [deftest is testing]]
            [awai.fs.car :as car]
            [otehon.forest :as forest]
            [otehon.ipld-forest :as catalog]
            [otehon.storage :as store])
  (:import [java.nio.file Files Paths LinkOption] [java.io RandomAccessFile]))
(def root "bafyreiakmttcp6otxvnyqmdjpzlschlskibp7enadlvkguw3nnp47f5wqm")
(def fixture (or (System/getenv "IPLD_FOREST_FIXTURE") "nixos/otehon/storage/test/fixtures/prolly-forest/prolly.forest"))
(def ^:dynamic *output* ".agent-output")
(defn bytes [] (Files/readAllBytes (Paths/get fixture (make-array String 0))))
(defn new-store []
  (let [_ (.mkdirs (java.io.File. *output*))
        p (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "ipld-forest-" (make-array java.nio.file.attribute.FileAttribute 0))
        dir (str (.resolve p "store"))]
    (store/init! dir) dir))
(defn error-type [f] (try (f) nil (catch Exception e (:type (ex-data e)))))

(deftest persisted-generic-blocks-use-positioned-verified-reads
  (let [dir (new-store) a (bytes) decoded (forest/open a)
        blocks (:blocks (car/carv1-decode (:carv1 decoded)))
        ref (catalog/publish! dir "prolly" root a) handle (catalog/recover dir "prolly")
        recorded (atom []) original store/read-payload-segments]
    (is (= 12 (count blocks)))
    (is (= root (get-in handle [:ref :root-cid])))
    (is (= (:archive-sha ref) (get-in handle [:ref :archive-sha])))
    (is (nil? (get-in handle [:forest :bytes])))
    (with-redefs [store/read-payload-segments (fn [d sha ext size spans]
                                                 (swap! recorded into spans)
                                                 (original d sha ext size spans))]
      (doseq [{:keys [cid bytes]} blocks]
        (is (= bytes (mapv #(bit-and 255 %) (catalog/get-block handle (car/cid-str cid)))))))
    (is (seq @recorded))
    (is (every? #(< (:length %) (alength a)) @recorded))
    (is (nil? (catalog/get-block handle
                  (car/cid-str (car/cid-bytes car/codec-raw (vec (repeat 32 42)))))))))

(deftest root-refusal-and-corruption-are-not-fallbacks
  (let [dir (new-store) a (bytes)
        other (car/cid-str (car/cid-bytes car/codec-raw (vec (repeat 32 42))))]
    (is (= :invalid-ipld-root (error-type #(catalog/publish! dir "prolly" other a))))
    (is (= :ipld-forest-not-found (error-type #(catalog/recover dir "prolly"))))
    (catalog/publish! dir "prolly" root a)
    (let [h (catalog/recover dir "prolly") offsets (atom []) original store/read-payload-segments]
      (with-redefs [store/read-payload-segments (fn [d sha ext size spans]
                                                   (swap! offsets into spans)
                                                   (original d sha ext size spans))]
        (is (bytes? (catalog/get-block h root))))
      (let [path (str dir "/" (get-in h [:ref :archive-sha]) ".forest")
            at (:offset (first @offsets))]
        (with-open [f (RandomAccessFile. path "rw")]
          (.seek f at) (let [b (.read f)] (.seek f at) (.write f (bit-xor 1 b))))
        (is (= :corrupt-frame (error-type #(catalog/get-block h root))))
        (is (= :corrupt-forest (error-type #(catalog/recover dir "prolly"))))))))

(deftest missing-published-archive-refuses-recovery
  (let [dir (new-store) a (bytes) ref (catalog/publish! dir "prolly" root a)
        p (Paths/get (str dir "/" (:archive-sha ref) ".forest") (make-array String 0))
        withheld (Paths/get (str p ".withheld") (make-array String 0))]
    (Files/move p withheld (make-array java.nio.file.CopyOption 0))
    (is (= :missing-forest (error-type #(catalog/recover dir "prolly"))))))

(deftest interrupted-publish-keeps-old-catalog
  (let [dir (new-store) initial (bytes)
        other-path (or (System/getenv "FOREST_FIXTURE") "nixos/otehon/storage/test/fixtures/forest/sha256-pack.forest.car.zst")
        other (Files/readAllBytes (Paths/get other-path (make-array String 0)))
        other-root (car/cid-str (first (:roots (car/carv1-decode (:carv1 (forest/open other))))))]
    (catalog/publish! dir "prolly" root initial)
    (is (thrown? Exception
          (binding [store/*write-observer* (fn [event role]
                                             (when (= [event role] [:renamed :forest])
                                               (throw (ex-info "injected interruption" {}))))]
            (catalog/publish! dir "prolly" other-root other))))
    (let [h (catalog/recover dir "prolly")]
      (is (= root (get-in h [:ref :root-cid])))
      (is (bytes? (catalog/get-block h root))))))
