(ns otehon.storage-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.edn :as edn]
            [otehon.storage :as store])
  (:import [java.nio.file Files Paths LinkOption]
           [java.nio.file.attribute FileAttribute]))

(def ^:dynamic *output* ".agent-output/storage-unit")
(defn- directory []
  (.mkdirs (java.io.File. *output*))
  (str (Files/createTempDirectory (Paths/get *output* (make-array String 0))
                                  "case-" (make-array FileAttribute 0)) "/store"))
(defn- error-type [f]
  (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn- seeded []
  (let [d (directory)]
    (store/init! d)
    (store/transact! d :put {:key "a" :value "old"})
    (store/transact! d :put {:key "b" :value "keep"})
    d))

(deftest initialized-store-has-an-explicit-second-slot
  (let [d (directory)]
    (store/init! d)
    (is (.exists (java.io.File. (str d "/root-0.edn"))))
    (is (false? (:degraded? (store/read-store d))))
    ;; An old single-slot store cannot be distinguished from a lost first
    ;; commit. Preserve its bytes and require an explicit recovery decision.
    (let [slot (Paths/get (str d "/root-0.edn") (make-array String 0))]
      (when (Files/exists slot (make-array LinkOption 0))
        (Files/move slot (Paths/get (str d "-initial-slot.saved") (make-array String 0))
                    (make-array java.nio.file.CopyOption 0))))
    (is (true? (:degraded? (store/read-store d))))
    (is (= :degraded-store (error-type #(store/transact! d :put {:key "a" :value "x"}))))))

(deftest stale-initial-marker-cannot-mask-a-later-generation
  (let [d (seeded)]
    (is (= 3 (get-in (store/read-store d) [:root :generation])))
    (spit (str d "/root-0.edn") (pr-str {:format :awai.otehon-store/initial-slot-v1}))
    (is (true? (:degraded? (store/read-store d))))
    (is (= :degraded-store (error-type #(store/transact! d :put {:key "a" :value "x"}))))))

(defn- atom-witness [root]
  {:read! #(deref root)
   :compare-and-set! (fn [old new] (locking root (if (= @root old) (do (reset! root new) true) false)))})

(deftest witnessed-conditional-write-publishes-only-after-cas
  (let [d (directory) _ (store/init! d) initial (:root (store/read-store d))
        trusted (atom initial) witness (atom-witness trusted)
        result (store/transact-if-generation-witnessed! d 1 :put {:key "a" :value "new"} nil witness)]
    (is (= 2 (:generation result)))
    (is (= (:root (store/read-store d)) @trusted))
    (is (= "new" (get-in (store/read-store d) [:state "a"])))
    (is (= :stale-generation (error-type #(store/transact-if-generation-witnessed! d 1 :put {:key "b" :value "x"} nil witness))))
    (is (= :invalid-witness (error-type #(store/transact-if-generation-witnessed! d 2 :put {:key "b" :value "x"} nil {}))))))

(deftest witnessed-write-refuses-stale-and-ambiguous-outcomes
  (let [d (directory) _ (store/init! d) initial (:root (store/read-store d))
        other (assoc initial :snapshot (apply str (repeat 64 "a")))
        calls (atom 0) witness {:read! #(if (= 1 (swap! calls inc)) initial other)
                                :compare-and-set! (fn [_ _] (throw (ex-info "unexpected CAS" {})))}]
    (is (= :witness-changed (error-type #(store/transact-if-generation-witnessed! d 1 :put {:key "a" :value "x"} nil witness))))
    (is (= initial (:root (store/read-store d)))))
  (doseq [failure [:before-cas :after-cas]]
    (let [d (directory) _ (store/init! d) initial (:root (store/read-store d))
          trusted (atom initial) witness (atom-witness trusted)
          result (binding [store/*write-observer* (fn [event role]
                          (when (= [event role] [failure :witness]) (throw (ex-info "injected" {}))))]
                   (error-type #(store/transact-if-generation-witnessed! d 1 :put {:key "a" :value "new"} nil witness)))
          actual (:root (store/read-store d))]
      (is (= :witness-commit-uncertain result))
      (is (= 2 (:generation actual)))
      (is (= (= failure :after-cas) (= actual @trusted)))
      (when (= failure :before-cas)
        (is (= :witness-mismatch (error-type #(store/transact-if-generation-witnessed! d 2 :put {:key "b" :value "x"} nil witness))))))))

(deftest witnessed-root-publication-failure-is-uncertain
  (let [d (directory) _ (store/init! d) trusted (atom (:root (store/read-store d)))
        witness (atom-witness trusted)]
    (is (= :witness-commit-uncertain
           (binding [store/*write-observer* (fn [event role]
                      (when (= [event role] [:renamed :root]) (throw (ex-info "injected" {}))))]
             (error-type #(store/transact-if-generation-witnessed! d 1 :put {:key "a" :value "new"} nil witness)))))
    (is (= 2 (get-in (store/read-store d) [:root :generation])))
    (is (not= @trusted (:root (store/read-store d))))))

(deftest bounded-streamed-forest-publication
  (let [d (seeded) source (str d "-source")
        data (byte-array (map #(unchecked-byte (mod % 251)) (range (+ (* 2 1024 1024) 13))))
        md (java.security.MessageDigest/getInstance "SHA-256")
        digest (apply str (map #(format "%02x" (bit-and 255 %)) (.digest md data)))
        file (Paths/get source (make-array String 0)) events (atom [])]
    (Files/write file data (make-array java.nio.file.OpenOption 0))
    (binding [store/*write-observer* #(swap! events conj [%1 %2])]
      (is (= digest (store/write-forest-file! d source (alength data) digest))))
    (is (= [[:half-written :forest] [:written :forest] [:file-synced :forest] [:renamed :forest] [:dir-synced :forest]] @events))
    (is (java.util.Arrays/equals data (Files/readAllBytes (Paths/get (str d "/" digest ".forest") (make-array String 0)))))
    (reset! events [])
    (binding [store/*write-observer* #(swap! events conj [%1 %2])]
      (is (= digest (store/write-forest-file! d source (alength data) digest))))
    (is (= [[:reused-dir-synced :forest]] @events))
    (is (= :changed-payload (error-type #(store/write-forest-file! d source (dec (alength data)) digest))))
    (let [wrong (apply str (repeat 64 "0"))]
      (is (= :forest-source-changed (error-type #(store/write-forest-file! d source (alength data) wrong))))
      (is (not (Files/exists (Paths/get (str d "/" wrong ".forest") (make-array String 0))
                             (make-array LinkOption 0)))))
    (is (= :invalid-forest-source (error-type #(store/write-forest-file! d source (inc (* 32 1024 1024)) digest))))
    (aset-byte data 0 (byte 3))
    (Files/write file data (make-array java.nio.file.OpenOption 0))
    (is (= :forest-source-changed (error-type #(store/write-forest-file! d source (alength data) digest))))
    (Files/write file (Files/readAllBytes (Paths/get (str d "/" digest ".forest") (make-array String 0)))
                 (make-array java.nio.file.OpenOption 0))
    (spit (str d "/" digest ".forest") "corrupt")
    (is (= :corrupt-forest (error-type #(store/write-forest-file! d source (alength data) digest))))
    (is (= {"a" "old" "b" "keep"} (:state (store/read-store d))))))

(deftest checkpoint-roundtrip
  (let [d (seeded)]
    (is (= {"a" "old" "b" "keep"} (:state (store/read-store d))))
    (store/checkpoint! d)
    (is (= 2 (get-in (store/read-store d) [:root :checkpoint])))
    (store/transact! d :delete {:key "a"})
    (store/transact! d :put {:key "unicode/日本語" :value "新しい値"})
    (let [r (store/read-store d)]
      (is (= {"b" "keep" "unicode/日本語" "新しい値"} (:state r)))
      (is (= 4 (get-in r [:root :tail])))
      (is (false? (:degraded? r))))))

(deftest byte-identity-is-checked-before-replay
  (doseq [role [:snapshot :log]]
    (let [d (seeded)
          r (store/read-store d)
          object (str d "/" (get-in r [:root role]) ".edn")]
      (spit object "{:format :awai.otehon-store/object-v1 :value {}}")
      (is (= :corrupt-object (error-type #(store/read-store d)))))))

(deftest committed-loss-must-not-silently-rollback
  (let [d (seeded)
        digest (get-in (store/read-store d) [:root :log])]
    (Files/delete (Paths/get (str d "/" digest ".edn") (make-array String 0)))
    (is (= :missing-object (error-type #(store/read-store d))))))

(deftest torn-root-falls-back-and-reports-degradation
  (let [d (seeded)]
    ;; Generation 3 is in slot 1; previous committed generation 2 is intact.
    (spit (str d "/root-1.edn") "{:payload")
    (let [r (store/read-store d)]
      (is (= {"a" "old"} (:state r)))
      (is (= 2 (get-in r [:root :generation])))
      (is (true? (:degraded? r))))
    (is (= :degraded-store (error-type #(store/transact! d :put {:key "a" :value "new"}))))
    (is (= :degraded-store (error-type #(store/checkpoint! d))))
    (spit (str d "/root-0.edn") "broken")
    (is (= :no-root (error-type #(store/read-store d))))))

(deftest refuses-reinitialization-and-invalid-operations
  (let [d (seeded)
        before (store/read-store d)]
    (is (thrown? java.nio.file.FileAlreadyExistsException (store/init! d)))
    (doseq [[op payload] [[:unknown {}] [:put {:key "x" :value 1}]
                          [:delete {:key "a" :value "extra"}]]]
      (is (= :invalid-operation (error-type #(store/transact! d op payload)))))
    (is (= before (store/read-store d)))
    (is (= :too-large (error-type #(store/transact! d :put {:key "huge" :value (apply str (repeat 1100000 "x"))}))))
    (is (= before (store/read-store d)))))

(deftest observes-real-io-publication-order
  (let [d (seeded)
        events (atom [])]
    (binding [store/*write-observer* #(swap! events conj [%1 %2])]
      (store/transact! d :put {:key "a" :value "new"}))
    (is (= (into [[:reused-dir-synced :snapshot]] (for [role [:wal :root]
                      event [:half-written :written :file-synced :renamed :dir-synced]]
                  [event role])) @events))))

(deftest refuses-overlapping-writers-and-releases-lock-after-failure
  (let [d (seeded)
        errors (atom [])]
    (binding [store/*write-observer*
              (fn [event role]
                (when (= [event role] [:half-written :wal])
                  (swap! errors conj (error-type #(store/transact! d :delete {:key "b"})))
                  (throw (ex-info "injected write error" {:type :injected}))))]
      (is (= :injected (error-type #(store/transact! d :put {:key "a" :value "new"})))))
    (is (= [:writer-busy] @errors))
    (is (= {"a" "old" "b" "keep"} (:state (store/read-store d))))
    (store/transact! d :delete {:key "b"})
    (is (= {"a" "old"} (:state (store/read-store d))))))

(deftest refuses-symbolic-store-and-object-paths
  (let [d (seeded)
        dir-path (Paths/get d (make-array String 0))
        alias (Paths/get (str d "-alias") (make-array String 0))]
    (Files/createSymbolicLink alias (.toAbsolutePath dir-path) (make-array FileAttribute 0))
    (is (= :invalid-directory (error-type #(store/read-store (str alias)))))
    (let [digest (get-in (store/read-store d) [:root :log])
          object (Paths/get (str d "/" digest ".edn") (make-array String 0))
          saved (Paths/get (str d "/saved.edn") (make-array String 0))]
      (Files/move object saved (make-array java.nio.file.CopyOption 0))
      (Files/createSymbolicLink object (.toAbsolutePath saved) (make-array FileAttribute 0))
      (is (thrown? Exception (store/read-store d))))))

(deftest retry-completes-directory-sync-for-reused-orphan
  (let [d (seeded)
        payload {:key "a" :value "new"}
        events (atom [])]
    (binding [store/*write-observer* (fn [event role]
                                      (when (= [:renamed :wal] [event role])
                                        (throw (ex-info "before WAL directory sync" {:type :injected}))))]
      (is (= :injected (error-type #(store/transact! d :put payload)))))
    (is (= "old" (get-in (store/read-store d) [:state "a"])))
    (binding [store/*write-observer* #(swap! events conj [%1 %2])]
      (store/transact! d :put payload))
    (is (= [[:reused-dir-synced :snapshot] [:reused-dir-synced :wal]] (subvec @events 0 2)))
    (is (= "new" (get-in (store/read-store d) [:state "a"])))))
