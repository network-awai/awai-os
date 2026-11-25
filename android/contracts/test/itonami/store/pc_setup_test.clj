(ns itonami.store.pc-setup-test
  (:require [clojure.test :refer [deftest is run-tests]] [itonami.store.pc-setup :as pc]))
(deftest stage-roundtrip
  (is (= "welcome" (pc/stage-name 0)))
  (is (= "language" (pc/stage-name 1)))
  (is (= "network" (pc/stage-name 2)))
  (is (= "datetime" (pc/stage-name 3)))
  (is (= "account" (pc/stage-name 4)))
  (is (= "privacy" (pc/stage-name 5)))
  (is (= "lock" (pc/stage-name 6)))
  (is (= "done" (pc/stage-name 7)))
  (is (= "welcome" (pc/stage-name 99))))
(deftest transports-adaptive
  (is (= ["ethernet" "wifi" "tethering"] (pc/available-transports {:hasEthernet true :hasWifi true :hasTethering true})))
  (is (= ["wifi"] (pc/available-transports {:hasEthernet false :hasWifi true :hasTethering false})))
  (is (= ["wifi"] (pc/available-transports {:hasEthernet false :hasWifi false :hasTethering false}))))
(deftest honest-profile
  (is (= :unavailable pc/profile-transfer))
  (is (string? (pc/honest-profile-copy))))
(deftest pc-next-gates
  (is (= "next" (pc/next-action {:stage 1 :locale "ja-JP"})))
  (is (= "refused" (pc/next-action {:stage 1 :locale nil})))
  (is (= "next" (pc/next-action {:stage 2 :validated true})))
  (is (= "next" (pc/next-action {:stage 3 :timeZone "Asia/Tokyo"})))
  (is (= "account-required" (pc/next-action {:stage 4})))
  (is (= "refused" (pc/next-action {:stage 7 :secure false :account "deferred"})))
  (is (= "finish" (pc/next-action {:stage 7 :secure true :account "deferred"}))))
(defn -main [& _]
  (let [{:keys [fail error]} (run-tests 'itonami.store.pc-setup-test)]
    (when (pos? (+ fail error)) (System/exit 1))))
