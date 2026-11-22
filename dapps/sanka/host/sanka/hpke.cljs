(ns sanka.hpke
  "HPKE (RFC 9180) in base mode with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and ChaCha20-Poly1305,
  on node:crypto (ADR 0051 D3). nbb only. One context seals or opens one message at sequence 0;
  `export` gives the shared secrets both ends derive from that context.

  Checked against the RFC's test vector A.2.1 in test/host/hpke_test.cljs."
  (:require ["node:crypto" :as crypto]))

(defn- buf [& parts] (js/Buffer.concat (clj->js (map #(if (string? %) (js/Buffer.from % "utf8") %) parts))))
(defn- i2osp [n size] (let [b (js/Buffer.alloc size)] (.writeUIntBE b n 0 size) b))

(def ^:private kem-suite (buf "KEM" (i2osp 0x0020 2)))
(def ^:private hpke-suite (buf "HPKE" (i2osp 0x0020 2) (i2osp 0x0001 2) (i2osp 0x0003 2)))
(def ^:private version (js/Buffer.from "HPKE-v1" "utf8"))
(def ^:private empty-bytes (js/Buffer.alloc 0))

(defn- hmac [key data] (-> (crypto/createHmac "sha256" (if (zero? (.-length key)) (js/Buffer.alloc 32) key))
                           (.update data) (.digest)))

(defn- expand [prk info size]
  (loop [out empty-bytes previous empty-bytes i 1]
    (if (>= (.-length out) size)
      (.subarray out 0 size)
      (let [block (hmac prk (buf previous info (js/Buffer.from #js [i])))]
        (recur (buf out block) block (inc i))))))

(defn- labeled-extract [suite salt label ikm] (hmac salt (buf version suite label ikm)))
(defn- labeled-expand [suite prk label info size] (expand prk (buf (i2osp size 2) version suite label info) size))

;; Raw 32-byte X25519 keys as node KeyObjects.

(defn public-key [raw]
  (crypto/createPublicKey #js {:key #js {:kty "OKP" :crv "X25519" :x (.toString raw "base64url")} :format "jwk"}))

;; The PKCS#8 DER prefix of an X25519 private key (RFC 8410).
(def ^:private pkcs8-x25519 (js/Buffer.from "302e020100300506032b656e04220420" "hex"))

(defn private-key [raw]
  (crypto/createPrivateKey #js {:key (buf pkcs8-x25519 raw) :format "der" :type "pkcs8"}))

(defn raw-public [key-object]
  (js/Buffer.from (.-x (.export (crypto/createPublicKey key-object) #js {:format "jwk"})) "base64url"))

(defn raw-private [key-object]
  (js/Buffer.from (.-d (.export key-object #js {:format "jwk"})) "base64url"))

(defn generate-private
  "A fresh X25519 private key as 32 raw bytes."
  []
  (raw-private (.-privateKey (crypto/generateKeyPairSync "x25519"))))

(defn- dh [sk-raw pk-raw]
  (crypto/diffieHellman #js {:privateKey (private-key sk-raw) :publicKey (public-key pk-raw)}))

(defn- shared-secret [dh-bytes kem-context]
  (let [prk (labeled-extract kem-suite empty-bytes "eae_prk" dh-bytes)]
    (labeled-expand kem-suite prk "shared_secret" kem-context 32)))

(defn- key-schedule [shared info]
  (let [psk-id-hash (labeled-extract hpke-suite empty-bytes "psk_id_hash" empty-bytes)
        info-hash (labeled-extract hpke-suite empty-bytes "info_hash" info)
        context (buf (js/Buffer.from #js [0]) psk-id-hash info-hash)
        secret (labeled-extract hpke-suite shared "secret" empty-bytes)]
    {:key (labeled-expand hpke-suite secret "key" context 32)
     :nonce (labeled-expand hpke-suite secret "base_nonce" context 12)
     :exporter (labeled-expand hpke-suite secret "exp" context 32)
     :shared shared}))

(defn setup-sender
  "The encapsulated key and the sender's context. `ephemeral` (32 raw bytes) is for the test vector;
  leave it out to draw a fresh one."
  ([recipient-public info] (setup-sender recipient-public info (generate-private)))
  ([recipient-public info ephemeral]
   (let [enc (raw-public (private-key ephemeral))]
     {:enc enc
      :context (key-schedule (shared-secret (dh ephemeral recipient-public) (buf enc recipient-public)) info)})))

(defn setup-receiver [enc recipient-private info]
  (let [recipient-public (raw-public (private-key recipient-private))]
    (key-schedule (shared-secret (dh recipient-private enc) (buf enc recipient-public)) info)))

(defn seal [{:keys [key nonce]} aad plaintext]
  (let [cipher (crypto/createCipheriv "chacha20-poly1305" key nonce #js {:authTagLength 16})]
    (.setAAD cipher aad #js {:plaintextLength (.-length plaintext)})
    (buf (.update cipher plaintext) (.final cipher) (.getAuthTag cipher))))

(defn open
  "The plaintext, or nil when the ciphertext does not open with this context."
  [{:keys [key nonce]} aad ciphertext]
  (when (>= (.-length ciphertext) 16)
    (try
      (let [size (- (.-length ciphertext) 16)
            decipher (crypto/createDecipheriv "chacha20-poly1305" key nonce #js {:authTagLength 16})]
        (.setAuthTag decipher (.subarray ciphertext size))
        (.setAAD decipher aad #js {:plaintextLength size})
        (buf (.update decipher (.subarray ciphertext 0 size)) (.final decipher)))
      (catch :default _ nil))))

(defn export [{:keys [exporter]} exporter-context size]
  (labeled-expand hpke-suite exporter "sec" exporter-context size))
