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
(deftest streamed-publication-crosses-batch-bound-with-one-ref-cas
  (let [s (state) db (fake-backend s false)
        blocks (mapv (fn [i]
                       (let [bytes (byte-array (* 820 1024))
                             _ (aset-byte bytes 0 (byte i))
                             digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") bytes))]
                         {:cid (car/cid-str (car/cid-bytes car/codec-raw digest)) :bytes bytes})) (range 41))
        target (:cid (last blocks)) saved (atom nil)]
    (is (> (reduce + (map #(alength ^bytes (:bytes %)) blocks)) (* 32 1024 1024)))
    (is (= :published
           (forest/publish-streamed-ports! db "db" nil {:max-bytes (* 40 1024 1024) :max-blocks 50}
             (fn [ports]
               (reset! saved ports)
               (doseq [{:keys [cid bytes]} blocks] ((:put! ports) cid bytes))
               (is (= 10 (:puts @s)))
               (is (nil? (:ref @s)))
               (is (= (vec (:bytes (first blocks))) (vec ((:get-fn ports) (:cid (first blocks))))))
               {:target target :value :published})
             (fn [get-block root]
               (is (thrown? Exception ((:put! @saved) target (:bytes (last blocks)))))
               (and (= target root) (zero? (:cas @s))
                    (every? (fn [{:keys [cid bytes]}] (= (vec bytes) (vec (get-block cid)))) blocks))))))
    (is (= [11 1 target] [(:puts @s) (:cas @s) (:ref @s)]))
    (is (thrown? Exception ((:get-fn @saved) target)))))

(deftest streamed-publication-refuses-failure-before-cas
  (let [items (mapv pair ["a" "b" "c"]) target (:cid (last items))]
    (let [s (state)]
      (is (thrown? Exception
            (forest/publish-streamed-ports! (fake-backend s false) "db" nil {:max-bytes 100 :max-blocks 2}
              (fn [ports] (doseq [{:keys [cid bytes]} items] (try ((:put! ports) cid bytes) (catch Exception _ nil)))
                {:target target :value :must-not-return}) (fn [& _] true))))
      (is (= [0 0 nil] [(:puts @s) (:cas @s) (:ref @s)])))
    (let [s (state)]
      (is (thrown? Exception
            (forest/publish-streamed-ports! (fake-backend s false) "db" nil {:max-bytes 100 :max-blocks 3}
              (fn [ports] (doseq [{:keys [cid bytes]} items] ((:put! ports) cid bytes)) {:target target :value :secret})
              (fn [& _] false))))
      (is (= [1 0 nil] [(:puts @s) (:cas @s) (:ref @s)])))
    (let [s (state) other (:cid (pair "other"))]
      (swap! s assoc :ref other)
      (is (= :stale-ref
             (try (forest/publish-streamed-ports! (fake-backend s false) "db" nil {:max-bytes 100 :max-blocks 3}
                    (fn [ports] (doseq [{:keys [cid bytes]} items] ((:put! ports) cid bytes)) {:target target :value :secret})
                    (fn [& _] true)) nil (catch Exception e (:type (ex-data e))))))
      (is (= other (:ref @s))))))

(deftest streamed-publication-requires-a-persisted-target
  (let [s (state) missing (:cid (pair "missing"))]
    (is (= :missing-ref-target
           (try (forest/publish-streamed-ports! (fake-backend s false) "db" nil {:max-bytes 100 :max-blocks 1}
                  (fn [_] {:target missing :value :secret}) (fn [& _] true)) nil
                (catch Exception e (:type (ex-data e))))))
    (is (zero? (:cas @s))) (is (nil? (:ref @s)))))

(deftest streamed-receipt-adapter-requires-verification-and-ref-cas
  (let [{:keys [cid bytes]} (pair "receipt-stream") input {:receipt {:r 1} :prepared {:p 2}}
        build (fn [ports _ _] ((:put! ports) cid bytes))
        verify (fn [get-block target receipt prepared]
                 (and (= [target receipt prepared] [cid (:receipt input) (:prepared input)])
                      (= (vec bytes) (vec (get-block cid)))))
        limits {:max-bytes 100 :max-blocks 10}]
    (let [s (state) adapter (forest/streamed-receipt-publication-adapter (fake-backend s false) "r" nil limits build verify)]
      (is (= cid ((:publish! adapter) input)))
      (is (= cid ((:read-ref! adapter))))
      (is (= [1 1] [(:puts @s) (:cas @s)])))
    (let [s (state) adapter (forest/streamed-receipt-publication-adapter (fake-backend s false) "r" nil limits build (fn [& _] false))]
      (is (= :closure-rejected (try ((:publish! adapter) input) nil (catch Exception e (:type (ex-data e))))))
      (is (nil? (:ref @s))) (is (zero? (:cas @s))))))

(deftest streamed-builder-failure-after-flush-leaves-only-orphans
  (let [s (state) leaked (atom nil) target (:cid (pair "unpublished"))]
    (is (thrown? Exception
          (forest/publish-streamed-ports! (fake-backend s false) "db" nil {:max-bytes 100000 :max-blocks 4100}
            (fn [ports]
              (reset! leaked ports)
              (doseq [i (range 4097)] (let [{:keys [cid bytes]} (pair (str i))] ((:put! ports) cid bytes)))
              (throw (ex-info "after flush" {})))
            (fn [& _] true))))
    (is (= [1 0 nil 4096] [(:puts @s) (:cas @s) (:ref @s) (count (:blocks @s))]))
    (is (thrown? Exception ((:get-fn @leaked) target)))))
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

(deftest scoped-publication-returns-only-after-validated-cas
  (let [s (state) db (fake-backend s false) {:keys [cid bytes]} (pair "scoped") leaked (atom nil)]
    (is (= :result
           (forest/publish-scoped! db "db" nil
             (fn [staged]
               (reset! leaked staged)
               (is (= [cid] (contract/-put-blocks! staged [{:cid cid :bytes bytes}])))
               (is (= [0 0] [(:puts @s) (:cas @s)]))
               (is (thrown? Exception (contract/-compare-and-set-ref! staged "db" nil cid)))
               {:target cid :value :result})
             (fn [get-block target]
               (and (= cid target) (= (vec bytes) (vec (get-block cid))) (zero? (:cas @s)))))))
    (is (= [1 1 cid] [(:puts @s) (:cas @s) (:ref @s)]))
    (is (thrown? Exception (contract/-get-blocks @leaked [cid])))
    (is (thrown? Exception (contract/-put-blocks! @leaked [{:cid cid :bytes bytes}])))))

(deftest scoped-publication-fails-closed
  (let [{:keys [cid bytes]} (pair "scoped-failure")
        build (fn [staged] (contract/-put-blocks! staged [{:cid cid :bytes bytes}]) {:target cid :value :secret})]
    (doseq [verify! [(fn [_ _] false) (fn [_ _] (throw (ex-info "failure" {})))]]
      (let [s (state)]
        (is (thrown? Exception (forest/publish-scoped! (fake-backend s false) "db" nil build verify!)))
        (is (= [1 0 nil] [(:puts @s) (:cas @s) (:ref @s)]))))
    (let [s (state) other (:cid (pair "other"))]
      (swap! s assoc :ref other)
      (is (= :stale-ref (try (forest/publish-scoped! (fake-backend s false) "db" nil build (fn [_ _] true)) nil
                             (catch Exception e (:type (ex-data e))))))
      (is (= other (:ref @s))))
    (let [s (state)]
      (is (thrown? Exception (forest/publish-scoped! (fake-backend s false) "db" nil
                                (fn [staged] (build staged) (throw (ex-info "builder failed" {}))) (fn [_ _] true))))
      (is (= [0 0 nil] [(:puts @s) (:cas @s) (:ref @s)])))))

(deftest explicit-provisional-ports-publish-only-after-cas
  (let [s (state) db (fake-backend s false) {:keys [cid bytes]} (pair "port-value") saved (atom nil)]
    (is (= :ok (forest/publish-ports! db "db" nil
                 (fn [ports]
                   (reset! saved ports)
                   (is (not (contract/block-store? ports)))
                   (is (= cid ((:put! ports) cid bytes)))
                   (is (= (vec bytes) (vec ((:get-fn ports) cid))))
                   (is (= [0 0] [(:puts @s) (:cas @s)]))
                   {:target cid :value :ok})
                 (fn [get-block target]
                   (and (= target cid) (= (vec bytes) (vec (get-block cid))) (zero? (:cas @s)))))))
    (is (= [1 1 cid] [(:puts @s) (:cas @s) (:ref @s)]))
    (is (thrown? Exception ((:put! @saved) cid bytes)))
    (is (thrown? Exception ((:get-fn @saved) cid)))))

(deftest explicit-provisional-ports-fail-closed
  (let [{:keys [cid bytes]} (pair "port-failure")
        build (fn [ports] ((:put! ports) cid bytes) {:target cid :value :secret})]
    (doseq [v [(fn [_ _] false) (fn [_ _] (throw (ex-info "failure" {})))]]
      (let [s (state)]
        (is (thrown? Exception (forest/publish-ports! (fake-backend s false) "db" nil build v)))
        (is (= [1 0 nil] [(:puts @s) (:cas @s) (:ref @s)]))))
    (let [s (state) other (:cid (pair "other"))]
      (swap! s assoc :ref other)
      (is (= :stale-ref (try (forest/publish-ports! (fake-backend s false) "db" nil build (fn [_ _] true)) nil
                             (catch Exception e (:type (ex-data e))))))
      (is (= other (:ref @s))))
    (let [s (state)]
      (is (thrown? Exception (forest/publish-ports! (fake-backend s false) "db" nil
                                (fn [ports] (build ports) (throw (ex-info "builder failed" {}))) (fn [_ _] true))))
      (is (= [0 0 nil] [(:puts @s) (:cas @s) (:ref @s)])))))

(deftest receipt-adapter-binds-publication-and-ref-readback
  (let [{:keys [cid bytes]} (pair "receipt-adapter")
        receipt {:receipt :value} prepared {:transaction :value}
        input {:receipt receipt :prepared prepared}
        build (fn [ports r p]
                (is (= [receipt prepared] [r p]))
                ((:put! ports) cid bytes))
        verify (fn [get-block target r p]
                 (and (= [cid receipt prepared] [target r p])
                      (= (vec bytes) (vec (get-block target)))))]
    (let [s (state) adapter (forest/receipt-publication-adapter (fake-backend s false) "receipt" nil build verify)]
      (is (nil? ((:read-ref! adapter))))
      (is (= cid ((:publish! adapter) input)))
      (is (= cid ((:read-ref! adapter))))
      (is (= [1 1 cid] [(:puts @s) (:cas @s) (:ref @s)])))
    (let [s (state) adapter (forest/receipt-publication-adapter (fake-backend s false) "receipt" nil build (fn [& _] false))]
      (is (= :closure-rejected (try ((:publish! adapter) input) nil (catch Exception e (:type (ex-data e))))))
      (is (= [1 0 nil] [(:puts @s) (:cas @s) (:ref @s)])))
    (let [s (state) other (:cid (pair "other"))]
      (swap! s assoc :ref other)
      (let [adapter (forest/receipt-publication-adapter (fake-backend s false) "receipt" nil build verify)]
        (is (= :stale-ref (try ((:publish! adapter) input) nil (catch Exception e (:type (ex-data e))))))
        (is (= other ((:read-ref! adapter))))))
    (let [s (state) adapter (forest/receipt-publication-adapter (fake-backend s false) "receipt" nil build verify)]
      (is (thrown? Exception ((:publish! adapter) {:receipt receipt})))
      (is (= [0 0] [(:puts @s) (:cas @s)])))))
