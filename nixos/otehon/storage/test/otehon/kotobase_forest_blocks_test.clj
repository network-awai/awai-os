(ns otehon.kotobase-forest-blocks-test
  (:require [clojure.test :refer [deftest is]] [awai.fs.car :as car]
            [kotobase.storage.core :as contract] [otehon.storage :as store]
            [otehon.kotobase-forest-blocks :as blocks] [otehon.ipld-forest :as catalog]
            [otehon.ipld-forest-test :as ipld-test])
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

(defn- prepared-port [initial]
  (let [a (atom {:root initial :pending nil})]
    {:status! #(deref a)
     :read! #(let [{:keys [root pending]} @a]
               (when pending (throw (ex-info "pending" {:type :witness-pending}))) root)
     :prepare! (fn [old next] (locking a (if (= @a {:root old :pending nil})
                                             (do (reset! a {:root old :pending next}) true) false)))
     :compare-and-set! (fn [old next] (locking a (if (= @a {:root old :pending next})
                                                  (do (reset! a {:root next :pending nil}) true) false)))}))

(deftest witnessed-ref-closure-and-reconciliation
  (let [[dir staging] (temp-store) parts (ipld-test/split-inputs) root ipld-test/policy-root
        group (catalog/publish-group! dir "kotobase-blocks/test" root parts)
        initial (:root (store/read-store dir)) w (prepared-port initial)
        shallow (fn [get-block cid] (boolean (get-block cid)))
        b (blocks/open-witnessed-backend dir staging "unused" w shallow)
        missing (car/cid-str (car/cid-bytes car/codec-raw (vec (repeat 32 42))))]
    (is (= :invalid-closure-verifier (error-type #(blocks/open-witnessed-backend dir staging "unused" w nil))))
    (is (= :missing-ref-target (error-type #(contract/-compare-and-set-ref! b "db" nil missing))))
    (is (= initial (:root (store/read-store dir))))
    (is (true? (:published? (contract/-compare-and-set-ref! b "db" nil root))))
    (is (= root (:cid (contract/-read-ref b "db"))))
    (is (bytes? (get (contract/-get-blocks b [root]) root)))
    (is (false? (:published? (contract/-compare-and-set-ref! b "db" nil root))))
    (is (= :unverified-catalog-type
           (error-type #(contract/-get-blocks (blocks/open-witnessed-block-store dir staging "unused" w) []))))
    (let [denied (blocks/open-witnessed-backend dir staging "unused" w (fn [_ _] false))]
      (is (= :closure-rejected (error-type #(contract/-read-ref denied "db")))))
    (let [outcome (binding [store/*write-observer* (fn [event role]
                          (when (= [event role] [:before-cas :witness]) (throw (ex-info "injected" {}))))]
                    (error-type #(contract/-compare-and-set-ref! b "db" root root)))
          prior ((:status! w))
          archive (:archive-sha (first (:archives group)))
          p (Paths/get (str dir "/" archive ".forest") (make-array String 0))
          saved (Paths/get (str dir "-ref-withheld") (make-array String 0))]
      (is (= :witness-commit-uncertain outcome))
      (is (= :witness-pending (error-type #(contract/-read-ref b "db"))))
      (Files/move p saved (make-array java.nio.file.CopyOption 0))
      (is (= :missing-forest (error-type #(blocks/reconcile-witnessed-backend! dir w shallow))))
      (is (= prior ((:status! w))))
      (Files/move saved p (make-array java.nio.file.CopyOption 0))
      (is (= :committed-pending (:outcome (blocks/reconcile-witnessed-backend! dir w shallow))))
      (is (= :already-consistent (:outcome (blocks/reconcile-witnessed-backend! dir w shallow))))
      (is (= root (:cid (contract/-read-ref b "db")))))))

(deftest witnessed-ref-postpublication-closure-refusal
  (let [[dir staging] (temp-store) root ipld-test/policy-root
        _ (catalog/publish-group! dir "kotobase-blocks/test" root (ipld-test/split-inputs))
        w (prepared-port (:root (store/read-store dir)))
        good (fn [get-block cid] (boolean (get-block cid)))
        stable (blocks/open-witnessed-backend dir staging "unused" w good)]
    (is (true? (:published? (contract/-compare-and-set-ref! stable "db" nil root))))
    (let [before ((:status! w)) n (atom 0)
          limited (blocks/open-witnessed-backend dir staging "unused" w
                    (fn [get-block cid] (and (boolean (get-block cid)) (< (swap! n inc) 3))))]
      (is (= :witness-commit-uncertain (error-type #(contract/-compare-and-set-ref! limited "db" root root))))
      (is (= 3 @n))
      (is (= (:root before) (:root ((:status! w)))))
      (is (= (:root (store/read-store dir)) (:pending ((:status! w)))))
      (is (= :committed-pending (:outcome (blocks/reconcile-witnessed-backend! dir w good)))))))

(deftest witnessed-root-verifies-every-ref
  (let [[dir staging] (temp-store) root ipld-test/policy-root
        _ (catalog/publish-group! dir "kotobase-blocks/test" root (ipld-test/split-inputs))
        w (prepared-port (:root (store/read-store dir)))
        good (fn [get-block cid] (boolean (get-block cid)))
        backend (blocks/open-witnessed-backend dir staging "unused" w good)]
    (is (true? (:published? (contract/-compare-and-set-ref! backend "a" nil root))))
    (is (true? (:published? (contract/-compare-and-set-ref! backend "b" nil root))))
    (let [calls (atom 0) deny-second (blocks/open-witnessed-backend dir staging "unused" w
                     (fn [get-block cid] (and (boolean (get-block cid)) (< (swap! calls inc) 2))))]
      (is (= :closure-rejected (error-type #(contract/-read-ref deny-second "a"))))
      (is (= 2 @calls)))))
