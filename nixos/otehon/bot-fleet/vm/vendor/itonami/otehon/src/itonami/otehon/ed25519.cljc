(ns itonami.otehon.ed25519
  "Ed25519 base-point multiplication and did:key rendering, pure .cljc.

  What `profile did` needs: SHA-256(fleet-seed || 0x00 || key-id), then
  the RFC 8032 seed expansion the legacy route gets from
  createPrivateKey (SHA-512, clamped low half), that scalar times the
  base point, and base58btc(0xed01 || pubkey). Host touches are UTF-8
  encoding (hio/utf8-encode) and SHA-512 (hio/sha512-digest, exact in
  every standard library); every runner inverts, multiplies and packs
  the same integers.

  The field arithmetic uses 16 limbs of 16 bits, so every intermediate
  stays exact on doubles (nbb), longs (bb) and ints (Basilisp) — no
  bigint, no host crypto. The ladder is double-and-add on the twisted
  Edwards curve (add-2008-hwcd-3 / dbl-2008-hwcd, a = -1); the packed
  point is verified against node:crypto derivations (the legacy route)
  in the shared cases."
  (:require [clojure.string :as str]
            [itonami.otehon.cas :as cas]
            [itonami.otehon.io :as hio]))

;; ---------------------------------------------------------------- hex

(defn- hex-val
  "One hex char (either case) to its value, or nil. The same literal
  reads as a Character or a 1-string depending on the runner, and `=`
  holds within each — the way bundle/json-string matches escapes."
  [ch]
  (cond (= ch \0) 0 (= ch \1) 1 (= ch \2) 2 (= ch \3) 3 (= ch \4) 4
        (= ch \5) 5 (= ch \6) 6 (= ch \7) 7 (= ch \8) 8 (= ch \9) 9
        (= ch \a) 10 (= ch \b) 11 (= ch \c) 12 (= ch \d) 13
        (= ch \e) 14 (= ch \f) 15
        (= ch \A) 10 (= ch \B) 11 (= ch \C) 12 (= ch \D) 13
        (= ch \E) 14 (= ch \F) 15
        :else nil))

(defn- hex-bytes
  "Even-length hex text to a vector of 0-255 ints, nil when malformed."
  [s]
  (when (and (string? s) (even? (count s)))
    (let [vs (mapv hex-val s)]
      (when (every? some? vs)
        (mapv (fn [pair] (+ (* 16 (first pair)) (second pair)))
              (partition 2 vs))))))

(def seed-env-name
  "The environment variable a human session fills from kagi
  (item shared/agent-identity-seed) for the one command that needs it."
  "ITONAMI_AGENT_IDENTITY_SEED")

(defn parse-seed
  "A 32-byte fleet seed from 64 hex characters (either case, surrounding
  whitespace ignored), or nil. Verbatim from identity.cljk."
  [s]
  (when (and (string? s) (re-matches #"^[0-9a-fA-F]{64}$" (str/trim s)))
    (hex-bytes (str/trim s))))

(defn key-id
  "What the derivation is keyed on: the profile id, plus #<epoch> after
  a rotation. Verbatim from identity.cljk."
  [profile-id epoch]
  (if (zero? epoch) (str profile-id) (str profile-id "#" epoch)))

;; ---------------------------------------------------------------- field

(def ^:private mask16 65535)

(defn- hex4
  "Four hex chars to an int."
  [s]
  (reduce (fn [acc ch] (+ (* acc 16) (hex-val ch))) 0 s))

(defn- hex-limbs
  "64 hex chars to 16 little-endian 16-bit limbs."
  [hex]
  (mapv (fn [i] (hex4 (subs hex (- 60 (* i 4)) (- 64 (* i 4)))))
        (range 16)))

(def ^:private base-x
  "The base point x, little-endian limbs."
  (hex-limbs "216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"))

(def ^:private base-y
  "The base point y (4/5), little-endian limbs."
  (hex-limbs "6666666666666666666666666666666666666666666666666666666666666658"))

(defn- small
  "A small non-negative int as a 16-limb field element."
  [n]
  (loop [i 0 n n v (vec (repeat 16 0))]
    (if (>= i 16) v (recur (inc i) (quot n 65536) (assoc v i (mod n 65536))))))

(defn- carry-pass!
  "One left-to-right carry pass over a transient 16-limb vector; returns
  [transient carry-out]. The quotient floors (not truncates), so
  negative limbs reduce too. Transient writes keep the ladder fast on
  every runner (verified plain values; no host branching)."
  [t]
  (loop [i 0 t t c 0]
    (if (>= i 16) [t c]
      (let [x (+ (nth t i) c)
            q (let [q (quot x 65536)]
                (if (and (neg? x) (not (zero? (rem x 65536)))) (dec q) q))]
        (recur (inc i) (assoc! t i (- x (* q 65536))) q)))))

(def ^:private p-limbs
  "2^255 - 19, little-endian 16-bit limbs."
  [65517 65535 65535 65535 65535 65535 65535 65535
   65535 65535 65535 65535 65535 65535 65535 32767])

(defn- ge-p?
  "True when the 16 limbs hold a value >= p."
  [v]
  (loop [i 15]
    (cond (< i 0) true
          (> (nth v i) (nth p-limbs i)) true
          (< (nth v i) (nth p-limbs i)) false
          :else (recur (dec i)))))

(defn- sub-p
  "v - p, assuming v >= p."
  [v]
  (first
   (reduce (fn [[v borrow] i]
             (let [x (- (nth v i) (nth p-limbs i) borrow)]
               [(assoc v i (if (neg? x) (+ x 65536) x)) (if (neg? x) 1 0)]))
           [v 0] (range 16))))

(defn- norm
  "Fold 2^256 multiples (38 per fold) until the carry is zero, then
  subtract p once when the value still covers it. Converges in two
  passes for every sum the ladder produces."
  [v]
  (loop [t (transient (into [] v)) n 0]
    (when (> n 10) (throw (ex-info "ed25519: carry did not converge" {})))
    (let [[t c] (carry-pass! t)]
      (if (zero? c)
        (let [p (persistent! t)]
          (if (ge-p? p) (sub-p p) p))
        (recur (assoc! t 0 (+ (nth t 0) (* c 38))) (inc n))))))

(defn- fadd [a b] (norm (mapv + a b)))
(defn- fsub [a b] (norm (mapv - a b)))
(defn- fmul [a b]
  (let [t (loop [i 0 t (transient (vec (repeat 31 0)))]
            (if (>= i 16) t
              (recur (inc i)
                     (loop [j 0 t t]
                       (if (>= j 16) t
                         (let [k (+ i j)]
                           (recur (inc j)
                                  (assoc! t k (+ (nth t k)
                                                 (* (nth a i) (nth b j)))))))))))
        t (loop [i 30 t t]
            (if (< i 16) t
              (recur (dec i)
                     (assoc! t (- i 16) (+ (nth t (- i 16))
                                           (* (nth t i) 38))))))]
    (norm (subvec (persistent! t) 0 16))))

(defn- pow2523
  "x^(2^255-21) by binary square-and-multiply over explicit bits, high
  to low. The bit pattern (bits 254..5 set; low bits 0,1,0,1,1) is
  verified against an independent oracle (see the evidence doc)."
  [x]
  (reduce (fn [r b] (let [r (fmul r r)] (if (zero? b) r (fmul r x))))
          (small 1)
          (concat (repeat 250 1) [0 1 0 1 1])))

(defn- finv [x] (pow2523 x))

(def ^:private d2
  "2*d for the Edwards addition formula, computed once: d is
  -121665/121666 mod p."
  (let [d (fmul (fsub (vec (repeat 16 0)) (small 121665))
                (finv (small 121666)))]
    (fadd d d)))

;; ---------------------------------------------------------------- points

(defn- pt-add
  "Twisted Edwards addition (add-2008-hwcd-3, a = -1)."
  [[x1 y1 z1 t1] [x2 y2 z2 t2]]
  (let [a (fmul (fsub y1 x1) (fsub y2 x2))
        b (fmul (fadd y1 x1) (fadd y2 x2))
        c (fmul t1 (fmul d2 t2))
        d (fmul z1 (fadd z2 z2))
        e (fsub b a) f (fsub d c) g (fadd d c) h (fadd b a)]
    [(fmul e f) (fmul g h) (fmul f g) (fmul e h)]))

(defn- pt-double
  "Twisted Edwards doubling (dbl-2008-hwcd, a = -1)."
  [[x1 y1 z1 _]]
  (let [a (fmul x1 x1)
        b (fmul y1 y1)
        c (fmul z1 (fadd z1 z1))
        d (fsub (vec (repeat 16 0)) a)
        e (fsub (fmul (fadd x1 y1) (fadd x1 y1)) (fadd a b))
        g (fadd d b) f (fsub g c) h (fsub d b)]
    [(fmul e f) (fmul g h) (fmul f g) (fmul e h)]))

(def ^:private base-point
  [base-x base-y (small 1) (fmul base-x base-y)])

(def ^:private identity-point
  [(vec (repeat 16 0)) (small 1) (small 1) (vec (repeat 16 0))])

(defn- scalar-bits
  "Clamped seed bytes to 256 scalar bits, high to low."
  [seed]
  (let [s (assoc (vec seed) 0 (bit-and (nth seed 0) 248))]
    (mapcat (fn [i]
              (let [s (if (= i 31)
                        (bit-or (bit-and (nth s i) 127) 64)
                        (nth s i))]
                (map (fn [k] (mod (quot s k) 2)) [128 64 32 16 8 4 2 1])))
            (range 31 -1 -1))))

(defn- ladder
  "The clamped scalar times the base point, double-and-add high to low."
  [seed]
  (loop [bits (scalar-bits seed) q identity-point]
    (if (empty? bits) q
      (let [q (pt-double q)]
        (recur (rest bits) (if (zero? (first bits)) q (pt-add q base-point)))))))

(defn- pack-field
  "A reduced field element to 32 little-endian bytes."
  [v]
  (let [v (let [n (norm v)] (if (ge-p? n) (sub-p n) n))]
    (vec (mapcat (fn [limb] [(mod limb 256) (quot limb 256)]) v))))

(defn scalarmult-base
  "The clamped 32-byte seed times the base point, packed to the
  32-byte compressed public key (y with the x-parity bit)."
  [seed]
  (let [[x y z _] (ladder seed)
        zinv (finv z)
        packed (pack-field (fmul y zinv))
        xodd? (odd? (first (pack-field (fmul x zinv))))]
    (assoc packed 31 (+ (nth packed 31) (if xodd? 128 0)))))

;; ---------------------------------------------------------------- did

(def ^:private b58
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

(defn base58btc
  "Base58btc of a byte vector. Verbatim from p2p.cljk, over count/nth
  so every runner walks the same bytes."
  [bytes]
  (let [digits (loop [i 0 digits [0]]
                 (if (>= i (count bytes)) digits
                   (let [carry (nth bytes i)
                         [digits carry]
                         (reduce (fn [[ds carry] d]
                                   (let [x (+ (* d 256) carry)]
                                     [(conj ds (mod x 58)) (quot x 58)]))
                                 [[] carry] digits)
                         digits (loop [ds digits c carry]
                                  (if (pos? c)
                                    (recur (conj ds (mod c 58)) (quot c 58))
                                    ds))]
                     (recur (inc i) digits))))
        zeros (count (take-while zero? bytes))]
    (str (apply str (repeat zeros "1"))
         (if (every? zero? bytes)
           ""
           (apply str (map #(str (nth b58 %))
                           (drop-while zero? (reverse digits))))))))

(defn did-of
  "The did:key for a 32-byte fleet seed, a profile id and an epoch.
  Verbatim from identity.cljk: okm = SHA-256(seed || 0x00 || key-id),
  the clamped okm times the base point, did:key:z of 0xed01 || pubkey."
  [seed profile-id epoch]
  (when-not (= 32 (count seed))
    (throw (ex-info "agent identity seed must be 32 bytes" {:itonami/error :bad-seed})))
  (when-not (and (integer? epoch) (not (neg? epoch)))
    (throw (ex-info "epoch must be a non-negative integer" {:itonami/error :bad-epoch :epoch epoch})))
  (let [okm (cas/sha256-digest (into (vec seed) (concat [0] (hio/utf8-encode (key-id profile-id epoch)))))
        h (hio/sha512-digest okm)
        pub (scalarmult-base (vec (take 32 h)))]
    (str "did:key:z" (base58btc (into [237 1] pub)))))
