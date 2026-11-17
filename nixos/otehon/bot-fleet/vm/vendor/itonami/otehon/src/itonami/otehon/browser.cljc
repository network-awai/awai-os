(ns itonami.otehon.browser
  "The browser proxy/CLI policy core: secret detection, output
  scrubbing, host gating, CONNECT target parsing, timeout clamping
  and screenshot selection. Faithful port of the pure heads of
  itonami.agent.browser (the per-profile HTTP CONNECT proxy, the
  agent-browser CLI runner and the CDP/browser-use paths).

  Host-side and staying S6: DNS resolution and pinning, sockets, the
  proxy and CDP servers, process spawn, the config-file write, clock
  reads and the file-existence check behind screenshot selection
  (injected as `file?`, like the outbox stubs)."
  (:require [clojure.string :as str]
            [itonami.otehon.webguard :as webguard]))

(def secret-url-pattern
  #"(?i)(?:sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|gho_[A-Za-z0-9]{10,}|ghu_[A-Za-z0-9]{10,}|ghs_[A-Za-z0-9]{10,}|ghr_[A-Za-z0-9]{10,}|xapp-[0-9]+-[A-Za-z0-9-]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|sk_live_[A-Za-z0-9]{10,}|sk_test_[A-Za-z0-9]{10,})")

(defn- hexval [c]
  (let [i (str/index-of "0123456789ABCDEF" (str (str/upper-case (str c))))]
    (when (and i (>= i 0)) i)))

(defn- percent-decode
  "js/decodeURIComponent without the throw: %XX hex pairs decoded,
  anything else left alone; nil when a % is malformed, so the decoded
  attempt fails exactly like the legacy catch (fail closed)."
  [s]
  (let [bad? (volatile! false)
        ;; The replacement fn gets [full group] on bb/nbb but the bare
        ;; match string on basilisp; normalize before slicing.
        dec (str/replace (str s) #"%[\s\S]{2}"
                         (fn [m]
                           (let [full (if (vector? m) (first m) m)
                                 hh (subs full 1 3)
                                 a (hexval (first hh)) b (hexval (second hh))]
                             (if (and a b)
                               (str (char (+ (* a 16) b)))
                               (do (vreset! bad? true) full)))))]
    (when-not @bad? dec)))

(defn secret-url?
  "A credential-shaped substring, raw or percent-encoded. Returns the
  match, nil when clean, false when the encoding itself is malformed —
  the legacy `or` shape verbatim."
  [url]
  (or (re-find secret-url-pattern url)
      (if-let [d (percent-decode url)]
        (re-find secret-url-pattern d)
        false)))

(defn allowed-host?
  "The CONNECT/HTTP gate: bracket-stripped, lowercased, through the
  allowlist, with the metadata endpoints always denied."
  [allow host]
  (let [host (-> (str host) (str/replace #"^\[|\]$" "") str/lower-case)]
    (and (webguard/host-allowed? allow host)
         (not (contains? #{"metadata.google.internal" "metadata.goog"} host)))))

(defn- parse-digits
  "js/parseInt(s, 10) without the host: leading whitespace, optional
  sign, leading digits; nil when there are no digits (NaN upstream).
  Digits convert via alphabet index: `(int \\3)` is the codepoint on
  bb/basilisp but the digit value on nbb. `[0-9]` (not `\\d`) keeps
  every runner on ASCII digits."
  [s]
  (let [m (re-matches #"\s*([+-]?)([0-9]+).*" (str s))]
    (when m
      (let [ds (map #(str/index-of "0123456789" (str %)) (nth m 2))]
        (when (every? some? ds)
          (let [n (reduce (fn [a d] (+ (* a 10) d)) 0 ds)]
            (if (= "-" (nth m 1)) (- n) n)))))))

(defn parse-connect-target
  "The CONNECT target line: `[v6]:port` or `host:port`. Returns
  {:host :port} or nil when the host is blank, the port is missing or
  out of range, or the allowlist denies it. `js/parseInt` prefix
  semantics preserved (`12x` reads 12)."
  [raw allow]
  (let [raw (str raw)
        m (re-matches #"^\[([^\]]+)\]:([0-9]+)$" raw)
        ipv6? (some? m)
        host (if ipv6? (nth m 1) (first (str/split raw #":")))
        port (parse-digits (if ipv6? (nth m 2) (second (str/split raw #":"))))]
    (when (and (not (str/blank? (str host)))
               (number? port)
               (<= 1 port 65535)
               (allowed-host? allow host))
      {:host (str host) :port port})))

(defn- sub-match
  "Replace every occurrence of the full match with group-1 + suffix
  (or the suffix alone when the pattern has no group). The splice is
  explicit because host `$1` replacement syntax diverges across
  runners (basilisp leaves `$1` literal), and the replacement is a
  plain string because bb/SCI string-match replace takes no function.
  Group 1 only ever holds fixed key words and whitespace, so no `$`
  or `\\` can leak into the replacement."
  [s pattern suffix]
  (let [m (re-find pattern s)]
    (cond (vector? m) (str/replace s (first m) (str (second m) suffix))
          (string? m) (str/replace s m suffix)
          :else s)))

(defn scrub-output
  "Redact credential-shaped strings from browser output (the local
  proxy scrubbing, verbatim: secret patterns, token query params,
  authorization headers and key-shaped assignments)."
  [s]
  (-> (str s)
      (sub-match secret-url-pattern "[REDACTED]")
      (sub-match #"(?i)([?&](?:access_token|refresh_token|id_token|api[_-]?key|auth_token|client_secret|password|secret)=)[^&#\s]+" "[REDACTED]")
      (sub-match #"(?i)((?:proxy-)?authorization:\s*(?:bearer|basic)\s+)[^\s\"']+" "[REDACTED]")
      (sub-match #"(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth_token|client_secret|password|secret)\s*[:=]\s*)[^\s,;\"']+" "[REDACTED]")))

(defn redact-cdp-output
  "Credential-shaped strings never leave the host (CDP output
  scrubbing; `[redacted]` lowercase, as in the legacy). Maps recurse
  over values, vectors recurse, anything else passes through —
  including lists, which the legacy leaves alone."
  [x]
  (cond (string? x) (str/replace x secret-url-pattern "[redacted]")
        (map? x) (into {} (map (fn [[k v]] [k (redact-cdp-output v)]) x))
        (vector? x) (mapv redact-cdp-output x)
        :else x))

(defn clamp-timeout
  "Clamp a timeout to 1..1800s, defaulting non-numeric input to 300 —
  the browser-use exec bound verbatim."
  [t]
  (let [n (if (number? t) t (parse-digits (str/trim (str t))))]
    (max 1 (min (if (nil? n) 300 n) 1800))))

(defn screenshot-path
  "The last regex-hit screenshot path that exists. `file?` is
  injected (the host check stays S6), like the outbox stubs."
  [stdout file?]
  (last (filter file? (re-seq #"(?i)/[^\s\"']+\.(?:png|jpe?g|webp)" (str stdout)))))
