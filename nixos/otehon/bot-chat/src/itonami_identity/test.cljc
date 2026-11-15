(ns itonami-identity.test
 (:require [clojure.test :refer [deftest is testing run-tests]] [clojure.java.io :as io]
  [clojure.java.shell :as sh]
  [itonami-identity.core :as i] [itonami-identity.custody :as c] [itonami-identity.mail :as m] [cheshire.core :as j]))
(defn config [] (let [root (str (or (System/getenv "CHAT_TEST_ROOT") (str (System/getProperty "user.dir") "/.agent-output")) "/identity-" (java.util.UUID/randomUUID))]
 {:identityRoot root :identityNamespace (str "fixture-" (java.util.UUID/randomUUID)) :identityFixture true :identityAutoEnroll true
  :identityCustody {:type "fixture" :root (str root "/credentials")} :fixtureLedgerRoot (str root "/ledger")}))
(def bot "profile:fixture")
(defn boot [cfg] (i/operation! cfg {:action "boot" :bots [bot]}))
(defn issue [cfg view] (i/operation! cfg {:botId bot :action "issue" :requestId (str (java.util.UUID/randomUUID)) :basis (:basis view) :purpose "PRIVATE_PURPOSE_CANARY" :counterparty "PRIVATE_PARTY_CANARY"}))
(deftest persistent-identity-and-mail
 (let [cfg (config) _ (boot cfg) identity (i/operation! cfg {:botId bot :action "status"}) view (i/operation! cfg {:botId bot :action "list"})
       request {:botId bot :action "issue" :requestId (str (java.util.UUID/randomUUID)) :basis (:basis view) :purpose "PRIVATE_PURPOSE_CANARY" :counterparty "PRIVATE_PARTY_CANARY"}
       saved (i/operation! cfg request)]
  (is (= "verified" (:state identity))) (is (m/uuid? (:principalId identity))) (is (.startsWith (:did identity) "did:key:z6Mk"))
  (boot cfg) (is (= identity (i/operation! (into {} cfg) {:botId bot :action "status"})))
  (is (= saved (i/operation! cfg request)))
  (is (thrown? Exception (i/operation! cfg (assoc request :purpose "changed"))))
  (is (thrown? Exception (issue cfg view)))
  (let [second (issue cfg saved) first-id (get-in saved [:aliases 0 :aliasId])
        stopped (i/operation! cfg {:botId bot :action "stop" :requestId (str (java.util.UUID/randomUUID)) :basis (:basis second) :aliasId first-id})]
   (is (= 2 (count (:aliases second)))) (is (= 2 (count (set (map :address (:aliases second))))))
   (is (thrown? Exception (m/usable-alias stopped first-id)))
   (is (= stopped (i/operation! cfg {:botId bot :action "list"}))))
  (doseq [file (file-seq (io/file (str (:identityRoot cfg) "/private-db"))) :when (.isFile file)
          text ["PRIVATE_PURPOSE_CANARY" "PRIVATE_PARTY_CANARY" (:did identity) (:principalId identity) (get-in saved [:aliases 0 :address])]]
   (is (not (.contains (String. (java.nio.file.Files/readAllBytes (.toPath file)) "ISO-8859-1") text))))))
(deftest recovery-does-not-rename
 (let [cfg (config) _ (boot cfg) old (i/operation! cfg {:botId bot :action "status"})
       saved (issue cfg (i/operation! cfg {:botId bot :action "list"}))
       primary (io/file (get-in cfg [:identityCustody :root]) (str (:identityNamespace cfg) "-primary.key"))]
  (java.nio.file.Files/move (.toPath primary) (.toPath (io/file (str primary ".preserved"))) (make-array java.nio.file.CopyOption 0))
  (is (thrown? Exception (boot cfg)))
  (is (thrown? Exception (i/operation! cfg {:botId bot :action "list"})))
  (is (= old (i/operation! cfg {:botId bot :action "recover"})))
  (is (= saved (i/operation! cfg {:botId bot :action "list"}))))
 (let [cfg (config) _ (boot cfg) p (str (:identityRoot cfg) "/recovery.sealed")]
  (c/file! p (.getBytes "tampered") true)
  (is (thrown? Exception (i/operation! cfg {:botId bot :action "recover"})))))
(deftest registry-and-proof-refusal
 (let [cfg (config) _ (boot cfg)]
  (c/locked cfg #(c/with-custody cfg (fn [key _]
   (let [b (:binding (i/local-binding cfg key bot))]
    (is (= b (i/verify-binding! b)))
    (is (thrown? Exception (i/verify-binding! (assoc b :principalId (str (java.util.UUID/randomUUID))))))
    (is (thrown? Exception (i/verify-binding! (assoc b :revoked true))))))))
  (is (thrown? Exception (i/operation! (assoc cfg :identityNamespace "foreign-namespace") {:botId bot :action "status"})))
  (is (thrown? Exception (i/operation! cfg {:botId "../other" :action "status"}))))
 (is (thrown? Exception (boot (assoc (config) :identityFixture false)))))
(deftest portable-owner-recovery
 (let [cfg (config) _ (boot cfg) old (i/operation! cfg {:action "status" :botId bot})
       saved (issue cfg (i/operation! cfg {:action "list" :botId bot}))
       backup (i/operation! cfg {:action "export-recovery" :output (str (:identityRoot cfg) "/owner-backup")})
       target (assoc cfg :identityRoot (str (:identityRoot cfg) "-restored") :identityCustody {:type "fixture" :root (str (:identityRoot cfg) "-new-credentials")})]
  (is (= old (i/operation! target {:action "restore-recovery" :botId bot :bundle (:bundle backup) :ownerKeyFile (:ownerKeyFile backup)})))
  (is (= saved (i/operation! target {:action "list" :botId bot})))
  (is (thrown? Exception (i/operation! target {:action "restore-recovery" :botId bot :bundle (:bundle backup) :ownerKeyFile (:ownerKeyFile backup)})))
  (let [bad (str (:identityRoot cfg) "/wrong-recovery.key")]
   (c/file! bad (c/random-bytes 32) false)
   (is (thrown? Exception (i/operation! (assoc target :identityRoot (str (:identityRoot cfg) "-wrong")) {:action "restore-recovery" :botId bot :bundle (:bundle backup) :ownerKeyFile bad}))))))
(defn child [cfg request]
 (let [r (sh/sh "bb" "--classpath" (System/getenv "IDENTITY_TEST_CP") "-m" "itonami-identity.core" :in (j/generate-string {:config cfg :request request}))
       v (when (zero? (:exit r)) (j/parse-string (:out r) true))]
  (is (and v (nil? (:error v)))) v))
(deftest independent-process-restart-and-racing-enrollment
 (when (System/getenv "IDENTITY_TEST_CP")
  (let [cfg (config) _ (child cfg {:action "boot" :bots [bot]}) first (child cfg {:action "status" :botId bot})
        _ (child cfg {:action "boot" :bots [bot]}) again (child cfg {:action "status" :botId bot})
        backup (child cfg {:action "export-recovery" :output (str (:identityRoot cfg) "/process-backup")})
        other (assoc cfg :identityRoot (str (:identityRoot cfg) "-process-peer") :identityCustody {:type "fixture" :root (str (:identityRoot cfg) "-peer-credentials")})]
   (is (= first again))
   (child other {:action "restore-recovery" :botId bot :bundle (:bundle backup) :ownerKeyFile (:ownerKeyFile backup)})
   (let [a (future (child cfg {:action "status" :botId "profile:race"})) b (future (child other {:action "status" :botId "profile:race"}))
         pick #(select-keys % [:principalId :did :epoch])]
    (is (= (pick @a) (pick @b)))))))
(defn -main [& _] (let [r (run-tests 'itonami-identity.test)] (when (pos? (+ (:fail r) (:error r))) (System/exit 1))))
