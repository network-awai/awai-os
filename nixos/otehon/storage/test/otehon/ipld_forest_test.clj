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

(def policy-root "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri")
(def split-roots ["bafyreia5f47e462gm43mxscjphe4n6wyi56ccevdmwq526i4jcjuuphala"
                  "bafyreidb7f6i335vyhbordfkte377frwmtq5axfpd44gpvxodjor643mhy"])
(defn split-inputs []
  (let [base (or (System/getenv "IPLD_SPLIT_FIXTURES") "nixos/otehon/storage/test/fixtures/prolly-forest/split")]
    (mapv (fn [i root-cid] {:root-cid root-cid
                            :bytes (Files/readAllBytes (Paths/get (str base "/" i ".forest") (make-array String 0)))})
          (range 2) split-roots)))
(deftest multiple-archives-publish-as-one-group
  (let [dir (new-store) parts (split-inputs)
        blocks (mapcat #(-> % :bytes forest/open :carv1 car/carv1-decode :blocks) parts)
        before (store/read-store dir)
        missing (car/cid-str (car/cid-bytes car/codec-raw (vec (repeat 32 42))))]
    (is (= 18 (count blocks)))
    (is (= :invalid-ipld-basis (error-type #(catalog/publish-group! dir "graph" missing parts))))
    (is (= before (store/read-store dir)))
    (is (= :invalid-ipld-forest-group (error-type #(catalog/publish-group! dir "graph" policy-root [(first parts) (first parts)]))))
    (let [group (catalog/publish-group! dir "graph" policy-root parts)
          h (catalog/recover-group dir "graph")]
      (is (= 2 (count (:archives group))))
      (is (= policy-root (get-in h [:group :basis-cid])))
      (doseq [{:keys [cid bytes]} blocks]
        (is (= bytes (mapv #(bit-and 255 %) (catalog/get-group-block h (car/cid-str cid))))))
      (is (nil? (catalog/get-group-block h missing)))
      (let [ref (second (:archives group))
            p (Paths/get (str dir "/" (:archive-sha ref) ".forest") (make-array String 0))]
        (Files/move p (Paths/get (str p ".withheld") (make-array String 0)) (make-array java.nio.file.CopyOption 0))
        (is (= :missing-forest (error-type #(catalog/recover-group dir "graph"))))))))

(deftest interrupted-second-archive-preserves-prior-group
  (let [dir (new-store) parts (split-inputs)
        full-path (or (System/getenv "IPLD_POLICY_FIXTURE") "nixos/otehon/storage/test/fixtures/prolly-forest/policy.forest")
        full (Files/readAllBytes (Paths/get full-path (make-array String 0)))
        old [{:root-cid policy-root :bytes full}]]
    (catalog/publish-group! dir "graph" policy-root old)
    (let [root-before (:root (store/read-store dir)) seen (atom 0)]
      (is (thrown? Exception
            (binding [store/*write-observer* (fn [event role]
                                               (when (= [event role] [:renamed :forest])
                                                 (when (= 2 (swap! seen inc))
                                                   (throw (ex-info "interrupted second archive" {})))))]
              (catalog/publish-group! dir "graph" policy-root parts))))
      (is (= 2 @seen))
      (is (= root-before (:root (store/read-store dir))))
      (let [h (catalog/recover-group dir "graph")]
        (is (= 1 (count (get-in h [:group :archives]))))
        (is (bytes? (catalog/get-group-block h policy-root))))
      (catalog/publish-group! dir "graph" policy-root parts)
      (is (= 2 (count (get-in (catalog/recover-group dir "graph") [:group :archives])))))))
