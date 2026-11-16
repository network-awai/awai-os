(ns itonami.store.domain-test
  (:require [clojure.test :refer [deftest is run-tests]] [itonami.store.domain :as d]))
(def digest (apply str (repeat 64 "a")))
(def apk {:platform "android" :runtime "android" :kind "apk" :asset "packages/yotei.apk"
          :sha256 digest :bytes 123 :signerSha256 digest})
(def app {:id "network.itonami.yotei" :name "Yotei" :versionCode 2 :versionName "0.1.1" :artifacts [apk]})
(deftest exact-platform-and-version
  (is (= apk (d/artifact-for app "android" "android")))
  (is (nil? (d/artifact-for app "nixos" "browser")))
  (is (= "available" (d/app-state app "android" "android" nil)))
  (is (= "update" (d/app-state app "android" "android" 1)))
  (is (= "installed" (d/app-state app "android" "android" 3)))
  (is (= "invalid-installed-version" (d/app-state app "android" "android" "1"))))
(deftest malformed-or-untrusted-fields
  (doseq [path ["../app.apk" "packages/../../app.apk" "https://example.com/app.apk" "/tmp/app.apk"]]
    (is (false? (d/safe-artifact? (assoc apk :asset path)))))
  (is (false? (d/app? (assoc app :artifacts [apk apk]))))
  (is (false? (d/app? (assoc app :id "invalid;command"))))
  (is (false? (d/app? (assoc-in app [:artifacts 0 :signerSha256] "short")))))
(deftest expiry-and-duplicate-catalog
  (let [c {:schema d/schema :revision 1 :expiresAt 100 :apps [app]}]
    (is (true? (d/valid-catalog? c 99)))
    (is (false? (d/valid-catalog? c 100)))
    (is (false? (d/valid-catalog? (assoc c :apps [app app]) 99)))))
(deftest local-event-storage
  (is (= {:error "invalid-event"} (d/save-event [] {:id "1" :title "" :at 1})))
  (let [a {:id "1" :title "散歩" :at 200} b {:id "2" :title "読書" :at 100}
        xs (:events (d/save-event [a] b))]
    (is (= [b a] xs))
    (is (= a (d/next-event xs 150)))
    (is (= 2 (count (:events (d/save-event xs (assoc a :title "散歩の時間"))))))))
(defn -main [& _]
  (let [{:keys [fail error]} (run-tests 'itonami.store.domain-test)]
    (when (pos? (+ fail error)) (System/exit 1))))
