(ns itonami.otehon.oauth
  "The pure heads of itonami.agent.oauth (MCP interactive OAuth login):
  the token-cache file stem, PKCE S256 over a pure SHA-256, the
  authorization params, discovery fallback, registration body/record
  and the token-cache record. The legacy host is .cljk on Node, so
  JS value semantics (substring clamping, parseInt prefixes) rule.

  Host-side and staying S6: random verifiers, fetch, the loopback
  listener, URL serialization, the token endpoint, the 0600 file
  writes, clock reads and the login/device flows."
  (:require [clojure.string :as str]))

(defn store-name
  "The mcp-tokens file stem for one server: anything but [A-Za-z0-9_]
  becomes _, cut to 128 chars. The cut is a clamp: the legacy host
  (.cljk on Node) runs `subs` on JS substring semantics, which keeps a
  short string whole instead of throwing the way JVM Clojure does."
  [server]
  (let [s (str/replace (str server) #"[^A-Za-z0-9_]" "_")]
    (subs s 0 (min 128 (count s)))))

;; ---------------------------------------------------------------- SHA-256 (FIPS 180-4)

(def ^:private m32 4294967296)

(defn- pow2 [n] (apply * (repeat n 2)))

(defn- add32 [& xs] (mod (apply + xs) m32))

(defn- land [a b] (mod (bit-and a b) m32))

(defn- lxor
  ([a b] (mod (bit-xor a b) m32))
  ([a b & more] (reduce lxor (lxor a b) more)))

(defn- rotr32
  "Rotate the 32-bit word `x` right by `n` (0 < n < 32), split so every
  product stays below 2^32. Exact on every runner."
  [x n]
  (let [k (pow2 n)]
    (+ (quot x k) (* (mod x k) (pow2 (- 32 n))))))

(defn- shr32
  "Logical right shift (the schedule sigmas), exact by construction."
  [x n]
  (quot x (pow2 n)))

(defn- sha256-bytes
  "SHA-256 over a byte vector. Same exactness discipline as the
  vault SHA-1: mod-2^32 adds, masked word ops, split rotates."
  [data]
  (let [data (vec data)
        n (count data)
        bitlen (* 8 n)
        msg (vec (concat data [128] (repeat (mod (- 55 n) 64) 0)
                         (mapv (fn [i] (mod (quot (quot bitlen m32) (pow2 (* 8 (- 3 i)))) 256))
                               (range 4))
                         (mapv (fn [i] (mod (quot bitlen (pow2 (* 8 (- 3 i)))) 256))
                               (range 4))))
        h0 [0x6A09E667 0xBB67AE85 0x3C6EF372 0xA54FF53A 0x510E527F 0x9B05688C 0x1F83D9AB 0x5BE0CD19]
        kk [0x428A2F98 0x71374491 0xB5C0FBCF 0xE9B5DBA5 0x3956C25B 0x59F111F1 0x923F82A4 0xAB1C5ED5
            0xD807AA98 0x12835B01 0x243185BE 0x550C7DC3 0x72BE5D74 0x80DEB1FE 0x9BDC06A7 0xC19BF174
            0xE49B69C1 0xEFBE4786 0x0FC19DC6 0x240CA1CC 0x2DE92C6F 0x4A7484AA 0x5CB0A9DC 0x76F988DA
            0x983E5152 0xA831C66D 0xB00327C8 0xBF597FC7 0xC6E00BF3 0xD5A79147 0x06CA6351 0x14292967
            0x27B70A85 0x2E1B2138 0x4D2C6DFC 0x53380D13 0x650A7354 0x766A0ABB 0x81C2C92E 0x92722C85
            0xA2BFE8A1 0xA81A664B 0xC24B8B70 0xC76C51A3 0xD192E819 0xD6990624 0xF40E3585 0x106AA070
            0x19A4C116 0x1E376C08 0x2748774C 0x34B0BCB5 0x391C0CB3 0x4ED8AA4A 0x5B9CCA4F 0x682E6FF3
            0x748F82EE 0x78A5636F 0x84C87814 0x8CC70208 0x90BEFFFA 0xA4506CEB 0xBEF9A3F7 0xC67178F2]
        h (loop [blocks (partition 64 msg) h h0]
            (if (empty? blocks)
              h
              (let [block (vec (first blocks))
                    w16 (mapv (fn [i] (+ (* (nth block (* 4 i)) 16777216)
                                         (* (nth block (+ (* 4 i) 1)) 65536)
                                         (* (nth block (+ (* 4 i) 2)) 256)
                                         (nth block (+ (* 4 i) 3))))
                              (range 16))
                    w (reduce (fn [w i]
                                (conj w (add32 (lxor (rotr32 (nth w (- i 2)) 17) (rotr32 (nth w (- i 2)) 19) (shr32 (nth w (- i 2)) 10))
                                               (nth w (- i 7))
                                               (lxor (rotr32 (nth w (- i 15)) 7) (rotr32 (nth w (- i 15)) 18) (shr32 (nth w (- i 15)) 3))
                                               (nth w (- i 16)))))
                              w16 (range 16 64))
                    [a b c d e f g hh]
                    (loop [i 0 a (nth h 0) b (nth h 1) c (nth h 2) d (nth h 3)
                           e (nth h 4) f (nth h 5) g (nth h 6) hh (nth h 7)]
                      (if (= i 64)
                        [a b c d e f g hh]
                        (let [s1 (lxor (rotr32 e 6) (rotr32 e 11) (rotr32 e 25))
                              ch (lxor (land e f) (land (lxor e 4294967295) g))
                              t1 (add32 hh s1 ch (nth kk i) (nth w i))
                              s0 (lxor (rotr32 a 2) (rotr32 a 13) (rotr32 a 22))
                              maj (lxor (land a b) (land a c) (land b c))
                              t2 (add32 s0 maj)]
                          (recur (inc i) (add32 t1 t2) a b c (add32 d t1) e f g))))]
                (recur (rest blocks)
                       [(add32 (nth h 0) a) (add32 (nth h 1) b)
                        (add32 (nth h 2) c) (add32 (nth h 3) d)
                        (add32 (nth h 4) e) (add32 (nth h 5) f)
                        (add32 (nth h 6) g) (add32 (nth h 7) hh)]))))]
    (vec (mapcat (fn [word]
                   (mapv (fn [i] (mod (quot word (pow2 (* 8 (- 3 i)))) 256))
                         (range 4)))
                 h))))

;; ---------------------------------------------------------------- PKCE (RFC 7636)

(def ^:private b64url-alphabet "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")

(def ^:private ascii-table
  (apply str (map char (range 128))))

(defn- utf8-bytes
  "ASCII bytes of a string. RFC 7636 verifiers are ASCII-only
  (unreserved characters); anything else throws fail-closed instead
  of guessing UTF-8 codepoints the runners derive differently."
  [s]
  (mapv (fn [ch]
          (let [i (str/index-of ascii-table (str ch))]
            (when (nil? i)
              (throw (ex-info "non-ASCII PKCE verifier" {:char (str ch)})))
            i))
        (str s)))

(defn- b64url-bytes
  "URL-safe base64 over a byte vector (no padding), three bytes at a
  time so every intermediate stays below 2^24. The encoder the S256
  challenge needs; the random verifier bytes stay host-side."
  [data]
  (let [group-chars {1 2, 2 3, 3 4}
        enc (fn [grp]
              (let [nbytes (count grp)
                    nchars (group-chars nbytes)
                    ;; the group value, then right-padded with zero bits
                    ;; to fill nchars*6 bits
                    v (* (reduce (fn [a b] (+ (* a 256) b)) 0 grp)
                         (pow2 (- (* nchars 6) (* nbytes 8))))]
                (apply str (map (fn [i]
                                  (nth b64url-alphabet
                                       (mod (quot v (pow2 (* 6 (- (dec nchars) i)))) 64)))
                                (range nchars)))))]
    (apply str (map enc (partition-all 3 data)))))

(defn verify-challenge
  "The S256 code challenge of a verifier (RFC 7636 §4.2)."
  [verifier]
  (b64url-bytes (sha256-bytes (utf8-bytes verifier))))

(defn pkce-pair
  "The PKCE request pair for an explicit verifier (generation of the
  43-128 char random verifier stays host-side, S6)."
  [verifier]
  {"code_verifier" (str verifier)
   "code_challenge" (verify-challenge verifier)
   "code_challenge_method" "S256"})

;; ---------------------------------------------------------------- shapes

(defn auth-params
  "The authorization query params. Scope rides along only when
  non-blank; URL serialization stays host-side."
  [client redirect-uri challenge state scope]
  (cond-> {"response_type" "code"
           "client_id" (str (get client "client_id"))
           "redirect_uri" (str redirect-uri)
           "state" (str state)
           "code_challenge" (str (get challenge "code_challenge"))
           "code_challenge_method" "S256"}
    (not (str/blank? (str scope))) (assoc "scope" (str scope))))

(defn discovery-record
  "The metadata record: the well-known document wins, and every
  missing endpoint falls back to the MCP host (the MCP-spec
  fallback), except device_authorization_endpoint which stays nil
  when unadvertised."
  [doc origin]
  (let [m (or doc {})]
    {"issuer" (or (get m "issuer") (str origin))
     "authorization_endpoint" (get m "authorization_endpoint" (str origin "/authorize"))
     "token_endpoint" (or (get m "token_endpoint") (str origin "/token"))
     "registration_endpoint" (or (get m "registration_endpoint") (str origin "/register"))
     "device_authorization_endpoint" (get m "device_authorization_endpoint")}))

(defn registration-body
  "The RFC 7591 dynamic client registration body (verbatim)."
  [redirect-uris]
  {"client_name" "itonami-agent"
   "redirect_uris" (vec redirect-uris)
   "grant_types" ["authorization_code" "refresh_token" "urn:ietf:params:oauth:grant-type:device_code"]
   "response_types" ["code"]
   "token_endpoint_auth_method" "none"})

(defn registration-record
  "The client record kept from a registration response."
  [m]
  {"client_id" (get m "client_id")
   "client_secret" (get m "client_secret")
   "token_endpoint_auth_method" (get m "token_endpoint_auth_method" "none")})

(defn- parse-long
  "parseInt with a default: leading-digit prefix semantics, nil-safe,
  NaN upstream becomes the default. (browser.cljc owns the shared
  parse-digits; this two-line local keeps the module self-contained.)"
  [s default]
  (let [m (re-matches #"\s*([+-]?)([0-9]+).*" (str s))]
    (if-not m
      default
      (let [ds (map #(str/index-of "0123456789" (str %)) (nth m 2))]
        (if (every? some? ds)
          (let [n (reduce (fn [a d] (+ (* a 10) d)) 0 ds)]
            (if (= "-" (nth m 1)) (- n) n))
          default)))))

(defn token-record
  "The token-cache record: the known token fields plus the computed
  expiry and the issuer binding, at an explicit now (the clock read
  stays host-side, S6)."
  [tokens meta now-s]
  (let [expires-in (parse-long (get tokens "expires_in" "3600") 3600)]
    (merge (select-keys tokens ["access_token" "refresh_token" "expires_in" "token_type"])
           {"expires_at" (+ now-s expires-in)
            "hermes_issuer" (get meta "issuer")})))
