(ns itonami-identity.core
 (:require [clojure.string :as str] [itonami-identity.mail :as m]
  #?(:clj [itonami-identity.custody :as c]) #?(:clj [itonami-identity.ledger :as ledger])
  #?(:clj [itonami-chat.database :as db]) #?(:clj [itonami.otehon.ed25519 :as ed])
  #?(:clj [cheshire.core :as j]))
 #?(:clj (:import [java.security KeyFactory Signature] [java.security.spec PKCS8EncodedKeySpec X509EncodedKeySpec] [java.time Instant])))
#?(:clj
 (do
  (defn db! [cfg key thread op events & [basis]]
   (db/operation! (str (:identityRoot cfg) "/private-db") (cond-> {:thread thread :op op :events events} (not= op "history") (assoc :basis basis)) key))
  (defn binding-statement [b] (j/generate-string (m/binding-data b)))
  (defn private-key [seed id epoch]
   (let [md (java.security.MessageDigest/getInstance "SHA-256")]
    (.update md seed) (.update md (byte-array 1)) (.update md (.getBytes (if (zero? epoch) id (str id "#" epoch)) "UTF-8"))
    (let [leaf (.digest md) prefix (byte-array (map unchecked-byte [48 46 2 1 0 48 5 6 3 43 101 112 4 34 4 32]))]
     (try (.generatePrivate (KeyFactory/getInstance "Ed25519") (PKCS8EncodedKeySpec. (byte-array (concat prefix leaf))))
      (finally (java.util.Arrays/fill leaf (byte 0)))))))
  (defn sign-binding [seed b]
   (let [s (Signature/getInstance "Ed25519")]
    (.initSign s (private-key seed (:derivationId b) (:epoch b))) (.update s (.getBytes (binding-statement b) "UTF-8"))
    (assoc b :signature (.encodeToString (java.util.Base64/getEncoder) (.sign s)))))
  (defn verify-binding! [b]
   (m/require! (and (m/uuid? (:principalId b)) (m/bot? (:botId b)) (integer? (:epoch b)) (<= 0 (:epoch b)) (not (:revoked b))) "mail-binding-required")
   (let [z (second (re-matches #"did:key:z([1-9A-HJ-NP-Za-km-z]{40,60})" (str (:did b))))
         _ (m/require! z "mail-binding-required") alphabet "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
         n (reduce (fn [a ch] (+ (* a 58N) (.indexOf alphabet (str ch)))) 0N z)
         bytes (.toByteArray (biginteger n)) raw (if (and (> (count bytes) 34) (zero? (first bytes))) (rest bytes) (seq bytes))
         _ (m/require! (and (= 34 (count raw)) (= [237 1] (mapv #(bit-and 255 %) (take 2 raw)))) "mail-binding-required")
         prefix [48 42 48 5 6 3 43 101 112 3 33 0]
         key (.generatePublic (KeyFactory/getInstance "Ed25519") (X509EncodedKeySpec. (byte-array (concat prefix (drop 2 raw)))))
         signature (Signature/getInstance "Ed25519")]
    (.initVerify signature key) (.update signature (.getBytes (binding-statement b) "UTF-8"))
    (m/require! (.verify signature (.decode (java.util.Base64/getDecoder) ^String (:signature b))) "mail-binding-required") b))
  (defn local-binding [cfg key bot]
   (let [v (db! cfg key (db/sha (str "identity/" (:identityNamespace cfg) "/" bot)) "history" [])]
    {:binding (some-> v :messages last :text (j/parse-string true)) :store (:store v)}))
  (defn enroll! [cfg key seed bot client]
   (m/require! (m/bot? bot) "invalid-bot")
   (let [{:keys [binding store]} (local-binding cfg key bot)
         _ (when-not binding (m/require! (:identityAutoEnroll cfg) "identity-enrollment-policy-required"))
         id (or (:derivationId binding) (subs bot 8))
         did (or (:did binding) (ed/did-of (mapv #(bit-and 255 %) seed) id 0))
         candidate (or binding (sign-binding seed {:principalId (str (java.util.UUID/randomUUID)) :botId bot :derivationId id :did did :epoch 0 :actions ["list" "issue" "stop"]}))
         k (ledger/key-for (:identityNamespace cfg) (db/sha (str "agent/" bot)))
         committed (or ((:read client) k) ((:claim client) k candidate))]
    (m/require! (and (= (:did committed) did) (= (:botId committed) bot) (= (:epoch committed) 0)) "identity-recovery-required")
    (verify-binding! committed)
    (if binding (do (m/require! (= binding committed) "identity-registry-conflict") {:binding binding :store store})
     (let [v (db! cfg key (db/sha (str "identity/" (:identityNamespace cfg) "/" bot)) "append"
                   [{:id "enrollment" :role "session" :at (str (Instant/now)) :text (j/generate-string committed)}] (:headCid store))]
      (m/require! (= committed (j/parse-string (get-in v [:messages 0 :text]) true)) "identity-readback-unconfirmed")
      {:binding committed :store (:store v)}))))
  (defn aliases! [cfg key b request client]
   (verify-binding! b)
   (let [thread (db/sha (str "itonami/private-mail-alias/v1\u0000" (:principalId b) "\u0000" (:botId b)))
         initial (db! cfg key thread "history" [])
         intent-thread (db/sha (str thread "/private-intents"))
         intents (db! cfg key intent-thread "history" [])
         now (System/currentTimeMillis) at (str (Instant/ofEpochMilli now))
         authority-key (ledger/key-for (:identityNamespace cfg) (db/sha (str "mail-head/" (:principalId b) "/" (:botId b))))
         observed ((:read client) authority-key)
         pending-row (when (= "pending" (:state observed)) (first (filter #(= (:requestId observed) (:id %)) (:messages intents))))
         pending-event (some-> pending-row :text (j/parse-string true))
         has-local? (some #(= (:requestId observed) (:id %)) (:messages initial))
         resume? (and pending-row (not has-local?) (= (:basis observed) (get-in initial [:store :headCid]))
                      (= (:eventSha observed) (db/sha (:text pending-row))) (= (:requestSha observed) (:requestSha pending-event))
                      (= (:principalId b) (:principalId pending-event)) (= (:botId b) (:botId pending-event)) (= (:did b) (:did pending-event)))
         old (if resume? (db! cfg key thread "append" [pending-row] (get-in initial [:store :headCid])) initial)
         events (mapv #(j/parse-string (:text %) true) (:messages old))
         completed (when (= "pending" (:state observed)) (first (filter #(and (= (:requestId observed) (:requestId %)) (= (:requestSha observed) (:requestSha %))) events)))
         _ (when completed (m/require! ((:cas client) authority-key observed {:state "committed" :headCid (get-in old [:store :headCid])}) "mail-basis-changed"))
         authority (if completed ((:read client) authority-key) observed)
         args {:now now :at at :aliasId (c/hex (c/random-bytes 16)) :local (c/hex (c/random-bytes 20))
               :requestSha (db/sha (j/generate-string (m/request-data request (:principalId b))))
               :expiryMs (when (:expiresAt request) (try (.toEpochMilli (Instant/parse (:expiresAt request))) (catch Exception _ nil)))}
         planned (m/plan b events request args)
         own-pending? (and (= "pending" (:state authority)) (= (:requestId authority) (:requestId request)) (= (:requestSha authority) (:requestSha args)))
         _ (m/require! (or (and (not= "pending" (:state authority)) (= (:headCid authority) (get-in old [:store :headCid])))
                           (and own-pending? (= (:basis authority) (get-in old [:store :headCid])))) "identity-store-stale")
         _ (when (:event planned) (m/require! (and (contains? request :basis) (= (:basis request) (get-in old [:store :headCid]))) "mail-basis-changed"))
         prior-intent (first (filter #(= (:requestId request) (:id %)) (:messages intents)))
         intent (when-let [e (:event planned)] (or prior-intent {:id (:requestId request) :role "session" :text (j/generate-string e) :at at}))
         _ (when prior-intent (m/require! (= (:requestSha args) (:requestSha (j/parse-string (:text prior-intent) true))) "mail-request-conflict"))
         _ (when (and intent (nil? prior-intent)) (db! cfg key intent-thread "append" [intent] (get-in intents [:store :headCid])))
         pending {:state "pending" :basis (get-in old [:store :headCid]) :requestId (:requestId request) :requestSha (:requestSha args) :eventSha (when intent (db/sha (:text intent)))}
         _ (when (:event planned) (m/require! (or own-pending? ((:cas client) authority-key authority pending)) "mail-basis-changed"))
         saved (if intent (db! cfg key thread "append" [intent] (get-in old [:store :headCid])) old)
         _ (when (:event planned) (m/require! ((:cas client) authority-key pending {:state "committed" :headCid (get-in saved [:store :headCid])}) "mail-result-unconfirmed"))]
    (merge {:schema "itonami.mail-alias-result.v1" :botId (:botId b) :basis (get-in saved [:store :headCid]) :store (:store saved) :routing "not-provisioned"}
           (m/directory (mapv #(j/parse-string (:text %) true) (:messages saved)) b now))))
  (defn operation! [cfg request]
   (c/locked cfg
    (fn []
     (when (= "boot" (:action request)) (c/initialize! cfg))
     (when (= "restore-recovery" (:action request)) (c/restore-recovery! cfg (:bundle request) (:ownerKeyFile request)))
     (when (= "recover" (:action request)) (c/recover! cfg))
     (c/with-custody cfg
      (fn [key seed]
       (let [client (ledger/client cfg) root-key (ledger/key-for (:identityNamespace cfg) (db/sha "namespace-root"))
             root (or ((:read client) root-key) ((:claim client) root-key {:schema "itonami.identity-root.v1" :keySha256 (:keySha256 (c/marker cfg))}))]
        (m/require! (= (:keySha256 root) (:keySha256 (c/marker cfg))) "identity-recovery-required")
        (cond
         (= "export-recovery" (:action request)) (c/export-recovery! cfg (:output request))
         (= "boot" (:action request))
         (do (m/require! (and (:identityAutoEnroll cfg) (vector? (:bots request)) (<= (count (:bots request)) 1000)) "identity-enrollment-policy-required")
          {:schema "itonami.identity-boot.v1" :verified (count (mapv #(enroll! cfg key seed % client) (:bots request))) :namespace (:identityNamespace cfg)})
         :else (let [{:keys [binding store]} (enroll! cfg key seed (:botId request) client)]
          (if (contains? #{"status" "recover" "restore-recovery"} (:action request))
           {:schema "itonami.identity-status.v1" :state "verified" :botId (:botId binding) :principalId (:principalId binding) :did (:did binding) :epoch (:epoch binding) :store store}
           (aliases! cfg key binding request client))))))))))
  (defn -main [& _]
   (try (let [{:keys [config request]} (j/parse-string (slurp *in*) true)] (println (j/generate-string (operation! config request))))
    (catch Exception e (println (j/generate-string {:error (if (contains? #{"identity-recovery-required" "identity-store-stale" "mail-binding-required" "mail-basis-changed" "mail-request-conflict" "mail-alias-not-found" "invalid-mail-request" "identity-custody-required" "keychain-unavailable" "identity-enrollment-policy-required"} (ex-message e)) (ex-message e) "identity-operation-unconfirmed")})))))))
