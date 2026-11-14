(ns dango-adapter-test
  (:require [clojure.test :refer [deftest is run-tests]]
            [d1.dango-adapter :as adapter]
            [d1.dispatch :as dispatch]
            [dango.bytes :as bytes]
            [dango.chain :as chain]
            [ed25519.sign :as ed]))

;; Deterministic public test keys only. This is not a production issuer or a
;; canonical resource naming decision. The snapshot source is a local fixture.
(defn seed [n] (vec (repeat 32 n)))
(def provider-key (seed 1))
(def requester-key (seed 2))
(def holder "did:key:z6MkAgent")
(def job-binding {:job "job-a" :node "node-a" :policy "policy-a"
              :artifact (str "sha256:" (apply str (repeat 64 "a"))) :lease "lease-a"})
(defn resource [_ b]
  (str "kotoba://host/" (:node b) "/" (:job b) "/" (:policy b) "/" (:artifact b) "/" (:lease b)))
(def kinds {:provider :awai.contribution/provide :requester :awai.contribution/request})
(defn presentation [role issuer next-seed]
  (chain/present
   (chain/root {:issuer-seed issuer :next-seed (seed next-seed)
                :grant {:caps #{[(get kinds role) (resource role job-binding)]}
                        :holder holder :before 1800000000}
                :caveats []})))
(def provider-token (presentation :provider provider-key 3))
(def requester-token (presentation :requester requester-key 4))
(def revoked (atom #{}))
(def snapshot (atom {:cids #{} :as-of-ms 1699999999000 :expires-ms 1700000100000}))
(defn verifier []
  (adapter/make-verifier
   {:load-revocations (fn [] (assoc @snapshot :cids @revoked))
    :resource-of resource :holder-of (fn [_ _] holder) :public-input? (constantly true)
    :roots {:provider #{(ed/public-key provider-key)} :requester #{(ed/public-key requester-key)}}
    :max-revocation-age-ms 60000
    :kinds kinds}))

(deftest signed-presentations-and-revocation
  (let [verify (verifier) now 1700000000000
        provider (verify :provider provider-token job-binding now)
        requester (verify :requester requester-token job-binding now)
        bad (assoc-in provider-token [:blocks 0 :sig] (bytes/->bytes (repeat 64 0)))]
    (is (= true (:authenticated? provider)))
    (is (= true (:authenticated? requester)))
    (is (= 1700000100000 (:expires provider)))
    (is (nil? (verify :provider bad job-binding now)))
    (is (nil? (verify :requester provider-token job-binding now)))
    (is (nil? (verify :provider provider-token (assoc job-binding :job "job-b") now)))
    (reset! revoked #{(first (:dango-cids provider))})
    (is (nil? (verify :provider provider-token job-binding now)))
    (is (= true (:authenticated? (verify :requester requester-token job-binding now))))
    (reset! revoked #{})
    (reset! snapshot {:cids #{} :as-of-ms 1700000000001 :expires-ms 1700000100000})
    (is (nil? (verify :provider provider-token job-binding now)))
    (reset! snapshot {:cids #{} :as-of-ms 1699999999000 :expires-ms now})
    (is (nil? (verify :provider provider-token job-binding now)))
    (reset! snapshot {:cids #{} :as-of-ms (- now 60001) :expires-ms (+ now 1000)})
    (is (nil? (verify :provider provider-token job-binding now)))))

(deftest signed-consents-feed-dispatch-fixture
  (reset! revoked #{})
  (reset! snapshot {:cids #{} :as-of-ms 1699999999000 :expires-ms 1700000100000})
  (let [verify (verifier) now 1700000000000 launches (atom 0)
        provider (verify :provider provider-token job-binding now)
        reserve (fn [b amount]
                  {:status :reserved
                   :reservation {:verified? true :persisted? true :state :active
                                 :binding b :expires (+ now 90000) :fence 1 :amount amount}
                   :capacity {:demand amount :qualified 10 :reserve 1 :committed 1
                              :unmanaged 1 :fresh? true :dry-run? false}})
        host {:clock (constantly now) :verify-consent verify :reserve! reserve
              :revalidate! (constantly :valid)
              :launch! (fn [_] (swap! launches inc) {:status :started})}
        request (merge job-binding {:demand 2 :provider-consent provider-token
                                    :requester-consent requester-token})]
    (is (= :started (:status (dispatch/dispatch! host request))))
    (is (= 1 @launches))
    ;; Revocation after the reservation but before the second verification.
    (let [revoking (assoc host :reserve! (fn [b amount]
                                          (let [r (reserve b amount)]
                                            (reset! revoked #{(first (:dango-cids provider))}) r)))]
      (is (= :revalidation-failed (:cause (dispatch/dispatch! revoking request))))
      (is (= 1 @launches)))))

(let [result (run-tests 'dango-adapter-test)]
  (shutdown-agents)
  (System/exit (if (zero? (+ (:fail result) (:error result))) 0 1)))
