(ns itonami.otehon.webguard
  "The web_extract network boundary, pure core: address classification,
  host allowlisting, search-query refusal. DNS, sockets and fetching
  stay host-side (S6c). `blocked-address?` takes the host-determined
  IP kind (4, 6, or anything else) since classification needs no
  syscalls of its own.
  Portability: word-boundary `\\b` never matches on the bb runner, so
  token edges use explicit `(?:^|[^A-Za-z0-9_])` / `(?:[^A-Za-z0-9_]|$)`
  guards, which behave the same on all three runners."
  (:require [clojure.string :as str]
            [itonami.otehon.bundle :as bundle]))

(def user-agent "Mozilla/5.0 (compatible; itonami-agent/0.1; +https://itonami.cloud)")
(def max-bytes (* 2 1024 1024))
(def max-redirects 5)
(def timeout-ms 20000)
(def max-query-chars 256)

(def ^:private query-rules
  [[:secret #"-----BEGIN [A-Z ]*PRIVATE KEY|(?:^|[^A-Za-z0-9_])(sk|pk|rk)-[A-Za-z0-9_-]{16,}|(?:^|[^A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}|(?:^|[^A-Za-z0-9_])AKIA[0-9A-Z]{16}(?:[^A-Za-z0-9_]|$)|(?:^|[^A-Za-z0-9_])xox[abpr]-[A-Za-z0-9-]{10,}|(?:^|[^A-Za-z0-9_])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"]
   [:encoded-blob #"[A-Za-z0-9+/=_-]{40,}"]
   [:email #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"]
   [:phone #"(?:\+?\d[\d\s()-]{8,}\d)"]])

(defn- to-hex [n]
  (let [ds "0123456789abcdef"]
    (if (zero? n)
      "0"
      (loop [n n out ""]
        (if (zero? n) out (recur (quot n 16) (str (nth ds (rem n 16)) out)))))))

(defn- parse-int10 [s]
  (let [t (str/replace (str s) #"^\s+" "")
        m (re-find #"^[+-]?\d+" t)]
    (when m
      (let [neg? (str/starts-with? m "-")
            ds (str/replace m #"^[+-]" "")
            n (reduce (fn [a ch] (+ (* a 10) (get bundle/hex-digit (str ch) 0))) 0 ds)]
        (if neg? (- n) n)))))

(defn- parse-hex [s]
  (let [t (str s)]
    (when (re-matches #"[0-9a-fA-F]+" t)
      (reduce (fn [a ch] (+ (* a 16) (get bundle/hex-digit (str ch) 0))) 0 t))))

(defn- v4-octets [s] (mapv parse-int10 (str/split s #"\.")))

(defn- v4-blocked? [s]
  (let [[a b c] (v4-octets s)]
    (or (= a 0) (= a 10) (= a 127)
        (and (= a 100) (<= 64 b 127))
        (and (= a 169) (= b 254))
        (and (= a 172) (<= 16 b 31))
        (and (= a 192) (= b 0) (#{0 2} c))
        (and (= a 192) (= b 168))
        (and (= a 198) (#{18 19} b))
        (and (= a 198) (= b 51) (= c 100))
        (and (= a 203) (= b 0) (= c 113))
        (>= a 224))))

(defn- v6-groups
  "An IPv6 address as 8 integers (handles :: and a trailing dotted v4)."
  [s]
  (let [s (str/lower-case (str/replace (str s) #"^\[|\]$" ""))
        s (str/replace s #"%.*$" "")
        [s tail4] (if-let [[_ head v4] (re-matches #"(.*:)(\d+\.\d+\.\d+\.\d+)" s)]
                    (let [[a b c d] (v4-octets v4)]
                      [(str head (to-hex (+ (* a 256) b)) ":" (to-hex (+ (* c 256) d))) true])
                    [s false])
        parse (fn [part] (if (str/blank? part)
                           []
                           (mapv parse-hex (str/split part #":"))))
        [l r] (if (str/includes? s "::") (str/split s #"::" 2) [s nil])
        lg (parse l) rg (parse r)]
    (vec (concat lg (repeat (- 8 (count lg) (count rg)) 0) rg))))

(defn- groups->v4 [g1 g2]
  (str (bit-shift-right g1 8) "." (bit-and g1 255) "." (bit-shift-right g2 8) "." (bit-and g2 255)))

(defn- v6-blocked? [s]
  (let [[a b c d e f g h :as gs] (v6-groups s)]
    (or (every? zero? gs)
        (= gs [0 0 0 0 0 0 0 1])
        (and (every? zero? [a b c d e]) (= f 0xffff) (v4-blocked? (groups->v4 g h)))
        (and (every? zero? [a b c d e f]) (v4-blocked? (groups->v4 g h)))
        (and (= a 0x64) (= b 0xff9b) (v4-blocked? (groups->v4 g h)))
        (= 0xfc00 (bit-and a 0xfe00))
        (= 0xfe80 (bit-and a 0xffc0))
        (= 0xff00 (bit-and a 0xff00))
        (and (= a 0x2001) (= b 0x0db8)))))

(defn blocked-address?
  "True for any address a fetch must not connect to. `ip-kind` (4, 6,
  or anything else) rides in because classifying needs no syscalls of
  its own; anything unrecognized is refused."
  [ip-kind addr]
  (let [host (str/replace (str addr) #"^\[|\]$" "")]
    (case (long (or ip-kind 0))
      4 (boolean (v4-blocked? host))
      6 (boolean (v6-blocked? host))
      true)))

(defn host-allowed?
  "`allow` nil = any public host; else exact names or *.suffix patterns."
  [allow host]
  (or (nil? allow)
      (let [host (str/lower-case (str host))]
        (boolean (some (fn [pat]
                         (let [pat (str/lower-case (str pat))]
                           (if (str/starts-with? pat "*.")
                             (str/ends-with? host (subs pat 1))
                             (= host pat))))
                       allow)))))

(defn query-refusal
  "nil when `q` may be sent to a search engine, else the reason keyword."
  [q]
  (let [q (str q)]
    (cond
      (str/blank? q) :empty-query
      (> (count q) max-query-chars) :query-too-long
      :else (some (fn [[reason re]] (when (re-find re q) reason)) query-rules))))
