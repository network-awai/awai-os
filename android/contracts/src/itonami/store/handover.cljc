(ns itonami.store.handover
  "Account handover (AWAI-4071, AWAI-3004): protocol data structures and
  verification paths for adding a new Android device from an existing
  iOS/Android Awai account.

  The short-lived challenge binds the new device public key, device name,
  expiry and selected profile scope. QR or cross-device Passkey approval
  does not itself copy a profile or private credential; the profile
  transfer after approval is a separate encrypted envelope for the new
  device. No seed, device PIN, wallet private key or owner authentication
  material is ever copied. Where a scope has no implemented provider the
  transfer reports truthful unavailable/defer instead of fabricating a
  restored state.

  Pure, no I/O, no approval authority. The canonical broker
  (awai.link.v1) carries the challenge and the sealed envelope; this
  namespace only decides whether the payloads are well-formed, current,
  unrevoked and within the selected scope."
  (:require [clojure.string :as str]))

(def schema "awai.handover.v1")

;; Challenge lifetime: mirrors awai.link.v1 REQUEST_MS (10 minutes).
(def challenge-ttl-ms (* 10 60 1000))
;; Session/transfer upper bound: mirrors SESSION_MS (30 days) as the only
;; bound on the eventual account session; the challenge itself stays short.
(def max-device-name 64)

;; Selected-profile scopes that the protocol can name. A scope being named
;; here only means the challenge may bind it; availability of a provider is
;; separate (see implemented-scopes / transfer-status).
(def allowed-scopes
  #{"profile:settings" "profile:home-state" "profile:wnfs-snapshot" "profile:yotei-events"})

;; Scopes with a provider wired in this build. Everything else reports
;; unavailable/defer truthfully instead of pretending to sync.
(def implemented-scopes
  #{"profile:settings" "profile:home-state"})

(def device-re #"^did:key:z[1-9A-HJ-NP-Za-km-z]{20,110}$")
(def topic-re #"^[0-9a-f]{32}$")
(def nonce-re #"^[0-9a-f]{24}$")
(def scope-re #"^[a-z0-9:-]{1,64}$")

(defn- good-text? [x limit]
  (and (string? x)
       (not (str/blank? x))
       (<= (count x) limit)
       ;; No control characters anywhere in a device name or scope label.
       ;; Regex (not int/char iteration) keeps this portable between CLJ
       ;; (Character) and CLJS (single-char string) hosts.
       (nil? (re-find #"[\u0000-\u001F\u007F]" x))))

(defn device-name? [x] (good-text? x max-device-name))
(defn did? [x] (and (string? x) (boolean (re-matches device-re x))))
(defn topic? [x] (and (string? x) (boolean (re-matches topic-re x))))
(defn nonce? [x] (and (string? x) (boolean (re-matches nonce-re x))))
(defn scope? [x] (and (string? x) (boolean (re-matches scope-re x)) (contains? allowed-scopes x)))

(defn valid-scope-vector? [v]
  (and (vector? v)
       (pos? (count v))
       (<= (count v) 8)
       (every? scope? v)
       (= (count v) (count (set v)))))

(defn valid-challenge?
  "Structural shape of a handover challenge. Does not check time, signature
  or revocation — see verify-challenge for those."
  [challenge]
  (let [{:keys [schema device deviceName nonce topic ek exp scope]} challenge]
    (and (= schema schema)
         (did? device)
         (device-name? deviceName)
         (nonce? nonce)
         (topic? topic)
         (string? ek)
         (pos? (count ek))
         ;; exp is epoch milliseconds (number) in the pure domain; JS encodes
         ;; it as ISO-8601 text and parses before calling here.
         (integer? exp)
         (valid-scope-vector? scope))))

(defn challenge-expired? [{:keys [exp]} now]
  (and (integer? exp) (integer? now) (>= now exp)))

(defn scope-subset?
  "Requested scope must be a subset of the scope the user approved."
  [approved requested]
  (and (valid-scope-vector? approved)
       (valid-scope-vector? requested)
       (every? #(contains? (set approved) %) requested)))

(defn transfer-status
  "Truthful availability of a transfer for a scope set. :ready only when
  every requested scope has an implemented provider in this build;
  otherwise :unavailable (the caller must offer defer, never a fake
  restored state)."
  [requested]
  (and (valid-scope-vector? requested)
       (if (every? #(contains? implemented-scopes %) requested)
         :ready
         :unavailable)))

;; -- Envelope for the encrypted selected-profile transfer ----------------
;;
;; The envelope is the ciphertext produced by seal-profile-transfer in
;; otehon/shell/src/identity/handover.js (ECDH P-256 + HKDF + AES-GCM, the
;; same construction as awai.link.v1 responses). The envelope itself never
;; carries plaintext profile data, a private key, a seed or a PIN.

(def forbidden-transfer-keys
  #{"privateKey" "private_key" "seed" "mnemonic" "pin" "password" "secret"
    "walletPrivateKey" "ownerKey" "credential"})

(defn forbidden-keys-present?
  "True when a transfer payload would copy a secret. The protocol refuses
  these keys outright; there is no 'copy owner authentication' path."
  [payload]
  (and (map? payload)
       (boolean (some (fn [k]
                        (let [name (if (keyword? k) (name k) k)]
                          (contains? forbidden-transfer-keys name)))
                      (keys payload)))))

(defn valid-envelope?
  "Structural shape of the sealed profile-transfer envelope. Crypto is
  verified in the JS layer (open-profile-transfer); the domain checks the
  binding fields so a viewer can reason about them without decrypting."
  [envelope]
  (let [{:keys [schema scope device exp ek iv ct]} envelope]
    (and (= schema schema)
         (valid-scope-vector? scope)
         (did? device)
         (integer? exp)
         (string? ek) (pos? (count ek))
         (string? iv) (pos? (count iv))
         (string? ct) (pos? (count ct))
         (<= (count ct) (* 256 1024))
         ;; Envelope plaintext must not smuggle a credential field. The JS
         ;; side rejects these too; the domain verdict is the auditable one.
         (not (map? ct)))))

;; -- State machine -------------------------------------------------------

;; terminal states: completed, cancelled, expired, revoked
(def cancelled-states #{:cancelled})
(def terminal-by-expiry #{:expired :revoked})

(defn- revoked? [revoked device]
  (and (coll? revoked) (boolean (some #(= % device) revoked))))

(defn verify-challenge
  "Full verification of a challenge against the expected device, the
  approved scope, the current time and the revocation set.

  Returns {:ok true :device did :scope scope :status transfer-status}
  or {:ok false :error <keyword>} where keyword is one of
  :invalid-challenge :wrong-device :expired :scope-not-approved
  :revoked :cancelled.

  Phone-loss recovery is a fresh challenge: the new device presents a new
  device key; the lost device's key must be in the revocation set (epoch
  bump on the approving account). This verifier reports :revoked for the
  lost device and :ready/:unavailable for the fresh one, never copying
  material from the lost device."
  [{:keys [challenge device scope now revoked cancelled]}]
  (cond
    (true? cancelled) {:ok false :error :cancelled}
    (not (valid-challenge? challenge)) {:ok false :error :invalid-challenge}
    (not= (:device challenge) device) {:ok false :error :wrong-device}
    (challenge-expired? challenge now) {:ok false :error :expired}
    (revoked? revoked device) {:ok false :error :revoked}
    (not (scope-subset? scope (:scope challenge)))
    {:ok false :error :scope-not-approved}
    :else {:ok true
           :device device
           :scope (:scope challenge)
           :status (transfer-status (:scope challenge))}))

(defn- status-is? [s k]
  ;; CLJ callers pass keywords (:ready), CLJS callers pass JSON strings
  ;; ("ready"). Accept both so the compiled bundle behaves like JVM tests.
  (or (= s k) (and (string? s) (= s (name k)))))

(defn- terminal-status? [status]
  (boolean (some #(status-is? status %) [:cancelled :denied :completed :expired :revoked :deferred])))

(defn handover-next-status
  "Pure transition helper for the handover UI. Given the current status,
  the verified challenge verdict and whether the profile provider is
  wired, returns the next user-visible status:

  :pending :approved :denied :transferring :completed :cancelled
  :expired :revoked :unavailable :deferred

  An unimplemented provider maps to :unavailable (offer explicitly defer),
  never to :completed."
  [{:keys [status verdict]}]
  (cond
    (terminal-status? status) status
    (false? (:ok verdict)) (or (:error verdict) :denied)
    (true? (:ok verdict)) (if (status-is? (:status verdict) :ready)
                            :transferring
                            ;; Truthful unavailable/defer where not implemented.
                            :unavailable)
    (or (status-is? status :pending) (status-is? status :approved)
        (status-is? status :transferring) (status-is? status :unavailable)) status
    :else :pending))

(defn runtime-descriptor
  "Canonical-broker descriptor fragment for the handover operations. The
  bundle uses the same broker construction as identity-entry.js
  (kotoba.app.client-runtime.v1, fresh per-operation consent). Each
  handover step asks the person first; denial sends nothing."
  []
  {:schema "kotoba.app.client-runtime.v1"
   :target "browser"
   :profile "trusted-page-v1"
   :entry "index.html"
   :local-state {:adapter "localstorage" :schema "awai.handover.v1" :version 1}
   :operations
   [{:capability "awai-handover"
     :service "awai-relay"
     :operation "await-handover-approval"
     :consent "each-operation"
     :data-categories ["handover-topic"]
     :endpoint {:origin "https://relay.awai.network"
                :routes [{:method "GET" :path "/:topic/json" :query-params []}]}}
    {:capability "awai-handover"
     :service "awai-relay"
     :operation "deliver-handover-envelope"
     :consent "each-operation"
     :data-categories ["encrypted-profile-envelope"]
     :endpoint {:origin "https://relay.awai.network"
                :routes [{:method "POST" :path "/:topic" :query-params []}]}}]})

;; Aliases kept for the JS bridge naming (single source of truth lives above).
(def handover-schema schema)
(def handover-ttl-ms challenge-ttl-ms)
