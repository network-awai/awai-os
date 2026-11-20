(ns itonami.otehon.vault
  "The credential-vault pure store core. Faithful port of the pure
  projections of itonami.agent.vault (the local encrypted login store
  behind `itonami-agent vault add/list/remove` and the browser_vault
  tools): login records are plain maps under string keys (\"label\",
  \"username\", \"password\", \"origin\", \"totp_seed\") keyed by handle,
  and every unit here takes that store map explicitly.

  Host-side and staying S6: the encrypted file (vault.json.enc +
  the 0600 key file, AES-256-GCM via node:crypto), handle generation
  (`vh-` + random hex), the stdin password read, the default clock
  and the CLI itself."
  (:require [clojure.string :as str]))

(def ^:private m32 4294967296)

(defn- pow2
  "2^n by repeated multiplication: exact on every runner (powers of two
  are exact doubles), unlike host bit-shifts past the sign bit."
  [n]
  (apply * (repeat n 2)))

(defn- add32 [& xs] (mod (apply + xs) m32))

;; Masked word ops: host bit ops may sign-extend (nbb coerces through
;; int32), so every result is reinterpreted mod 2^32 immediately. All
;; inputs are non-negative words, so the bit pattern is always right
;; and `mod` restores the unsigned value.
(defn- land [a b] (mod (bit-and a b) m32))
(defn- lor
  ([a b] (mod (bit-or a b) m32))
  ([a b & more] (reduce lor (lor a b) more)))
(defn- lxor
  ([a b] (mod (bit-xor a b) m32))
  ([a b & more] (reduce lxor (lxor a b) more)))

(defn- rotl32
  "Rotate the 32-bit word `x` left by `n` (0 < n < 32), split so every
  product stays below 2^32: `(lo * 2^n) + hi`. Exact everywhere."
  [x n]
  (let [k (pow2 (- 32 n))]
    (+ (* (mod x k) (pow2 n)) (quot x k))))

(defn- sha1-bytes
  "SHA-1 over a byte vector (FIPS 180-4). Pure: every add is mod 2^32,
  every rotate is rotl32, XOR only sees non-negative words."
  [data]
  (let [data (vec data)
        n (count data)
        bitlen (* 8 n)
        len-bytes (mapv (fn [i] (mod (quot bitlen (pow2 (* 8 (- 7 i)))) 256))
                        (range 8))
        msg (vec (concat data [128] (repeat (mod (- 55 n) 64) 0) len-bytes))
        h0 [0x67452301 0xEFCDAB89 0x98BADCFE 0x10325476 0xC3D2E1F0]
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
                                (conj w (rotl32 (lxor (nth w (- i 3)) (nth w (- i 8))
                                                (nth w (- i 14)) (nth w (- i 16)))
                                                 1)))
                              w16 (range 16 80))
                    [a b c d e]
                    (loop [i 0 a (nth h 0) b (nth h 1) c (nth h 2)
                           d (nth h 3) e (nth h 4)]
                      (if (= i 80)
                        [a b c d e]
                        (let [[f k] (cond (< i 20) [(lor (land b c)
                                                            (land (lxor b 4294967295) d))
                                                     0x5A827999]
                                            (< i 40) [(lxor b c d) 0x6ED9EBA1]
                                            (< i 60) [(lor (land b c)
                                                           (land b d)
                                                           (land c d))
                                                       0x8F1BBCDC]
                                            :else [(lxor b c d) 0xCA62C1D6])
                              t (add32 (rotl32 a 5) f e k (nth w i))]
                          (recur (inc i) t a (rotl32 b 30) c d))))]
                (recur (rest blocks)
                       [(add32 (nth h 0) a) (add32 (nth h 1) b)
                        (add32 (nth h 2) c) (add32 (nth h 3) d)
                        (add32 (nth h 4) e)]))))]
    (vec (mapcat (fn [word]
                   (mapv (fn [i] (mod (quot word (pow2 (* 8 (- 3 i)))) 256))
                         (range 4)))
                 h))))

(defn login-meta
  "What the agent may see for one handle: labels and metadata, never
  passwords or seeds. nil when the handle is unknown."
  [store handle]
  (when-let [r (get store (str handle))]
    {"handle" (str handle) "backend" "local" "label" (get r "label" "")
     "kind" "login" "origin" (get r "origin" "")
     "available" (not (str/blank? (str (get r "origin" ""))))
     "identifier" (get r "username" "") "identifier_type" "username"
     "two_factor" (if (not (str/blank? (str (get r "totp_seed" "")))) "automatic" nil)}))

(defn add-login
  "Store one login record under `handle`. Returns the updated store;
  the handle is generated host-side (the CLI), like the legacy."
  [store {:keys [label username password origin totp-seed]} handle]
  (assoc store (str handle) {"label" (str label) "username" (str username)
                             "password" (str password) "origin" (str origin)
                             "totp_seed" (str (or totp-seed ""))}))

(defn remove-login
  "Drop one handle. Returns {:store :removed}; removing an unknown
  handle keeps the store and reports false, as the CLI's
  \"no such handle\" line does."
  [store handle]
  (let [h (str handle)]
    (if (contains? store h)
      {:store (dissoc store h) :removed true}
      {:store store :removed false})))

(defn secret
  "The password or TOTP seed for a handle. Internal plumbing only —
  never returned to the model."
  [store handle field]
  (get (get store (str handle)) field))

(defn- pad-right
  "Pad `s` with spaces to `width`, never truncating (mirrors the
  legacy list column widths)."
  [s width]
  (let [s (str s) n (count s)]
    (if (< n width) (str s (apply str (repeat (- width n) " "))) s)))

(defn format-row
  "One `vault list` output line for a [handle record] entry."
  [[handle r]]
  (str (pad-right handle 14) (pad-right (str (get r "username")) 20)
       (str (get r "origin")) "  " (str (get r "label"))))

(defn list-rows
  "The whole store as sorted [handle record] vectors, the order
  `vault list` prints (normalized to vectors so every runner compares
  the same shape). Empty store prints \"no saved logins\" (S6 CLI)."
  [store]
  (sort-by first (mapv (fn [e] [(key e) (val e)]) store)))

;; ---------------------------------------------------------------- TOTP (RFC 6238, SHA-1)

(defn- hmac-sha1
  "HMAC-SHA1 over byte vectors (key block-padded to 64). The legacy
  key is always 32 random bytes, so longer keys hash down the same
  way; shorter keys zero-pad."
  [key-bytes msg-bytes]
  (let [k0 (if (> (count key-bytes) 64) (sha1-bytes key-bytes) key-bytes)
        k (vec (concat (take 64 k0) (repeat (- 64 (count (take 64 k0))) 0)))
        xor-with (fn [pad] (mapv bit-xor k (repeat 64 pad)))]
    (sha1-bytes (vec (concat (xor-with 0x5C)
                             (sha1-bytes (vec (concat (xor-with 0x36) msg-bytes))))))))

(def ^:private base32-alphabet "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

(defn base32-decode
  "Decode a base32 string to a byte vector (whitespace and `=` padding
  ignored, lowercase accepted). Throws on any other character, as the
  legacy does."
  [s]
  (let [chars (filter #(not (contains? #{\space \tab \newline \return \=} %))
                      (str/upper-case (str s)))
        [_ _ out]
        (reduce (fn [[acc bits out] c]
                  (let [v (str/index-of base32-alphabet (str c))]
                    (when (nil? v)
                      (throw (ex-info "invalid base32 TOTP seed" {:char (str c)})))
                    (let [acc (+ (* acc 32) v) bits (+ bits 5)]
                      (if (>= bits 8)
                        (let [nb (- bits 8)]
                          [(mod acc (pow2 nb)) nb (conj out (quot acc (pow2 nb)))])
                        [acc bits out]))))
                [0 0 []]
                chars)]
    out))

(defn mint-totp
  "RFC 6238, SHA-1, 6 digits, 30s step, over the base32 `seed` at
  `now-ms`. The code is minted for the page — it never enters the
  conversation. `now-ms` is explicit (the clock default stays S6)."
  [seed now-ms]
  (let [key (base32-decode seed)
        t (quot now-ms 30000)
        ctr (mapv (fn [i] (mod (quot t (pow2 (* 8 (- 7 i)))) 256)) (range 8))
        mac (hmac-sha1 key ctr)
        off (mod (nth mac 19) 16)
        bin (+ (* (mod (nth mac off) 128) 16777216)
               (* (nth mac (+ off 1)) 65536)
               (* (nth mac (+ off 2)) 256)
               (nth mac (+ off 3)))]
    (subs (str (+ 1000000 (mod bin 1000000))) 1)))
