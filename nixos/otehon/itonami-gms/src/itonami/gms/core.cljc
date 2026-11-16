(ns itonami.gms.core
  "Shared Store planning and compatibility reports. Pure data, never execution authority."
  (:require [clojure.string :as str]))

(def contract
  {:schema "itonami.gms.v1"
   :services {:store {:status :planning-core}
              :identity {:status :planned}
              :notifications {:status :planned}
              :location {:status :planned}
              :sync {:status :planned}}
   :adapters {:android {:status :unqualified}
              :nixos {:status :unqualified}
              :waydroid {:status :unqualified}
              :google-play-api {:status :unqualified}}
   :approval-authority :none
   :installation-authority :none
   :external-operation-broker :kotoba.app.client-runtime.v1})

(defn nonblank? [x] (and (string? x) (not (str/blank? x))))
(defn digest? [x] (and (string? x) (boolean (re-matches #"[0-9a-f]{64}" x))))
(defn positive-int? [x] (and (integer? x) (pos? x)))
(defn https-source?
  "A deliberately narrow URL subset shared by JVM/JS. No credentials, port, query or fragment."
  [x]
  (and (string? x)
       (boolean (re-matches #"https://[a-z0-9]+(?:[.-][a-z0-9]+)*/[A-Za-z0-9._~/-]+" x))
       (not (some #{"." ".."} (str/split x #"/")))))

(defn target? [{:keys [platform runtime abi]}]
  (or (and (= platform :android) (= runtime :android)
           (contains? #{:arm64-v8a :armeabi-v7a :x86_64} abi))
      (and (= platform :nixos) (= runtime :native)
           (contains? #{:aarch64 :x86_64} abi))
      (and (= platform :nixos) (= runtime :waydroid)
           (contains? #{:arm64-v8a :x86_64} abi))))

(defn artifact? [{:keys [target format source revision sha256 bytes]}]
  (and (map? target) (target? target)
       (= format (if (= :native (:runtime target)) :nix-archive :apk))
       (https-source? source) (nonblank? revision)
       (digest? sha256) (positive-int? bytes)))

(defn app? [{:keys [id version publisher artifacts requires]}]
  (and (string? id) (boolean (re-matches #"[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+" id))
       (nonblank? version) (nonblank? publisher)
       (vector? artifacts) (seq artifacts) (every? artifact? artifacts)
       (= (count artifacts) (count (set (map :target artifacts))))
       (vector? requires) (every? keyword? requires)))

(defn valid-catalog? [{:keys [schema revision expires-at apps]}]
  (and (= schema "itonami.store.v1") (nonblank? revision)
       (positive-int? expires-at) (vector? apps)
       (every? app? apps)
       (= (count apps) (count (set (map :id apps))))))

(defn plan
  "Select one exact platform/runtime/ABI artifact. Does not fetch, install, verify
  metadata signatures, authorize a request, or assert required APIs work. now is epoch seconds."
  [catalog app-id target now]
  (let [base {:approval-authority :none :installation-authority :none
              :metadata-authenticity :unverified}]
    (merge base
           (cond
             (not (valid-catalog? catalog)) {:status :invalid-catalog}
             (not (and (integer? now) (not (neg? now)))) {:status :invalid-clock}
             (>= now (:expires-at catalog)) {:status :expired-catalog}
             (not (target? target)) {:status :invalid-target}
             :else
             (if-let [app (first (filter #(= app-id (:id %)) (:apps catalog)))]
               (if-let [artifact (first (filter #(= target (:target %)) (:artifacts app)))]
                 {:status :plan-only :app (:id app) :version (:version app)
                  :publisher (:publisher app) :catalog-revision (:revision catalog)
                  :artifact artifact :required-apis (:requires app)
                  :compatibility :unknown
                  :remaining [:authenticate-catalog :fresh-operation-approval
                              :fetch-and-verify :qualify-required-apis
                              :platform-installer-review]}
                 {:status :no-matching-artifact})
               {:status :app-not-found})))))

(def evidence-keys
  [:platform :runtime :abi :os-build :adapter-version :app-id :app-version :case-id])

(defn evidence-status
  "Summarize an imported observation for an exact environment. Reports are not
  cryptographically authenticated here and never become grants or attestation tokens."
  [environment observations]
  (if-not (and (map? environment)
               (every? #(nonblank? (get environment %))
                       [:os-build :adapter-version :app-id :app-version :case-id])
               (target? (select-keys environment [:platform :runtime :abi]))
               (vector? observations))
    :invalid-evidence-query
    (let [matching (filter #(= (select-keys environment evidence-keys)
                              (select-keys % evidence-keys)) observations)]
      (cond
        (empty? matching) :not-tested
        (not-every? #(and (contains? #{:pass :fail} (:result %))
                         (https-source? (:source %))
                         (digest? (:evidence-sha256 %))
                         (positive-int? (:observed-at %))) matching) :invalid-evidence
        (> (count (set (map :result matching))) 1) :conflicting-reports
        (= :fail (:result (first matching))) :reported-fail
        :else :reported-pass))))
