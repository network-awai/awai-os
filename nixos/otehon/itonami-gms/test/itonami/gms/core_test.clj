(ns itonami.gms.core-test
  (:require [clojure.test :refer [deftest is testing]]
            [itonami.gms.core :as core]
            [itonami.gms.cli :as cli]))

(def android {:platform :android :runtime :android :abi :arm64-v8a})
(def nixos {:platform :nixos :runtime :native :abi :aarch64})
(def waydroid {:platform :nixos :runtime :waydroid :abi :arm64-v8a})
(def digest (apply str (repeat 64 "a")))
(def artifact {:target android :format :apk :source "https://apps.itonami.example/releases/a/app.apk"
               :revision "fixture-immutable-a" :sha256 digest :bytes 123})
(def catalog {:schema "itonami.store.v1" :revision "fixture-a" :expires-at 200
              :apps [{:id "network.itonami.yotei" :version "fixture-1" :publisher "fixture-publisher"
                      :requires [:location] :artifacts [artifact]}]})
(defn plan [c target] (core/plan c "network.itonami.yotei" target 100))

(deftest exact-artifact-selection
  (is (= :plan-only (:status (plan catalog android))))
  (is (= artifact (:artifact (plan catalog android))))
  (is (= :unknown (:compatibility (plan catalog android))))
  (is (= :none (:approval-authority (plan catalog android))))
  (is (= :unverified (:metadata-authenticity (plan catalog android))))
  (testing "No platform, ABI, container or version fallback"
    (doseq [target [nixos waydroid (assoc android :abi :x86_64)]]
      (is (= :no-matching-artifact (:status (plan catalog target)))))
    (is (= :invalid-target (:status (plan catalog (assoc android :runtime :native)))))
    (is (= :app-not-found (:status (core/plan catalog "missing.app" android 100)))))
  (let [native (assoc artifact :target nixos :format :nix-archive)]
    (is (= native (:artifact (plan (assoc-in catalog [:apps 0 :artifacts] [native]) nixos))))))

(deftest invalid-catalogs-refuse-planning
  (doseq [bad [(assoc catalog :schema "unknown")
               (update catalog :apps conj (first (:apps catalog)))
               (assoc-in catalog [:apps 0 :artifacts] [artifact artifact])
               (assoc-in catalog [:apps 0 :artifacts 0 :sha256] "short")
               (assoc-in catalog [:apps 0 :artifacts 0 :bytes] -1)
               (assoc-in catalog [:apps 0 :artifacts 0 :format] :nix-archive)
               (assoc-in catalog [:apps 0 :requires] ["arbitrary-command"])
               (assoc-in catalog [:apps 0 :artifacts 0 :revision] "")]]
    (is (= :invalid-catalog (:status (plan bad android)))))
  (is (= :expired-catalog (:status (core/plan catalog "network.itonami.yotei" android 200))))
  (is (= :invalid-clock (:status (core/plan catalog "network.itonami.yotei" android nil)))))

(deftest narrow-external-source-syntax
  (doseq [source ["http://apps.example/a" "https://user@host/a" "https://host:443/a"
                  "https://host/a?token=x" "https://host/a#x" "https://host/../a"
                  "https://host/a b" "file:///tmp/app.apk" "https://host/%2e%2e/a"]]
    (is (false? (core/https-source? source))))
  (is (true? (core/https-source? "https://apps.itonami.example/releases/abc/app.apk"))))

(def environment (merge android {:os-build "lineage-fixture" :adapter-version "microg-fixture"
                                :app-id "test.app" :app-version "1" :case-id "push-delivery"}))
(def observation (merge environment {:result :pass :source "https://evidence.example/run/1"
                                     :evidence-sha256 digest :observed-at 100}))

(deftest evidence-is-scoped-and-never-a-grant
  (is (= :reported-pass (core/evidence-status environment [observation])))
  (is (= :reported-fail (core/evidence-status environment [(assoc observation :result :fail)]))))

(deftest stale-or-incomplete-evidence-never-qualifies
  (doseq [key core/evidence-keys]
    (is (= :not-tested (core/evidence-status environment [(assoc observation key :different)]))))
  (is (= :conflicting-reports (core/evidence-status environment [observation (assoc observation :result :fail)])))
  (doseq [key [:source :evidence-sha256 :observed-at]]
    (is (= :invalid-evidence (core/evidence-status environment [(dissoc observation key)]))))
  (is (= :invalid-evidence (core/evidence-status environment [(assoc observation :result :unknown)]))))

(deftest missing-runtime-or-build-query-is-invalid
  (is (= :invalid-evidence-query (core/evidence-status (dissoc environment :os-build) [observation]))))

(deftest file-integrity-and-untrusted-edn
  (let [file (java.io.File/createTempFile "itonami-gms-test" ".edn")]
    (try
      (spit file "abc")
      (let [hash "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"]
        (is (= :digest-match (:status (cli/verify-file hash (.getPath file)))))
        (is (= :unverified (:publisher-authenticity (cli/verify-file hash (.getPath file)))))
        (is (= :digest-mismatch (:status (cli/verify-file digest (.getPath file))))))
      (spit file (pr-str catalog))
      (is (= catalog (cli/read-catalog (.getPath file))))
      (spit file "{} {}")
      (is (thrown? Exception (cli/read-catalog (.getPath file))))
      (spit file "#=(System/exit 0)")
      (is (thrown? Exception (cli/read-catalog (.getPath file))))
      (spit file "#untrusted/command [1]")
      (is (thrown? Exception (cli/read-catalog (.getPath file))))
      (finally (.delete file)))))
