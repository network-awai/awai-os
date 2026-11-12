(ns itonami.otehon.text
  "Portable string ops for the Otehon .cljc core, with one pinned answer on
  every runner (Basilisp :lpy, Babashka :clj, nbb :cljs).

  Oracle for `kotoba.lang.text` (the .cljk reference, which nbb cannot load
  as `.cljk` — hence `Could not find namespace: kotoba.lang.text` when a
  `.cljc` core tries to require it). This module is `.cljc` and runs on all
  three Otehon runners. The `:text` shared-case op exercises it; switching
  Otehon call sites from `clojure.string` to this module is a follow-up,
  not this unit.

  Pinned (JVM `Character/isWhitespace`, as `kotoba.lang.text` pins it):
  `trim`, `triml`, `trimr`, `blank?` strip exactly the C0 controls
  U+0009-U+000D, U+001C-U+001F, SPACE, U+1680, U+2000-U+2006, U+2008-U+200A,
  U+2028-U+2029, U+205F and U+3000. Deliberately excluded (Java excludes
  them, JS `\\s` includes them): U+00A0, U+2007, U+202F.

  `split` pins Java `Pattern/split` trailing-empty semantics (limit absent
  or 0 drops trailing empties; negative keeps them; positive caps parts),
  on top of the host regex engine (regex itself stays host regex, as in
  `kotoba.lang.text`). `split-lines` is `(split s #\"\\r?\\n\")`.

  Portability: no `.charAt`, no `str/trimr`, no `array-map`, no `\\\\`
  inside regex literals (Basilisp folds it); `\\x5c` is used for a literal
  backslash. No `#?@`."
  (:require [clojure.string :as host]))

;; ---------------------------------------------------------------- whitespace

(def ^:private ws-codes
  "JVM `Character/isWhitespace` code points (the pinned trim set)."
  [9 10 11 12 13 28 29 30 31 32
   5760 8192 8193 8194 8195 8196 8197 8198 8200 8201 8202
   8232 8233 8287 12288])

(def ^:private ws-chars
  "Pinned whitespace as a set, built from code points via `char` so no
  `\\u` literal appears (Basilisp rejects `\\u` escapes)."
  (set (map char ws-codes)))

(defn- ws-at?
  "True when `s[i]` is pinned whitespace."
  [s i]
  (contains? ws-chars (nth s i)))

(defn triml
  "Remove pinned whitespace from the left end of `s`."
  [s]
  (let [s (str s) n (count s)]
    (loop [i 0]
      (if (and (< i n) (ws-at? s i))
        (recur (inc i))
        (subs s i)))))

(defn trimr
  "Remove pinned whitespace from the right end of `s`."
  [s]
  (let [s (str s)]
    (loop [i (count s)]
      (if (and (pos? i) (ws-at? s (dec i)))
        (recur (dec i))
        (subs s 0 i)))))

(defn trim
  "Remove pinned whitespace from both ends of `s`."
  [s]
  (-> (str s) triml trimr))

(defn blank?
  "True when `s` is nil, empty, or only pinned whitespace."
  [s]
  (or (nil? s) (= "" (trim (str s)))))

;; ---------------------------------------------------------------- predicates

(defn starts-with?
  "True when `s` starts with `prefix`."
  [s prefix]
  (let [s (str s) p (str prefix) n (count p)]
    (and (<= n (count s)) (= p (subs s 0 n)))))

(defn ends-with?
  "True when `s` ends with `suffix`."
  [s suffix]
  (let [s (str s) p (str suffix) n (count p) m (count s)]
    (and (<= n m) (= p (subs s (- m n))))))

(defn includes?
  "True when `s` contains `sub`."
  [s sub]
  (let [s (str s) sub (str sub) n (count sub) m (count s)]
    (if (zero? n)
      true
      (loop [i 0]
        (cond (> (+ i n) m) false
              (= sub (subs s i (+ i n))) true
              :else (recur (inc i)))))))

(defn index-of
  "Index of the first occurrence of `value` in `s` at or after
  `from-index`, or nil."
  ([s value] (index-of s value 0))
  ([s value from-index]
   (let [s (str s) v (str value) n (count v) m (count s)]
     (when-not (neg? from-index)
       (loop [i (max 0 from-index)]
         (cond (> (+ i n) m) nil
               (= v (subs s i (+ i n))) i
               :else (recur (inc i))))))))

;; ---------------------------------------------------------------- case

(defn lower-case
  "Lower-case `s` using the host default locale (URL hosts are ASCII,
  the only Otehon use)."
  [s]
  #?(:lpy (.lower (str s))
     :clj (.toLowerCase ^String (str s))
     :cljs (.toLowerCase (str s))))

(def lower lower-case)

;; ---------------------------------------------------------------- split / join

(defn join
  "Join `coll` with separator `sep`. One arg joins with no separator.
  `nil` elements render as \"\"."
  ([coll] (apply str coll))
  ([sep coll] (apply str (interpose sep coll))))

(defn- split-string
  "Portable split on an exact string separator, with Java limit semantics:
  limit absent/0 drops trailing empties, negative keeps them, positive caps
  parts with the last holding the remainder. No match yields `[s]`."
  [s sep limit]
  (let [s (str s) sep (str sep) n (count sep) m (count s)]
    (if (zero? n)
      [s]
      (let [limited (and limit (pos? limit))
            cap (when limited limit)]
        (loop [i 0 parts []]
          (if (and cap (>= (count parts) (dec cap)))
            (conj parts (subs s i))
            (let [j (loop [k i]
                      (cond (> (+ k n) m) nil
                            (= sep (subs s k (+ k n))) k
                            :else (recur (inc k))))]
              (if (nil? j)
                (let [parts (conj parts (subs s i))]
                  (if (or (nil? limit) (zero? limit))
                    (loop [p parts]
                      (if (and (seq p) (= "" (peek p))) (recur (pop p)) p))
                    parts))
                (recur (+ j n) (conj parts (subs s i j)))))))))))

(defn split
  "Split `s` on `sep` (exact string) or regex `re`, Java trailing semantics.
  String separators run the portable loop above; regex separators use the
  host engine for matching (regex stays host regex, as in kotoba.lang.text)
  with the same pinned limit/trailing rule applied afterwards."
  ([s sep]
   (if (string? sep)
     (split-string s sep 0)
     (let [parts (host/split (str s) sep)]
       (loop [p (vec parts)]
         (if (and (seq p) (= "" (peek p))) (recur (pop p)) p)))))
  ([s sep limit]
   (if (string? sep)
     (split-string s sep limit)
     (let [parts (host/split (str s) sep limit)]
       (vec parts)))))

(defn split-lines
  "Split `s` on `\\r\\n` or `\\n` (a lone `\\r` is not a separator),
  dropping trailing empties — `clojure.string/split-lines` semantics,
  without regex."
  [s]
  (let [s (str s)]
    (loop [i 0 parts []]
      (let [n (count s)]
        (if (>= i n)
          (let [parts (if (and (seq parts) (= "" (peek parts)))
                        (pop parts)
                        parts)]
            (vec parts))
          (let [j (loop [k i]
                    (cond (>= k n) nil
                          (= "\n" (subs s k (inc k))) k
                          :else (recur (inc k))))]
            (if (nil? j)
              (conj parts (subs s i))
              (let [line (subs s i j)
                    line (if (and (pos? (count line))
                                  (= "\r" (subs line (dec (count line)))))
                           (subs line 0 (dec (count line)))
                           line)]
                (recur (inc j) (conj parts line))))))))))

;; ---------------------------------------------------------------- replace

(defn replace
  "Replace each occurrence of `match` in `s` with `replacement`.
  String matches run a portable literal loop (no template expansion,
  `$1` stays literal); regex matches delegate to the host engine."
  [s match replacement]
  (let [s (str s)]
    (if (string? match)
      (let [m (str match) n (count m)]
        (if (zero? n)
          s
          (loop [i 0 out []]
            (let [j (loop [k i]
                      (cond (> (+ k n) (count s)) nil
                            (= m (subs s k (+ k n))) k
                            :else (recur (inc k))))]
              (if (nil? j)
                (apply str (conj out (subs s i)))
                (recur (+ j n)
                       (conj out (subs s i j)
                             (if (fn? replacement)
                               (str (replacement m))
                               (str replacement)))))))))
      (host/replace s match replacement))))

;; ---------------------------------------------------------------- pad

(defn pad-end
  "Pad `s` with spaces to width `w` (no truncation). The portable twin of
  the `.padEnd` calls in the legacy CLI tables (status, sessions, profile
  list): hosts agree on space padding, so the loop stays branch-free."
  [s w]
  (let [s (str s) n (count s)]
    (if (>= n w) s (str s (apply str (repeat (- w n) " "))))))
