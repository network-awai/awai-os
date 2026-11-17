(ns en-devnet.host
  "Host side of the EN devnet (ADR 0027 V3b, AWAI-3121): wire encoding, Ed25519 keys as did:key,
  and signatures over the exact bytes of `en-devnet.core/signing-payload`. nbb only.

  Wire form: JSON where keyword values are strings starting with \":\" (the same convention as
  the shared cases). Canonical form: sorted keys, no whitespace, integers only."
  (:require ["node:crypto" :as crypto]
            ["node:fs" :as fs]
            [clojure.string :as str]
            [en-devnet.core :as core]))

;; ---------------------------------------------------------------------------
;; Wire and canonical JSON

(defn enc [v]
  (cond (map? v) (into {} (map (fn [[k x]] [(if (keyword? k) (name k) k) (enc x)]) v))
        (sequential? v) (mapv enc v)
        (keyword? v) (str ":" (name v))
        :else v))

(defn dec* [v]
  (cond (map? v) (into {} (map (fn [[k x]] [(keyword k) (dec* x)]) v))
        (vector? v) (mapv dec* v)
        (and (string? v) (pos? (count v)) (= ":" (subs v 0 1))) (keyword (subs v 1))
        :else v))

(defn from-wire [text] (dec* (js->clj (js/JSON.parse text))))

(defn canonical-string [v]
  (cond
    (nil? v) "null"
    (boolean? v) (if v "true" "false")
    (string? v) (js/JSON.stringify v)
    (number? v) (if (js/Number.isSafeInteger v) (str v)
                    (throw (ex-info "canonical JSON allows only safe integers" {:value v})))
    (keyword? v) (canonical-string (str ":" (name v)))
    (map? v) (str "{" (str/join "," (map (fn [[k x]] (str (js/JSON.stringify (if (keyword? k) (name k) (str k)))
                                                         ":" (canonical-string x)))
                                         (sort-by (fn [[k _]] (if (keyword? k) (name k) (str k))) v)))
                  "}")
    (sequential? v) (str "[" (str/join "," (map canonical-string v)) "]")
    :else (throw (ex-info "no canonical JSON form" {:value v}))))

(defn canonical [v] (js/Buffer.from (canonical-string v) "utf8"))
(defn sha256-hex [data] (-> (crypto/createHash "sha256") (.update data) (.digest "hex")))

(defn payload-bytes
  "The bytes each party signs: canonical JSON of the ordered field vector."
  [tx]
  (canonical (core/signing-payload tx)))

;; ---------------------------------------------------------------------------
;; did:key (Ed25519, multicodec 0xed01, base58btc)

(def base58-alphabet "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

(defn- divmod [digits base from]
  (loop [ds digits rem 0 q []]
    (if (empty? ds)
      [(vec (drop-while zero? q)) rem]
      (let [acc (+ (* rem from) (first ds))]
        (recur (rest ds) (mod acc base) (conj q (quot acc base)))))))

(defn base58 [bytes]
  (let [all (vec (array-seq bytes))
        zeros (count (take-while zero? all))]
    (loop [n (vec (drop-while zero? all)) out ()]
      (if (empty? n)
        (str (apply str (repeat zeros "1")) (apply str out))
        (let [[q r] (divmod n 58 256)]
          (recur q (cons (nth base58-alphabet r) out)))))))

(defn unbase58
  "Bytes of a base58 string, or nil."
  [text]
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

(defn public-of-did
  "The Ed25519 public KeyObject a did:key names, or nil."
  [did]
  (when (and (string? did) (str/starts-with? did "did:key:z"))
    (let [raw (unbase58 (subs did 9))]
      (when (and raw (= 34 (.-length raw)) (= 0xed (aget raw 0)) (= 0x01 (aget raw 1)))
        (try (crypto/createPublicKey #js {:key #js {:kty "OKP" :crv "Ed25519"
                                                    :x (.toString (.subarray raw 2) "base64url")}
                                          :format "jwk"})
             (catch :default _ nil))))))

;; ---------------------------------------------------------------------------
;; Keys and signatures

(defn keygen!
  "Create an Ed25519 key file (mode 0600) at path. Refuses to overwrite. Returns the did."
  [path]
  (let [pair (crypto/generateKeyPairSync "ed25519")]
    (fs/writeFileSync path (.export (.-privateKey pair) #js {:type "pkcs8" :format "pem"})
                      #js {:flag "wx" :mode 0600})
    (did-of (.-publicKey pair))))

(defn load-key [path]
  (let [k (crypto/createPrivateKey (fs/readFileSync path "utf8"))]
    {:private k :did (did-of (crypto/createPublicKey k))}))

(defn sign-tx
  "Add this key's signature over the tx payload. Signs only as spender or receiver."
  [{:keys [private did]} tx]
  (when-not (contains? #{(:spender tx) (:receiver tx)} did)
    (throw (ex-info "this key is neither the spender nor the receiver" {:cause :not-a-party})))
  (let [sig (str/replace (.toString (crypto/sign nil (payload-bytes tx) private) "base64url") #"=+$" "")]
    (update tx :signatures (fn [s] (conj (vec (remove #(= did (:signer %)) s)) {:signer did :sig sig})))))

(defn verify-sig [did bytes sig]
  (let [pk (public-of-did did)]
    (boolean (and pk (string? sig)
                  (try (crypto/verify nil bytes pk (js/Buffer.from sig "base64url"))
                       (catch :default _ false))))))

(defn verified-tx
  "The tx as the core expects it: each wire signature replaced by the host's verification result
  over this tx's payload bytes."
  [tx]
  (let [bytes (payload-bytes tx)]
    (assoc tx :signatures
           (mapv (fn [{:keys [signer sig]}]
                   {:signer signer
                    :verified (verify-sig signer bytes sig)
                    :payload (core/signing-payload tx)})
                 (:signatures tx)))))
