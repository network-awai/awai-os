(ns saifu.core
  "The pure core of the Saifu dapp. It runs unchanged on ClojureScript and Basilisp, and the same
  test data in test/cases.json checks both. It has no I/O, regular expressions, dates or
  platform numbers: amounts stay as digit strings, so no float can round them.")

(def ^:private hex-digits "0123456789abcdef")
(def ^:private decimal-digits "0123456789")

(defn- index-of-char
  "The position of character c in text, or nil."
  [text c]
  (first (keep-indexed (fn [i x] (when (= x c) i)) (seq text))))

(defn- all-in?
  [allowed text]
  (every? #(some? (index-of-char allowed %)) (seq text)))

(defn- lower-char [c]
  (let [at (index-of-char "ABCDEF" c)]
    (if at (nth "abcdef" at) c)))

(defn- lower-hex [text]
  (apply str (map lower-char (seq text))))

(defn- strip-0x
  "The text after a 0x prefix, or nil when there is none."
  [text]
  (when (and (string? text) (> (count text) 2) (= (subs text 0 2) "0x"))
    (subs text 2)))

(defn valid-address?
  "True for 0x and 40 hex digits. Does not check the EIP-55 checksum."
  [address]
  (let [body (strip-0x address)]
    (boolean (and body
                  (= 40 (count body))
                  (all-in? hex-digits (lower-hex body))))))

(defn- times-16-plus
  "Decimal digits, least significant first, times 16 plus n."
  [digits n]
  (loop [left digits carry n out []]
    (if (seq left)
      (let [value (+ (* 16 (first left)) carry)
            digit (mod value 10)]
        (recur (rest left) (quot (- value digit) 10) (conj out digit)))
      (loop [carry carry out out]
        (if (pos? carry)
          (let [digit (mod carry 10)]
            (recur (quot (- carry digit) 10) (conj out digit)))
          out)))))

(defn hex->decimal
  "A JSON-RPC hex quantity as a decimal string of any size, or nil if it is not one."
  [hex]
  (let [body (strip-0x hex)]
    (when (and body (all-in? hex-digits (lower-hex body)))
      (let [digits (reduce (fn [acc c] (times-16-plus acc (index-of-char hex-digits c)))
                           [0]
                           (seq (lower-hex body)))
            text (apply str (reverse digits))
            trimmed (apply str (drop-while #(= % \0) (seq text)))]
        (if (= "" trimmed) "0" trimmed)))))

(defn format-units
  "A decimal integer string shown with the given decimals, with trailing zeros removed.
  Returns nil unless amount is only digits."
  [amount decimals]
  (when (and (string? amount) (pos? (count amount)) (all-in? decimal-digits amount))
    (let [padded (str (apply str (repeat (max 0 (- (inc decimals) (count amount))) "0")) amount)
          split-at-point (- (count padded) decimals)
          whole (apply str (drop-while #(= % \0) (seq (subs padded 0 split-at-point))))
          fraction (apply str (reverse (drop-while #(= % \0) (reverse (seq (subs padded split-at-point))))))]
      (str (if (= "" whole) "0" whole)
           (when (not= "" fraction) (str "." fraction))))))

(defn balance-request
  "The JSON-RPC call for an address balance, or an error map."
  [address id]
  (if (valid-address? address)
    {:jsonrpc "2.0" :id id :method "eth_getBalance" :params [(lower-hex address) "latest"]}
    {:error :invalid-address}))

(defn read-balance
  "The balance from a JSON-RPC response. Anything unexpected is an error, never a zero balance."
  [response decimals]
  (let [failure (:error response)
        wei (hex->decimal (:result response))]
    (cond
      (some? failure) {:error :rpc-error}
      (nil? wei) {:error :bad-response}
      :else {:wei wei :display (format-units wei decimals)})))

(defn operation-gate
  "Whether an operation may be offered. It is not a security boundary: a service must check again."
  [score minimum]
  (if (>= score minimum)
    {:allowed true}
    {:allowed false :needs minimum :has score}))
