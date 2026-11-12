(ns itonami.otehon.cas
  "Content addressing: pure SHA-256, object sharding, manifests.

  The hash runs on vectors of 0-255 ints with only non-negative integer
  arithmetic (quot/mod on halves), so every runner computes identical
  digests: no host crypto, no reader, no branches. Bytes enter through
  hio/read-latin1 + hio/bytes-of; digests leave as lowercase hex."
  (:require [clojure.string :as str]))

(def ^:private M32 4294967296)
(def ^:private H0 [0x6a09e667 0xbb67ae85 0x3c6ef372 0xa54ff53a
                   0x510e527f 0x9b05688c 0x1f83d9ab 0x5be0cd19])
(def ^:private K
  [0x428a2f98 0x71374491 0xb5c0fbcf 0xe9b5dba5 0x3956c25b 0x59f111f1
   0x923f82a4 0xab1c5ed5 0xd807aa98 0x12835b01 0x243185be 0x550c7dc3
   0x72be5d74 0x80deb1fe 0x9bdc06a7 0xc19bf174 0xe49b69c1 0xefbe4786
   0x0fc19dc6 0x240ca1cc 0x2de92c6f 0x4a7484aa 0x5cb0a9dc 0x76f988da
   0x983e5152 0xa831c66d 0xb00327c8 0xbf597fc7 0xc6e00bf3 0xd5a79147
   0x06ca6351 0x14292967 0x27b70a85 0x2e1b2138 0x4d2c6dfc 0x53380d13
   0x650a7354 0x766a0abb 0x81c2c92e 0x92722c85 0xa2bfe8a1 0xa81a664b
   0xc24b8b70 0xc76c51a3 0xd192e819 0xd6990624 0xf40e3585 0x106aa070
   0x19a4c116 0x1e376c08 0x2748774c 0x34b0bcb5 0x391c0cb3 0x4ed8aa4a
   0x5b9cca4f 0x682e6ff3 0x748f82ee 0x78a5636f 0x84c87814 0x8cc70208
   0x90befffa 0xa4506ceb 0xbef9a3f7 0xc67178f2])
(def ^:private P2 (vec (take 33 (iterate #(* % 2) 1))))
(def ^:private HEXDIGITS "0123456789abcdef")

(defn- add [& xs] (mod (apply + xs) M32))

(defn- band [x y]
  (+ (* (bit-and (quot x 65536) (quot y 65536)) 65536)
     (bit-and (mod x 65536) (mod y 65536))))

(defn- bor [x y]
  (+ (* (bit-or (quot x 65536) (quot y 65536)) 65536)
     (bit-or (mod x 65536) (mod y 65536))))

(defn- bxor2 [x y]
  (+ (* (bit-xor (quot x 65536) (quot y 65536)) 65536)
     (bit-xor (mod x 65536) (mod y 65536))))

(defn- bnot [x] (- 4294967295 x))
(defn- shr [x n] (quot x (nth P2 n)))

(defn- rotr [x n]
  (mod (+ (* (mod x (nth P2 n)) (nth P2 (- 32 n))) (quot x (nth P2 n))) M32))

(defn- ch [x y z] (bxor2 (band x y) (band (bnot x) z)))

(defn- maj [x y z]
  (bxor2 (band x y) (bxor2 (band x z) (band y z))))

(defn- big-sigma0 [x] (bxor2 (rotr x 2) (bxor2 (rotr x 13) (rotr x 22))))
(defn- big-sigma1 [x] (bxor2 (rotr x 6) (bxor2 (rotr x 11) (rotr x 25))))
(defn- small-sigma0 [x] (bxor2 (rotr x 7) (bxor2 (rotr x 18) (shr x 3))))
(defn- small-sigma1 [x] (bxor2 (rotr x 17) (bxor2 (rotr x 19) (shr x 10))))

(defn- pad [bytes]
  (let [mlen (count bytes)
        with-1 (conj (vec bytes) 0x80)
        npad (mod (- 56 (mod (count with-1) 64)) 64)
        bitlen (* mlen 8)
        hi (quot bitlen M32)
        lo (mod bitlen M32)
        len-bytes [(quot hi 16777216) (mod (quot hi 65536) 256)
                   (mod (quot hi 256) 256) (mod hi 256)
                   (quot lo 16777216) (mod (quot lo 65536) 256)
                   (mod (quot lo 256) 256) (mod lo 256)]]
    (into with-1 (concat (repeat npad 0) len-bytes))))

(defn- words [block]
  (vec (for [i (range 16)]
         (+ (* (nth block (* i 4)) 16777216)
            (* (nth block (+ (* i 4) 1)) 65536)
            (* (nth block (+ (* i 4) 2)) 256)
            (nth block (+ (* i 4) 3))))))

(defn- schedule [w16]
  (loop [i 16 w w16]
    (if (= i 64)
      w
      (recur (inc i)
             (conj w (add (small-sigma1 (nth w (- i 2)))
                          (nth w (- i 7))
                          (small-sigma0 (nth w (- i 15)))
                          (nth w (- i 16))))))))

(defn- compress [h block]
  (let [w (schedule (words block))]
    (loop [i 0 a (nth h 0) b (nth h 1) c (nth h 2) d (nth h 3)
           e (nth h 4) f (nth h 5) g (nth h 6) hh (nth h 7)]
      (if (= i 64)
        [(add (nth h 0) a) (add (nth h 1) b) (add (nth h 2) c)
         (add (nth h 3) d) (add (nth h 4) e) (add (nth h 5) f)
         (add (nth h 6) g) (add (nth h 7) hh)]
        (let [t1 (add hh (big-sigma1 e) (ch e f g) (nth K i) (nth w i))
              t2 (add (big-sigma0 a) (maj a b c))]
          (recur (inc i) (add t1 t2) a b c (add d t1) e f g))))))

(defn sha256-digest
  "Raw SHA-256 digest: 32 ints in 0-255, big-endian. Same computation
  as sha256-hex; exposed so keyed constructions (HMAC) can chain the
  raw bytes without re-parsing hex."
  [bytes]
  (let [padded (pad (vec bytes))
        h (loop [blocks (partition 64 padded) h H0]
            (if (empty? blocks) h (recur (rest blocks) (compress h (first blocks)))))]
    (vec (mapcat (fn [w] (map (fn [p] (mod (quot w p) 256))
                              [(nth P2 24) (nth P2 16) (nth P2 8) 1]))
                 h))))

(defn bytes-hex
  "Lowercase hex of a vector of 0-255 ints."
  [bs]
  (apply str (mapcat (fn [b] [(nth HEXDIGITS (quot b 16)) (nth HEXDIGITS (mod b 16))]) bs)))

(defn sha256-hex
  "Lowercase hex SHA-256 of a vector of 0-255 ints."
  [bytes]
  (bytes-hex (sha256-digest bytes)))

(defn object-rel
  "Store-relative object path for a digest, git-style sharded."
  [sha]
  (str (subs sha 0 2) "/" (subs sha 2)))

(defn ingest
  "Describe bytes for the store without touching the disk."
  [rel bytes]
  (let [sha (sha256-hex bytes)]
    {:rel rel :sha sha :size (count bytes) :object (object-rel sha)}))

(defn manifest-add
  "Add one file's bytes to a manifest {rel {:sha :size}}."
  [manifest rel bytes]
  (assoc manifest rel (let [sha (sha256-hex bytes)]
                        {:sha sha :size (count bytes)})))

(defn manifest-shas
  "The set of digests a manifest references."
  [manifest]
  (set (map (comp :sha val) manifest)))

(defn manifest-rebuild
  "Recover manifest entries from content + peers. `local` is the current
  manifest (possibly {} when damaged); `objects` [{:sha :size}] is the
  caller re-hashed inventory, so a tampered file cannot lie about its
  digest; `remotes` [{:peer :manifest}] in try-order. For every locally
  held sha a peer lists: adopt the rel when local lacks it (first peer
  wins), stay silent when local agrees, or flag a conflict when local —
  or an earlier adoption — maps the rel to a different sha. Shas no
  peer lists land in :unmatched. Deterministic."
  [local objects remotes]
  (let [by-sha (into {} (map (fn [{:keys [sha size]}] [sha size]) objects))
        cands (fn [sha]
                (vec (mapcat (fn [{:keys [peer manifest]}]
                               (map (fn [rel] [peer rel])
                                    (sort (keep (fn [[rel e]]
                                                  (when (= sha (:sha e)) rel))
                                                manifest))))
                             remotes)))]
    (dissoc
     (second
      (reduce (fn [[rels acc] sha]
               (let [cs (remove (fn [[_ rel]] (contains? (:conflicted acc) rel)) (cands sha))]
                 (if (empty? cs)
                   [rels (update acc :unmatched conj sha)]
                   (let [[peer rel] (first cs)
                         have (or (get rels rel) (:sha (get local rel)))]
                     (cond (nil? have)
                           [(assoc rels rel sha)
                            (update acc :adopted conj {:rel rel :sha sha
                                                      :size (get by-sha sha) :from peer})]
                           (= have sha) [rels acc]
                           :else [rels (-> acc
                                           (update :conflicts conj {:rel rel :local have
                                                                   :peer sha :from peer})
                                           (update :conflicted conj rel))])))))
             [{} {:adopted [] :conflicts [] :unmatched [] :conflicted #{}}]
             (sort (keys by-sha))))
     :conflicted)))

(def ^:private digit-val
  "Explicit 1-char strings (never seq elements: bb yields chars where
  nbb yields strings, so only `subs` slices are portable keys)."
  (zipmap ["0" "1" "2" "3" "4" "5" "6" "7" "8" "9"] (range 10)))

(defn parse-int
  "Non-negative integer from a digit string, nil on any other input.
  Pure and portable, so the CLI parses counts without host interop."
  [s]
  (when (and (string? s) (pos? (count s)))
    (reduce (fn [a i]
              (if (nil? a)
                nil
                (if-let [d (get digit-val (subs s i (inc i)))]
                  (+ (* a 10) d)
                  nil)))
            0 (range (count s)))))

(defn- ymd->days
  "Days since 1970-01-01 for a YYYY-MM-DD string (Hinnant days_from_civil,
  pure quot arithmetic). nil unless the shape is exactly digits+2 dashes."
  [s]
  (when (and (string? s) (= 10 (count s))
             (= "-" (subs s 4 5)) (= "-" (subs s 7 8)))
    (let [y (parse-int (subs s 0 4)) m (parse-int (subs s 5 7)) d (parse-int (subs s 8 10))]
      (when (and y m d (<= 1 m 12) (<= 1 d 31))
        (let [y (- y (if (<= m 2) 1 0))
              era (quot (if (neg? y) (- y 399) y) 400)
              yoe (- y (* era 400))
              doy (+ (quot (+ (* 153 (+ m (if (> m 2) -3 9))) 2) 5) (dec d))
              doe (+ (* yoe 365) (quot yoe 4) (- (quot yoe 100)) doy)]
          (+ (* era 146097) doe -719468))))))

(defn retention-plan
  "Time-boxed gc. `tombs` {sha {:deleted-at YYYY-MM-DD :size}} marks when
  each unreferenced object left the manifest; `days` is the grace period.
  Returns :drop (grace expired — delete now), :hold (still graced),
  :mark (newly unreferenced — stamp today), :revived (tombstoned but
  referenced again — clear the mark), plus :bytes (freed by this drop).
  Malformed tomb dates are re-marked, never dropped on bad math. A
  grace of 0 (or below) drops untombstoned objects at once — no grace
  to wait out — while malformed tombs still re-stamp first.
  Deterministic."
  [manifest inventory tombs today days]
  (let [live (manifest-shas manifest)
        revived (vec (sort (filter live (keys tombs))))
        unref (sort (remove live (keys inventory)))
        t1 (ymd->days today)
        age (fn [sha]
              (if-not (contains? tombs sha)
                ::missing
                (let [d (get-in tombs [sha :deleted-at])]
                  (when (and t1 d)
                    (let [t0 (ymd->days d)] (when t0 (- t1 t0)))))))
        stepped (reduce (fn [acc sha]
                          (let [a (age sha)]
                            (cond (= a ::missing)
                                  (update acc (if (<= days 0) :drop :mark) conj sha)
                                  (nil? a) (update acc :mark conj sha)
                                  (>= a days) (update acc :drop conj sha)
                                  :else (update acc :hold conj sha))))
                        {:drop [] :hold [] :mark []} unref)
        drops (:drop stepped)]
    (assoc stepped :revived revived
           :bytes (reduce + 0 (map inventory drops)))))

(defn gc-plan
  "Which stored objects no manifest references. `inventory` {sha size}
  is the physical objects/ content (the caller lists it); the manifest
  decides liveness. Returns sorted :drop [sha] plus :keep (live digest
  count) and :bytes (freed). Deterministic. Dropping is always safe:
  nothing in the manifest points at a dropped digest, and the manifest
  itself is never rewritten here."
  [manifest inventory]
  (let [live (manifest-shas manifest)
        drop (vec (sort (remove live (keys inventory))))]
    {:drop drop
     :keep (count live)
     :bytes (reduce + 0 (map inventory drop))}))

(defn verify-manifest
  "Re-hash every file through `read-bytes` (rel -> bytes or nil).
  Pure: the caller injects the reader, so the shared cases run
  without a disk and the CLI passes the io one."
  [manifest read-bytes]
  (reduce (fn [acc [rel {:keys [sha]}]]
            (let [bs (read-bytes rel)]
              (cond (nil? bs) (-> acc
                                  (update :missing (fnil conj []) rel)
                                  (update :checked inc))
                    (= sha (sha256-hex bs)) (update acc :checked inc)
                    :else (-> acc
                              (update :mismatch (fnil conj []) rel)
                              (update :checked inc)))))
          {:checked 0 :mismatch [] :missing []}
          (sort-by key manifest)))
