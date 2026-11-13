(ns otehon.kotobase-ref-test
  (:require [clojure.test :refer [deftest is]] [awai.fs.car :as car] [kotobase.storage.core :as contract]
            [otehon.kotobase-ref :as refs] [otehon.storage :as store])
  (:import [java.nio.file Files Paths] [java.nio.file.attribute FileAttribute]))
(def ^:dynamic *output* ".agent-output")
(def cid-a "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri")
(def cid-b "bafyreia5f47e462gm43mxscjphe4n6wyi56ccevdmwq526i4jcjuuphala")
(defn new-store []
  (.mkdirs (java.io.File. *output*))
  (let [p (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "kotobase-ref-" (make-array FileAttribute 0))
        dir (str (.resolve p "store"))]
    (store/init! dir) dir))
(deftest durable-contract-and-refusal
  (let [dir (new-store) r (refs/open-ref-store dir)]
    (is (contract/ref-store? r))
    (is (= :single-writer-ref (contract/ref-profile r)))
    (is (nil? (contract/-read-ref r "db")))
    (is (:published? (contract/-compare-and-set-ref! r "db" nil cid-a)))
    (let [reopened (refs/open-ref-store dir) before (store/read-store dir)
          wrong (contract/-compare-and-set-ref! reopened "db" nil cid-b)]
      (is (= cid-a (:cid (contract/-read-ref reopened "db"))))
      (is (= {:published? false :current cid-a :version (get-in before [:root :generation])} wrong))
      (is (= before (store/read-store dir)))
      (is (thrown? Exception (contract/-compare-and-set-ref! reopened "db" cid-a "bogus")))
      (let [trailing (car/cid-str (conj (car/base32-decode (subs cid-b 1)) 0))]
        (is (thrown? Exception (contract/-compare-and-set-ref! reopened "db" cid-a trailing))))
      (is (= before (store/read-store dir)))
      (is (:published? (contract/-compare-and-set-ref! reopened "db" cid-a cid-b)))
      (is (= cid-b (:cid (contract/-read-ref (refs/open-ref-store dir) "db")))))))
(deftest conditional-race
  (let [dir (new-store) gate (promise) r (refs/open-ref-store dir)
        attempt (fn [next] @gate
                  (loop [n 0]
                    (let [v (try (contract/-compare-and-set-ref! r "db" nil next)
                                 (catch Exception e (:type (ex-data e))))]
                      (if (and (= :writer-busy v) (< n 500))
                        (do (Thread/sleep 5) (recur (inc n))) v))))
        a (future (attempt cid-a)) b (future (attempt cid-b))]
    (deliver gate true)
    (let [results [@a @b] winner (first (filter :published? results)) loser (first (remove :published? results))]
      (is (= 1 (count (filter :published? results))))
      (is (= (:current winner) (:current loser) (:cid (contract/-read-ref r "db"))))
      (is (= (:version winner) (:version loser))))))

(deftest composes-with-independent-block-provider
  (let [dir (new-store) memory (atom {})
        blocks (reify contract/IBlockStore
                 (-put-blocks! [_ xs] (doseq [{:keys [cid bytes]} xs] (swap! memory assoc cid bytes)) (mapv :cid xs))
                 (-get-blocks [_ cids] (select-keys @memory cids))
                 contract/IBackendCapabilities
                 (-capabilities [_] #{:immutable-blocks :cid-addressed-read}))
        backend (contract/compose {:blocks blocks :refs (refs/open-ref-store dir)})]
    (is (= :single-writer-ref (contract/ref-profile (contract/validate-backend! backend))))
    (is (= [cid-a] (contract/-put-blocks! backend [{:cid cid-a :bytes [1 2 3]}])))
    (is (:published? (contract/-compare-and-set-ref! backend "db" nil cid-a)))
    (is (= {cid-a [1 2 3]} (contract/-get-blocks backend [(:cid (contract/-read-ref backend "db"))])))))

(deftest degraded-root-refuses-read-and-write
  (let [dir (new-store) r (refs/open-ref-store dir)]
    (is (:published? (contract/-compare-and-set-ref! r "db" nil cid-a)))
    ;; Only the disposable prior slot is damaged; preserve the newest slot.
    (spit (str dir "/root-1.edn") "damaged")
    (is (:degraded? (store/read-store dir)))
    (is (= :degraded-store (try (contract/-read-ref r "db") nil (catch Exception e (:type (ex-data e))))))
    (is (= :degraded-store (try (contract/-compare-and-set-ref! r "db" cid-a cid-b) nil (catch Exception e (:type (ex-data e))))))))

(deftest optional-target-check-is-under-writer-lock
  (let [dir (new-store) started (promise) release (promise)
        r (refs/open-ref-store dir (fn [_] (deliver started true) @release))
        pending (future (contract/-compare-and-set-ref! r "db" nil cid-a))]
    (try
      (is (= true (deref started 5000 :timeout)))
      (is (= :writer-busy (try (store/transact! dir :put {:key "other" :value "v"}) nil
                               (catch Exception e (:type (ex-data e))))))
      (finally (deliver release true)))
    (is (:published? @pending))
    (is (= cid-a (:cid (contract/-read-ref r "db"))))))
