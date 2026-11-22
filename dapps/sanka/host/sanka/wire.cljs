(ns sanka.wire
  "What the buyer and the provider must compute the same way, byte for byte (ADR 0051, the host
  protocol in README.md): canonical JSON, CIDs, Ed25519 did:key and document signatures, and the
  sealed messages that go through the mailbox. nbb only.

  Canonical JSON is the provider desk's and the verifier's: sorted keys, no whitespace, non-ASCII
  kept, integers only."
  (:require ["node:crypto" :as crypto]
            [clojure.string :as str]
            [sanka.hpke :as hpke]))

(defn canonical-string [v]
  (cond
    (nil? v) "null"
    (boolean? v) (if v "true" "false")
    (string? v) (js/JSON.stringify v)
    (keyword? v) (js/JSON.stringify (name v))
    (number? v) (if (js/Number.isSafeInteger v) (str v)
                    (throw (ex-info "canonical JSON allows only safe integers" {:value v})))
    (map? v) (str "{" (str/join "," (map (fn [[k x]] (str (js/JSON.stringify (name k)) ":" (canonical-string x)))
                                         (sort-by (comp name key) v)))
                  "}")
    (sequential? v) (str "[" (str/join "," (map canonical-string v)) "]")
    :else (throw (ex-info "no canonical JSON form" {:value v}))))

(defn canonical [v] (js/Buffer.from (canonical-string v) "utf8"))

(defn from-json
  "JSON text as Clojure data with keyword keys, the form sanka.core and sanka.device read."
  [text]
  (js->clj (js/JSON.parse text) :keywordize-keys true))

(defn b64u [bytes] (str/replace (.toString bytes "base64url") #"=+$" ""))
(defn unb64u [text] (js/Buffer.from text "base64url"))
(defn sha256-hex [data] (-> (crypto/createHash "sha256") (.update data) (.digest "hex")))

(def ^:private base32-alphabet "abcdefghijklmnopqrstuvwxyz234567")

(defn- base32 [bytes]
  (loop [i 0 bits 0 acc 0 out []]
    (if (< i (.-length bytes))
      (let [acc (bit-or (bit-shift-left (bit-and acc 0xff) 8) (aget bytes i))
            [out bits] (loop [out out bits (+ bits 8)]
                         (if (>= bits 5)
                           (recur (conj out (nth base32-alphabet (bit-and (unsigned-bit-shift-right acc (- bits 5)) 31)))
                                  (- bits 5))
                           [out bits]))]
        (recur (inc i) bits acc out))
      (apply str (if (pos? bits)
                   (conj out (nth base32-alphabet (bit-and (bit-shift-left acc (- 5 bits)) 31)))
                   out)))))

(defn cid-of
  "CIDv1, dag-json, sha2-256, lower-case base32, as the provider desk computes it."
  [data]
  (str "b" (base32 (js/Buffer.concat #js [(js/Buffer.from #js [0x01 0xa9 0x02 0x12 0x20])
                                          (-> (crypto/createHash "sha256") (.update data) (.digest))]))))

;; ---------------------------------------------------------------------------
;; did:key (Ed25519, multicodec 0xed01, base58btc) and signatures over canonical JSON

(def ^:private base58-alphabet "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

(defn- divmod [digits base from]
  (loop [ds digits rem 0 q []]
    (if (empty? ds)
      [(vec (drop-while zero? q)) rem]
      (let [acc (+ (* rem from) (first ds))]
        (recur (rest ds) (mod acc base) (conj q (quot acc base)))))))

(defn- base58 [bytes]
  (let [all (vec (array-seq bytes))
        zeros (count (take-while zero? all))]
    (loop [n (vec (drop-while zero? all)) out ()]
      (if (empty? n)
        (str (apply str (repeat zeros "1")) (apply str out))
        (let [[q r] (divmod n 58 256)]
          (recur q (cons (nth base58-alphabet r) out)))))))

(defn- unbase58 [text]
  (let [digits (map #(str/index-of base58-alphabet %) text)]
    (when (every? some? digits)
      (let [zeros (count (take-while #(= \1 %) text))]
        (loop [n (vec (drop-while zero? digits)) out ()]
          (if (empty? n)
            (js/Buffer.from (clj->js (concat (repeat zeros 0) out)))
            (let [[q r] (divmod n 256 58)]
              (recur q (cons r out)))))))))

(defn did-of [public-key]
  (let [raw (js/Buffer.from (.-x (.export public-key #js {:format "jwk"})) "base64url")]
    (str "did:key:z" (base58 (js/Buffer.concat #js [(js/Buffer.from #js [0xed 0x01]) raw])))))

(defn- public-of-did [did]
  (when (and (string? did) (str/starts-with? did "did:key:z"))
    (let [raw (unbase58 (subs did 9))]
      (when (and raw (= 34 (.-length raw)) (= 0xed (aget raw 0)) (= 0x01 (aget raw 1)))
        (try (crypto/createPublicKey #js {:key #js {:kty "OKP" :crv "Ed25519"
                                                    :x (.toString (.subarray raw 2) "base64url")}
                                          :format "jwk"})
             (catch :default _ nil))))))

(defn ed25519-key
  "A fresh Ed25519 key as {:private KeyObject :did did:key}."
  []
  (let [pair (crypto/generateKeyPairSync "ed25519")]
    {:private (.-privateKey pair) :did (did-of (.-publicKey pair))}))

(defn sign-document
  "The document with :signer and :signature over its canonical form without :signature."
  [{:keys [private did]} document]
  (let [doc (assoc (dissoc document :signature) :signer did)]
    (assoc doc :signature (b64u (crypto/sign nil (canonical doc) private)))))

(defn signature-ok?
  "True when :signature is good for the Ed25519 did:key named in :signer."
  [document]
  (boolean
   (when-let [public (public-of-did (:signer document))]
     (try (crypto/verify nil (canonical (dissoc document :signature)) public (unb64u (str (:signature document))))
          (catch :default _ false)))))

;; ---------------------------------------------------------------------------
;; Sealed messages (ADR 0051 D3): base64url of the encapsulated key followed by the ciphertext,
;; with an empty AAD. Each message has its own HPKE context.

(def order-kind "awai.compute-order/1")
(def result-kind "awai.compute-result/1")
(def input-label "awai.compute-input/1")

(defn order-info [offer-cid] (js/Buffer.from (str order-kind " " offer-cid) "utf8"))
(defn result-info [offer-cid order-cid] (js/Buffer.from (str result-kind " " offer-cid " " order-cid) "utf8"))

(defn seal-key-bytes
  "The 32 raw bytes of an `x25519:` key, as offers and replies write them."
  [text]
  (js/Buffer.from (subs text (count "x25519:")) "hex"))

(defn seal-key-text [raw] (str "x25519:" (.toString raw "hex")))

(def ^:private empty-aad (js/Buffer.alloc 0))

(defn seal
  "{:message base64url-text :context sender-context}. Keep the context to derive the input key."
  [recipient-key-text info document]
  (let [{:keys [enc context]} (hpke/setup-sender (seal-key-bytes recipient-key-text) info)]
    {:message (b64u (js/Buffer.concat #js [enc (hpke/seal context empty-aad (canonical document))]))
     :context context}))

(defn open
  "{:document data :context receiver-context}, or nil when the message does not open for this key."
  [private-raw info message]
  (let [bytes (unb64u message)]
    (when (> (.-length bytes) 32)
      (let [context (hpke/setup-receiver (.subarray bytes 0 32) private-raw info)]
        (when-let [plain (hpke/open context empty-aad (.subarray bytes 32))]
          (try {:document (from-json (.toString plain "utf8")) :context context}
               (catch :default _ nil)))))))

(defn input-key
  "The key of the receipt's keyed input hash. Only the buyer and the provider can derive it."
  [context]
  (hpke/export context (js/Buffer.from input-label "utf8") 32))

(defn input-hash [key prompt]
  (str "hmac-sha256:" (-> (crypto/createHmac "sha256" key) (.update (js/Buffer.from prompt "utf8")) (.digest "hex"))))

(defn output-cid
  "The receipt's output: the CID of the reply message, as the provider desk records it."
  [output]
  (cid-of (canonical {:content output :role "assistant"})))
