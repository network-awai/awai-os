(ns otehon.witnessed-pack-test
  (:require [clojure.test :refer [deftest is]] [otehon.storage :as store]
            [otehon.pack-store :as pack] [otehon.ipld-forest :as ipld]
            [otehon.forest :as forest] [awai.fs.car :as car])
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

(defn- ipld-fixture []
  (Files/readAllBytes (Paths/get (or (System/getenv "IPLD_FOREST_FIXTURE")
                                    "nixos/otehon/storage/test/fixtures/prolly-forest/prolly.forest") (make-array String 0))))
(def ^:private ipld-root "bafyreiakmttcp6otxvnyqmdjpzlschlskibp7enadlvkguw3nnp47f5wqm")
(defn- atom-port [a calls]
  (witness a (fn [old new] (locking a (swap! calls inc) (if (= @a old) (do (reset! a new) true) false)))))
(deftest witness-verifies-coexisting-ipld-before-publishing
  (let [{:keys [paths bytes cid]} (fixture)]
    (doseq [missing? [false true]]
      (let [d (dir) _ (store/init! d) ref (ipld/publish! d "prolly" ipld-root (ipld-fixture))
            prior (:root (store/read-store d)) trusted (atom prior) calls (atom 0) w (atom-port trusted calls)
            path (Paths/get (str d "/" (:archive-sha ref) ".forest") (make-array String 0))
            saved (Paths/get (str d "-withheld-ipld") (make-array String 0))]
        (when missing? (Files/move path saved (make-array java.nio.file.CopyOption 0)))
        (let [result (error-type #(pack/import-logical-forest-files! d "proof" paths bytes cid {:expected-generation 2 :witness w}))]
          (if missing?
            (do (is (= :missing-forest result)) (is (= prior (:root (store/read-store d)))) (is (zero? @calls)))
            (do (is (nil? result)) (is (= 1 @calls)) (is (= (:root (store/read-store d)) @trusted)))))))))

(deftest witness-refuses-unknown-root-content
  (let [{:keys [paths bytes cid]} (fixture) d (dir) _ (store/init! d)
        _ (store/transact! d :put {:key "unknown/entry" :value "x"})
        prior (:root (store/read-store d)) trusted (atom prior) calls (atom 0) w (atom-port trusted calls)]
    (is (= :unverified-catalog-type
           (error-type #(pack/import-logical-forest-files! d "proof" paths bytes cid {:expected-generation 2 :witness w}))))
    (is (= prior (:root (store/read-store d)))) (is (zero? @calls))))

(deftest witness-refuses-ipld-loss-after-root-publication
  (let [{:keys [paths bytes cid]} (fixture) d (dir) _ (store/init! d)
        ref (ipld/publish! d "prolly" ipld-root (ipld-fixture)) prior (:root (store/read-store d))
        trusted (atom prior) calls (atom 0) w (atom-port trusted calls)
        path (Paths/get (str d "/" (:archive-sha ref) ".forest") (make-array String 0))
        saved (Paths/get (str d "-late-ipld-loss") (make-array String 0)) removed (atom false)
        result (binding [store/*write-observer* (fn [event role]
                         (when (= [event role] [:dir-synced :root])
                           (Files/move path saved (make-array java.nio.file.CopyOption 0)) (reset! removed true)))]
                 (error-type #(pack/import-logical-forest-files! d "proof" paths bytes cid {:expected-generation 2 :witness w})))]
    (is @removed) (is (= :witness-commit-uncertain result)) (is (= 3 (get-in (store/read-store d) [:root :generation])))
    (is (= prior @trusted)) (is (zero? @calls))))

(deftest witness-refuses-missing-ipld-group-archive
  (let [{:keys [paths bytes cid]} (fixture) d (dir) _ (store/init! d)
        base (or (System/getenv "IPLD_SPLIT_FIXTURES") "nixos/otehon/storage/test/fixtures/prolly-forest/split")
        roots ["bafyreia5f47e462gm43mxscjphe4n6wyi56ccevdmwq526i4jcjuuphala"
               "bafyreidb7f6i335vyhbordfkte377frwmtq5axfpd44gpvxodjor643mhy"]
        entries (mapv (fn [i root] {:root-cid root :bytes (Files/readAllBytes (Paths/get (str base "/" i ".forest") (make-array String 0)))}) (range 2) roots)
        group (ipld/publish-group! d "graph" "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri" entries)
        prior (:root (store/read-store d)) trusted (atom prior) calls (atom 0) w (atom-port trusted calls)
        path (Paths/get (str d "/" (:archive-sha (first (:archives group))) ".forest") (make-array String 0))
        saved (Paths/get (str d "-withheld-group") (make-array String 0))]
    (Files/move path saved (make-array java.nio.file.CopyOption 0))
    (is (= :missing-forest (error-type #(pack/import-logical-forest-files! d "proof" paths bytes cid {:expected-generation 2 :witness w}))))
    (is (= prior (:root (store/read-store d)))) (is (zero? @calls))))

(deftest reconcile-verifies-coexisting-ipld
  (let [{:keys [paths bytes cid]} (fixture) d (dir) _ (store/init! d)
        ref (ipld/publish! d "prolly" ipld-root (ipld-fixture)) prior (:root (store/read-store d))
        trusted (atom prior) calls (atom 0) simple (atom-port trusted calls)]
    (is (= :witness-commit-uncertain
           (binding [store/*write-observer* (fn [event role]
                     (when (= [event role] [:before-cas :witness]) (throw (ex-info "injected" {}))))]
             (error-type #(pack/import-logical-forest-files! d "proof" paths bytes cid {:expected-generation 2 :witness simple})))))
    (let [candidate (:root (store/read-store d)) status (atom {:root prior :pending candidate})
          w {:read! #(deref trusted) :status! #(deref status) :prepare! (fn [_ _] false)
             :compare-and-set! (fn [old new] (swap! calls inc)
                                 (if (= @status {:root old :pending new})
                                   (do (reset! trusted new) (reset! status {:root new :pending nil}) true) false))}
          path (Paths/get (str d "/" (:archive-sha ref) ".forest") (make-array String 0))
          saved (Paths/get (str d "-reconcile-withheld-ipld") (make-array String 0))]
      (Files/move path saved (make-array java.nio.file.CopyOption 0))
      (is (= :missing-forest (error-type #(pack/reconcile-witnessed! d w))))
      (is (= {:root prior :pending candidate} @status)) (is (zero? @calls))
      (Files/move saved path (make-array java.nio.file.CopyOption 0))
      (is (= :committed-pending (:outcome (pack/reconcile-witnessed! d w))))
      (is (= {:root candidate :pending nil} @status)))))
