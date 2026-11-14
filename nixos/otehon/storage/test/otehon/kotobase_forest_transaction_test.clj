(ns otehon.kotobase-forest-transaction-test
  (:require [clojure.test :refer [deftest is]] [awai.fs.car :as car]
            [kotobase.storage.core :as contract] [otehon.kotobase-forest-blocks :as forest])
  (:import [java.security MessageDigest]))
(defn pair [text]
  (let [bytes (.getBytes text "UTF-8")
        digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes))]
    {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes}))
(defn fake-backend [state fail-put?]
  (reify
    contract/IBlockStore
    (-put-blocks! [_ xs]
      (swap! state update :puts inc)
      (when fail-put? (throw (ex-info "injected" {:type :test-failure})))
      (swap! state update :blocks into (map (juxt :cid :bytes) xs))
      (mapv :cid xs))
    (-get-blocks [_ ids] (select-keys (:blocks @state) ids))
    contract/IRefStore
    (-read-ref [_ _] (when-let [v (:ref @state)] {:cid v :version 1}))
    (-compare-and-set-ref! [_ _ expected next]
      (swap! state update :cas inc)
      (if (= expected (:ref @state))
        (do (swap! state assoc :ref next) {:published? true :current next :version 1})
        {:published? false :current (:ref @state) :version 1}))
    contract/IBackendCapabilities
    (-capabilities [_] #{:immutable-blocks :cid-addressed-read :conditional-ref :single-writer-ref})))
(defn state [] (atom {:puts 0 :cas 0 :blocks {} :ref nil}))
(deftest overlay-publishes-only-after-blocks
  (let [s (state) db (fake-backend s false) tx (forest/open-transaction db) {:keys [cid bytes]} (pair "value")]
    (is (= cid ((:put! tx) cid bytes)))
    (is (= cid ((:put! tx) cid (vec bytes))))
    (is (zero? (:puts @s)))
    (let [v ((:get-fn tx) cid)] (aset-byte v 0 (byte 0)))
    (is (= (vec bytes) (vec ((:get-fn tx) cid))))
    (is (:published? ((:publish! tx) "db" nil cid)))
    (is (= [1 1 cid] [(:puts @s) (:cas @s) (:ref @s)]))
    (is (thrown? Exception ((:put! tx) cid bytes)))
    (is (thrown? Exception ((:publish! tx) "db" cid cid)))))
(deftest abort-and-failed-flush-never-publish-ref
  (let [{:keys [cid bytes]} (pair "value") s (state) tx (forest/open-transaction (fake-backend s false))]
    ((:put! tx) cid bytes) (is ((:abort! tx)))
    (is (= [0 0] [(:puts @s) (:cas @s)]))
    (is (thrown? Exception ((:publish! tx) "db" nil cid))))
  (let [{:keys [cid bytes]} (pair "value") s (state) tx (forest/open-transaction (fake-backend s true))]
    ((:put! tx) cid bytes)
    (is (thrown? Exception ((:publish! tx) "db" nil cid)))
    (is (= [1 0 nil] [(:puts @s) (:cas @s) (:ref @s)]))
    (is (thrown? Exception ((:publish! tx) "db" nil cid)))))
(deftest stale-ref-leaves-persisted-orphan-but-never-advances
  (let [{:keys [cid bytes]} (pair "value") s (state) db (fake-backend s false)
        other (:cid (pair "other")) tx (forest/open-transaction db)]
    (swap! s assoc :ref other) ((:put! tx) cid bytes)
    (is (false? (:published? ((:publish! tx) "db" nil cid))))
    (is (= other (:ref @s)))
    (is (contains? (:blocks @s) cid))
    (is (thrown? Exception ((:get-fn tx) cid)))))
(deftest rejects-invalid-and-overfull-buffer
  (let [s (state) tx (forest/open-transaction (fake-backend s false)) {:keys [cid]} (pair "value")]
    (is (thrown? Exception ((:put! tx) cid [1 2])))
    (is (thrown? Exception ((:publish! tx) "db" nil cid)))
    (is (= [0 0] [(:puts @s) (:cas @s)])))
  (let [s (state) tx (forest/open-transaction (fake-backend s false))]
    (doseq [i (range 4096)] (let [{:keys [cid bytes]} (pair (str i))] ((:put! tx) cid bytes)))
    (let [{:keys [cid bytes]} (pair "overflow")]
      (is (= :too-large (try ((:put! tx) cid bytes) nil (catch Exception e (:type (ex-data e))))))
      (is (thrown? Exception ((:publish! tx) "db" nil cid))))
    (is (= [0 0] [(:puts @s) (:cas @s)]))))

(deftest semantic-verification-precedes-ref-publication
  (let [s (state) tx (forest/open-transaction (fake-backend s false)) {:keys [cid bytes]} (pair "semantic") calls (atom 0)]
    ((:put! tx) cid bytes)
    (is (:published? ((:publish! tx) "db" nil cid (fn [get-block root]
      (swap! calls inc) (and (= root cid) (= (vec bytes) (vec (get-block cid))) (zero? (:cas @s)))))))
    (is (= 1 @calls)))
  (doseq [verifier [(fn [_ _] false) (fn [_ _] (throw (ex-info "rejected" {}))) nil]]
    (let [s (state) tx (forest/open-transaction (fake-backend s false)) {:keys [cid bytes]} (pair "bad")]
      ((:put! tx) cid bytes)
      (is (thrown? Exception ((:publish! tx) "db" nil cid verifier)))
      (is (zero? (:cas @s)))
      (is (nil? (:ref @s)))
      (is (thrown? Exception ((:publish! tx) "db" nil cid))))))
