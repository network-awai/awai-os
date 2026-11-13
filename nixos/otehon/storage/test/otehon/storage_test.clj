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
