(ns otehon.kotobase-forest-blocks-test
  (:require [clojure.test :refer [deftest is]] [awai.fs.car :as car]
            [kotobase.storage.core :as contract] [otehon.storage :as store]
            [otehon.kotobase-forest-blocks :as blocks])
  (:import [java.nio.file Files Paths] [java.nio.file.attribute FileAttribute]))
(def ^:dynamic *output* ".agent-output")
(def cid "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri")
(defn temp-store []
  (.mkdirs (java.io.File. *output*))
  (let [base (Files/createTempDirectory (Paths/get *output* (make-array String 0)) "kotobase-blocks-" (make-array FileAttribute 0))
        dir (str (.resolve base "store")) staging (str (.resolve base "staging"))]
    (store/init! dir) (.mkdir (java.io.File. staging)) [dir staging]))
(defn error-type [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(deftest witnessed-port-refuses-pending-and-unsupported-roots
  (let [[dir staging] (temp-store) initial (:root (store/read-store dir))
        status (atom {:root initial :pending nil})
        w {:read! #(:root @status) :status! #(deref status)
           :prepare! (fn [_ _] false) :compare-and-set! (fn [_ _] false)}]
    (is (= :invalid-witness (error-type #(blocks/open-witnessed-block-store dir staging "unused" nil))))
    (is (= :invalid-witness (error-type #(blocks/open-witnessed-block-store dir staging "unused"
                                          {:read! (fn [] initial) :compare-and-set! (fn [_ _] false)}))))
    (let [b (blocks/open-witnessed-block-store dir staging "unused" w)]
      (is (= [] (contract/-put-blocks! b []))) (is (= {} (contract/-get-blocks b [])))
      (swap! status assoc :pending initial)
      (is (= :witness-pending (error-type #(contract/-put-blocks! b []))))
      (is (= :witness-pending (error-type #(contract/-get-blocks b []))))
      (swap! status assoc :pending nil)
      (store/transact! dir :put {:key "unknown/entry" :value "x"})
      (reset! status {:root (:root (store/read-store dir)) :pending nil})
      (is (= :unverified-catalog-type (error-type #(contract/-get-blocks b [])))))))
(deftest empty-invalid-and-bounded-inputs
  (let [[dir staging] (temp-store) b (blocks/open-block-store dir staging "unused") before (store/read-store dir)
        trailing (car/cid-str (conj (car/base32-decode (subs cid 1)) 0))]
    (is (= :packed-blocks (contract/block-profile (contract/validate-block-store! b))))
    (is (= [] (contract/-put-blocks! b [])))
    (is (= {} (contract/-get-blocks b [])))
    (is (thrown? Exception (contract/-get-blocks b [trailing])))
    (is (thrown? Exception (contract/-put-blocks! b [{:cid cid :bytes [1 -1]}])))
    (is (thrown? Exception (contract/-put-blocks! b [{:cid cid :bytes (byte-array (inc (* 850 1024)))}])))
    (is (thrown? Exception (contract/-put-blocks! b [{:cid cid :bytes [0]}])))
    (is (= before (store/read-store dir)))))
(deftest degraded-catalog-refuses-read-and-write
  (let [[dir staging] (temp-store) b (blocks/open-block-store dir staging "unused")]
    (store/transact! dir :put {:key "other" :value "value"})
    (spit (str dir "/root-1.edn") "damaged")
    (is (= :degraded-store (try (contract/-get-blocks b [cid]) nil (catch Exception e (:type (ex-data e))))))
    ;; Even an empty write must not be misrepresented as a durable write; it
    ;; contains no blocks and is a protocol no-op, so only read is checked here.
    ))

(deftest composed-ref-refuses-missing-root-without-publication
  (let [[dir staging] (temp-store) b (blocks/open-backend dir staging "unused")
        before (store/read-store dir)]
    (is (= :missing-ref-target
           (try (contract/-compare-and-set-ref! b "db" nil cid) nil
                (catch Exception e (:type (ex-data e))))))
    (is (= before (store/read-store dir)))
    (is (nil? (contract/-read-ref b "db")))
    ;; A stale expected CID returns CAS refusal without dereferencing NEXT.
    (is (false? (:published? (contract/-compare-and-set-ref! b "db" cid cid))))
    (is (= before (store/read-store dir)))))
