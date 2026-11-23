(ns itonami.store.handover-test
  (:require [clojure.test :refer [deftest is run-tests]] [itonami.store.handover :as h]))

(def did "did:key:z6MkhaXgBZDvotDkHzwyEj7KPSnxFWaQY5UNCBJU4x8dgVd6")
(def other-did "did:key:z6MkhaXgBZDvotDkHzwyEj7KPSnxFWaQY5UNCBJU4x8d6Vd6")
(def now 1760000000000)

(defn challenge [& kvs]
  (into {:schema h/schema
         :device did
         :deviceName "My Android"
         :nonce "0123456789abcdef01234567"
         :topic "0123456789abcdef0123456789abcdef"
         :ek "ephemeral-public"
         :exp (+ now (* 10 60 1000))
         :scope ["profile:settings" "profile:home-state"]}
        (apply hash-map kvs)))

(deftest challenge-shape-and-expiry
  (is (true? (h/valid-challenge? (challenge))))
  (is (false? (h/valid-challenge? (challenge :device "bad"))))
  (is (false? (h/valid-challenge? (challenge :deviceName ""))))
  (is (false? (h/valid-challenge? (challenge :deviceName (apply str (repeat 65 "a"))))))
  (is (false? (h/valid-challenge? (challenge :scope []))))
  (is (false? (h/valid-challenge? (challenge :scope ["profile:unknown"]))))
  (is (false? (h/valid-challenge? (challenge :scope ["profile:settings" "profile:settings"]))))
  (is (false? (h/valid-challenge? (challenge :exp "not-a-number"))))
  (is (true? (h/challenge-expired? (challenge :exp now) now)))
  (is (false? (h/challenge-expired? (challenge) now))))

(deftest verify-challenge-paths
  (let [good (h/verify-challenge {:challenge (challenge) :device did :scope ["profile:settings" "profile:home-state"] :now now :revoked #{} :cancelled false})]
    (is (:ok good))
    (is (= did (:device good)))
    (is (= :ready (:status good))))
  (is (= :wrong-device (:error (h/verify-challenge {:challenge (challenge) :device other-did :scope ["profile:settings"] :now now}))))
  (is (= :expired (:error (h/verify-challenge {:challenge (challenge :exp now) :device did :scope ["profile:settings"] :now now}))))
  (is (= :scope-not-approved (:error (h/verify-challenge {:challenge (challenge) :device did :scope ["profile:settings"] :now now}))))
  (is (= :revoked (:error (h/verify-challenge {:challenge (challenge) :device did :scope ["profile:settings" "profile:home-state"] :now now :revoked #{did}}))))
  (is (= :cancelled (:error (h/verify-challenge {:challenge (challenge) :device did :scope ["profile:settings"] :now now :cancelled true}))))
  (is (= :invalid-challenge (:error (h/verify-challenge {:challenge (challenge :deviceName "") :device did :scope ["profile:settings"] :now now})))))

(deftest phone-loss-recovery-is-a-fresh-challenge
  ;; Lost device's key must be revoked; fresh device gets its own verdict.
  (let [lost {:challenge (challenge :device did) :device did :scope ["profile:settings"] :now now :revoked #{did}}]
    (is (= :revoked (:error (h/verify-challenge lost)))))
  (let [fresh {:challenge (challenge :device other-did) :device other-did :scope ["profile:settings" "profile:home-state"] :now now :revoked #{did}}]
    (is (:ok (h/verify-challenge fresh)))))

(deftest truthful-unavailable-scope
  (is (= :ready (h/transfer-status ["profile:settings"])))
  (is (= :unavailable (h/transfer-status ["profile:wnfs-snapshot"])))
  (is (= :unavailable (h/transfer-status ["profile:settings" "profile:yotei-events"])))
  ;; Unavailable must never look ready: handover-next-status must not complete.
  (let [v (h/verify-challenge {:challenge (challenge :scope ["profile:wnfs-snapshot"]) :device did :scope ["profile:wnfs-snapshot"] :now now :revoked #{}})]
    (is (= :unavailable (:status v)))
    (is (= :unavailable (h/handover-next-status {:status :pending :verdict v})))
    (is (not= :completed (h/handover-next-status {:status :pending :verdict v})))))

(deftest envelope-and-forbidden-fields
  (is (true? (h/valid-envelope? {:schema h/schema :scope ["profile:settings"] :device did :exp (+ now 60000) :ek "e" :iv "i" :ct "c"})))
  (is (false? (h/valid-envelope? {:schema h/schema :scope [] :device did :exp (+ now 1) :ek "e" :iv "i" :ct "c"})))
  (is (true? (h/forbidden-keys-present? {"seed" "abc" :profile "x"})))
  (is (false? (h/forbidden-keys-present? {:profile "settings-v1" :locale "ja-JP"})))
  ;; A payload carrying a secret must never verify as a transfer.
  (is (true? (h/forbidden-keys-present? {:privateKey "x" :scope "profile:settings"}))))

(deftest next-status-is-monotonic
  (is (= :transferring (h/handover-next-status {:status :pending :verdict {:ok true :status :ready}})))
  (is (= :cancelled (h/handover-next-status {:status :cancelled :verdict {:ok true :status :ready}})))
  (is (= :cancelled (h/handover-next-status {:status :pending :verdict {:ok false :error :cancelled}})))
  (is (= :pending (h/handover-next-status {:status :pending :verdict nil}))))

(defn -main [& _]
  (let [{:keys [fail error]} (run-tests 'itonami.store.handover-test)]
    (when (pos? (+ fail error)) (System/exit 1))))
