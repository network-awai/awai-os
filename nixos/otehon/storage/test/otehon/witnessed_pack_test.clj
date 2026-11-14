(ns otehon.witnessed-pack-test
  (:require [clojure.test :refer [deftest is]] [otehon.storage :as store]
            [otehon.pack-store :as pack] [otehon.forest :as forest] [awai.fs.car :as car])
  (:import [java.nio.file Files Paths] [java.nio.file.attribute FileAttribute]))
(def ^:dynamic *output* ".agent-output/witnessed-pack-unit")
(defn- dir [] (.mkdirs (java.io.File. *output*))
  (str (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "case-" (make-array FileAttribute 0)) "/store"))
(defn- fixture []
  (let [base (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack")
        paths (mapv #(str base "/part-" % ".forest.car.zst") (range 4))
        blocks (mapcat #(butlast (:blocks (car/carv1-decode (:carv1 (forest/open (Files/readAllBytes (Paths/get % (make-array String 0)))))))) paths)
        chunks (mapv (fn [i block] {"cid" {:tag 42 :bytes (:cid block)} "offset" (* i 65536) "length" (count (:bytes block))}) (range) blocks)
        value {"format" "awai.logical-file" "version" 1 "fileSize" (* (count chunks) 65536)
               "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" 65536} "chunks" chunks}
        bytes (byte-array (map unchecked-byte (car/cbor-encode value)))
        digest (mapv #(bit-and 255 %) (.digest (java.security.MessageDigest/getInstance "SHA-256") bytes))]
    {:paths paths :bytes bytes :cid (car/cid-str (car/cid-bytes car/codec-dag-cbor digest))}))
(defn- witness [root cas]
  {:read! #(deref root) :compare-and-set! cas})
(defn- error-type [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(deftest file-import-witness-publication
  (let [{:keys [paths bytes cid]} (fixture)]
    (is (= "bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny" cid))
    (doseq [mode [:ok :reject :lost-reply]]
      (let [d (dir) _ (store/init! d) root (atom (:root (store/read-store d)))
            w (witness root (fn [old new] (locking root
                    (if (and (= @root old) (not= mode :reject))
                      (do (reset! root new) (if (= mode :lost-reply) (throw (ex-info "lost reply" {})) true)) false))))
            outcome (error-type #(pack/import-logical-forest-files! d "proof" paths bytes cid {:expected-generation 1 :witness w}))]
        (is (= (if (= mode :ok) nil :witness-commit-uncertain) outcome))
        (if (= mode :reject)
          (do (is (= :witness-mismatch (error-type #(pack/recover-witnessed d (:read! w)))))
              (is (= 4 (count (get-in (pack/summary (pack/recover d)) [:groups "proof" :packs])))))
          (let [handle (pack/recover-witnessed d (:read! w)) offset (- (* 8 65536) 20)
                expected (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range offset (+ offset 40))))]
            (is (= 4 (count (get-in (pack/summary handle) [:groups "proof" :packs]))))
            (is (= @root (:basis (pack/summary handle))))
            (is (java.util.Arrays/equals expected (pack/read-group-range handle "proof" offset 40)))))))))

(deftest lost-pack-after-root-does-not-advance-witness
  (let [{:keys [paths bytes cid]} (fixture) d (dir) _ (store/init! d)
        initial (:root (store/read-store d)) trusted (atom initial) calls (atom 0)
        w (witness trusted (fn [_ _] (swap! calls inc) true))
        removed (atom false)
        outcome (binding [store/*write-observer*
                          (fn [event role]
                            (when (= [event role] [:dir-synced :root])
                              (let [f (first (filter #(re-matches #"[0-9a-f]{64}\.forest" (.getName %))
                                                     (.listFiles (java.io.File. d))))]
                                (when-not f (throw (ex-info "expected published pack" {})))
                                (Files/move (.toPath f) (Paths/get (str d "-withheld.forest") (make-array String 0))
                                            (make-array java.nio.file.CopyOption 0))
                                (reset! removed true))))]
                  (error-type #(pack/import-logical-forest-files! d "proof" paths bytes cid
                                 {:expected-generation 1 :witness w})))]
    (is @removed)
    (is (= :witness-commit-uncertain outcome))
    (is (= 2 (get-in (store/read-store d) [:root :generation])))
    (is (= initial @trusted))
    (is (zero? @calls))
    (is (= :witness-mismatch (error-type #(pack/recover-witnessed d (:read! w)))))))
