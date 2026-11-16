(ns itonami.otehon.mcp
  "The portable config half of itonami.agent.mcp: server selection,
  command/env shaping, tool naming, the per-server tool allowlist and
  the oauth-cache-ready decision. Exchange (stdio spawn, Streamable
  HTTP, token refresh) stays host-side (S6): these are the shapes
  both sides agree on. `env` is one merged string map, as in
  dapps/connections."
  (:require [clojure.string :as str]
            [itonami.otehon.cas :as cas]
            [itonami.otehon.io :as hio]
            [itonami.otehon.text :as text]))

(def protocol-version "2024-11-05")
(def max-name-length 64)

(defn enabled?
  [spec]
  (let [v (get spec "enabled" true)]
    (not (or (false? v)
             (and (string? v) (contains? #{"false" "0" "no" "off"} (str/lower-case (str/trim v))))))))

(defn names-for
  "Enabled MCP servers selected by toolsets. A listed server is an
  allowlist; otherwise all enabled servers are included. `no_mcp`
  opts out."
  [config requested disabled]
  (let [servers (get config "mcp_servers" {})
        requested (vec (remove nil? requested))
        server-for (fn [name]
                     (cond
                       (contains? servers name) name
                       (and (string? name) (str/starts-with? name "mcp-")
                            (contains? servers (subs name 4))) (subs name 4)
                       :else nil))
        explicit (keep server-for requested)
        disabled-servers (set (keep server-for disabled))]
    (if (some #{"no_mcp"} requested)
      []
      (->> (if (seq explicit) explicit (keys servers))
           (filter #(and (enabled? (get servers %)) (not (contains? disabled-servers %))))
           sort vec))))

(defn- expand-string
  "Expand ${NAME} / ${env:NAME} against `env`; anything else stays
  literal. A hand scan, not str/replace with a match fn: what the fn
  receives is not the groups vector on every runner (on Basilisp the
  key arrives nil and every variable renders `${}`). Single pass over
  the original string, so substituted values are never rescanned —
  exactly the legacy replaceAll semantics."
  [s env]
  (let [s (str s)]
    (loop [out "" rest s]
      (let [i (text/index-of rest "${")]
        (if (nil? i)
          (str out rest)
          (let [j (text/index-of rest "}" (+ i 2))]
            (if (nil? j)
              (str out rest)
              (let [token (subs rest i (inc j))
                    inner (subs token 2 (dec (count token)))
                    key (if (str/starts-with? inner "env:") (subs inner 4) inner)]
                (if (re-matches #"[A-Za-z_][A-Za-z0-9_]*" key)
                  (recur (str out (subs rest 0 i) (str (get env key token))) (subs rest (inc j)))
                  (recur (str out (subs rest 0 (inc j))) (subs rest (inc j))))))))))))

(defn- expand-value [v env]
  (cond
    (string? v) (expand-string v env)
    (vector? v) (mapv #(expand-value % env) v)
    (map? v) (into {} (map (fn [[k x]] [k (expand-value x env)]) v))
    :else v))

(defn command-for
  [spec env]
  (let [command (expand-value (get spec "command") env)
        args (expand-value (get spec "args" []) env)]
    (cond
      (and (string? command) (not (str/blank? command))) (into [command] (if (vector? args) args []))
      (and (vector? command) (seq command)) (into (vec command) (if (vector? args) args []))
      :else nil)))

(defn server-env
  [spec env]
  (let [base (select-keys env ["PATH" "HOME" "TMPDIR" "LANG" "LC_ALL" "XDG_CONFIG_HOME"])
        configured (expand-value (get spec "env" {}) env)]
    (merge base (if (map? configured) configured {}))))

(defn- sanitize [s]
  (str/replace (str s) #"[^A-Za-z0-9_]" "_"))

(defn tool-name
  [server tool]
  (let [full (str "mcp__" (sanitize server) "__" (sanitize tool))]
    (if (<= (count full) max-name-length)
      full
      (str (subs full 0 (- max-name-length 9)) "_" (subs (cas/sha256-hex (hio/utf8-encode full)) 0 8)))))

(defn- object-schema [schema]
  (let [schema (if (map? schema) schema {})
        schema (if (or (= "object" (get schema "type"))
                       (contains? schema "properties") (contains? schema "required"))
                 (assoc schema "type" "object")
                 {"type" "object" "properties" {}})
        props (if (map? (get schema "properties")) (get schema "properties") {})
        required (get schema "required" [])]
    (cond-> (assoc schema "properties" props)
      (not (vector? required)) (assoc "required" [])
      (vector? required) (assoc "required" (vec (filter #(contains? props %) required))))))

(defn- filter-patterns [value]
  (cond
    (string? value) [value]
    (sequential? value) (vec (filter string? value))
    (set? value) (vec (filter string? value))
    :else []))

(defn- rpc [id method params]
  {"jsonrpc" "2.0" "id" id "method" method "params" params})

(defn handshake-lines
  "The two opening lines of a stdio session: initialize (id 1) plus
  notifications/initialized. The clientInfo name/version is the legacy
  constant."
  []
  [(hio/json-str (rpc 1 "initialize"
                      {"protocolVersion" protocol-version
                       "capabilities" {}
                       "clientInfo" {"name" "itonami-agent" "version" "0.1"}}))
   (hio/json-str {"jsonrpc" "2.0" "method" "notifications/initialized" "params" {}})])

(defn call-line
  [id method params]
  (hio/json-str (rpc id method params)))

(defn- parse-lines [lines]
  (into {}
        (for [line lines
              :let [m (try (hio/parse-json (str line)) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))]
              :when (and (map? m) (number? (get m "id")))]
          [(get m "id") m])))

(defn collect-call-results
  "Fold one stdio sequence's raw output lines into the legacy answer.
  The request is a string-keyed map (ids, lines, timed-out?, exit),
  like the wire maps it comes from. The process spawn stays host-side;
  everything after it is here."
  [{:strs [ids lines timed-out? exit]}]
  (cond
    timed-out? {"error" "MCP stdio sequence timed out"}
    (not= 0 (or exit 0)) {"error" (str "MCP stdio server exited " exit)}
    :else
    (let [responses (parse-lines lines)
          results (mapv (fn [id]
                          (let [response (get responses id)]
                            (cond
                              (nil? response) {"isError" true "error" "MCP server returned no response"}
                              (get response "error") {"isError" true "error" (get-in response ["error" "message"])}
                              :else (get response "result" {"isError" true "error" "MCP result was empty"}))))
                        ids)]
      {"results" results})))

(defn collect-exchange-result
  "Fold one single-call exchange's raw output lines into the legacy
  answer: the id-2 response map, or the exact error string.
  String keys, like the collect-call-results contract."
  [{:strs [method lines timed-out? exit]}]
  (cond
    timed-out? {"error" "MCP server timed out"}
    (not= 0 (or exit 0)) {"error" (str "MCP server exited " exit)}
    :else
    (let [response (first (for [line lines
                                :let [m (try (hio/parse-json (str line)) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil))]
                                :when (and (map? m) (= 2 (get m "id")))] m))]
      (cond
        (nil? response) {"error" "MCP server returned no JSON-RPC response"}
        (get response "error") {"error" (str "MCP " method " failed: " (get-in response ["error" "message"]))}
        :else (get response "result" {})))))

(defn render-result
  "A tool result to the call answer: errors, text + structuredContent
  dedupe, _meta passthrough. Verbatim from the legacy (nil result
  renders null, same as the legacy encoder)."
  [result]
  (let [content (get result "content" [])
        texts (keep (fn [part]
                      (when (and (map? part) (= "text" (get part "type")))
                        (get part "text"))) content)
        text (str/join "\n" texts)
        structured (or (get result "structuredContent") (get result "structured_content"))
        parsed (when-not (str/blank? text) (try (hio/parse-json text) (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ ::not-json)))
        structured (when-not (and (not= parsed ::not-json) (= parsed structured)) structured)
        meta (get result "_meta")]
    (cond
      (get result "isError") (hio/json-str {"error" (if (str/blank? text) "MCP tool returned an error" text)})
      (and (str/blank? text) (nil? structured) (seq content))
      (hio/json-str {"result" content})
      :else
      (hio/json-str (cond-> {"result" (if (str/blank? text) structured text)}
                      (and structured (not (str/blank? text))) (assoc "structuredContent" structured)
                      meta (assoc "_meta" meta))))))

(def hermes-native-aliases
  #{"vision_analyze" "image_generate" "browser_navigate" "browser_snapshot"
    "browser_click" "browser_type" "browser_scroll" "browser_back"
    "browser_press" "browser_get_images" "browser_vision" "browser_console"
    "browser_cdp" "browser_dialog" "browser_vault_list" "browser_vault_unlock"
    "browser_vault_fill" "browser_vault_save_login" "browser_vault_enter_code"
    "browser_exec" "text_to_speech" "computer_use" "manage_connections"
    "clarify" "kanban_create" "kanban_attach" "kanban_attach_url"
    "kanban_attachments"})

(defn- glob-match? [pattern name]
  (let [special #{\. \+ \^ \$ \{ \} \( \) \| \[ \] \\}
        regex (str "^" (apply str (map (fn [c]
                                        (cond
                                          (= c \*) ".*"
                                          (= c \?) "."
                                          (contains? special c) (str "\\" c)
                                          :else (str c))) pattern)) "$")]
    (boolean (re-matches (re-pattern regex) (str name)))))

(defn tool-allowed?
  [spec name]
  (let [raw (get spec "tools")
        filters (if (map? raw) raw (if (nil? raw) {} {"include" raw}))
        has-include (contains? filters "include")
        include (filter-patterns (get filters "include"))
        exclude (filter-patterns (get filters "exclude"))
        matches (fn [patterns] (some #(glob-match? % name) patterns))]
    (if has-include
      (boolean (matches include))
      (not (boolean (matches exclude))))))

(defn- finite?
  "js/Number.isFinite without the host: numbers that are neither NaN
  nor infinite. Everything else (strings included) is not finite."
  [x]
  (boolean (and (number? x) (= x x) (not (= x ##Inf)) (not (= x ##-Inf)))))

(defn- parse-int-str
  "Small ASCII integer strings (the float exponent); nil when malformed."
  [s]
  (let [[_ sign digits] (re-matches #"([+-]?)(\d+)" (str s))]
    (when digits
      (let [n (reduce (fn [a d] (+ (* a 10) d)) 0
                      (map #(str/index-of "0123456789" (str %)) digits))]
        (if (= "-" sign) (- n) n)))))

(defn- pow10
  "10^n as a double (ratios would diverge from JS doubles on bb)."
  [n]
  (if (neg? n)
    (/ 1.0 (double (apply * (repeat (- n) 10))))
    (double (apply * (repeat n 10)))))

(defn- parse-float
  "js/parseFloat(s) without the host: leading numeric-prefix
  semantics (\"123x\" reads 123, \"Infinity\" reads ##Inf), nil when
  no prefix parses (NaN upstream). Hex stays a leading-0 read, as
  parseFloat never went hex."
  [s]
  (let [s (str/trim (str s))
        m (re-matches #"\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|([+-]?[Ii]nfinity)).*" s)]
    (when m
      (if (nth m 2)
        (if (= \- (first (nth m 2))) ##-Inf ##Inf)
        (let [[_ sign int-part frac-part exp-part] (re-matches #"([+-]?)(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?" (nth m 1))
              digits (str int-part frac-part)
              ds (map #(str/index-of "0123456789" (str %)) digits)]
          (when (and (seq digits) (every? some? ds))
            (let [n (double (reduce (fn [a d] (+ (* a 10) d)) 0 ds))
                  scale (- (count frac-part))
                  e (if (str/blank? (str exp-part)) 0 (parse-int-str exp-part))]
              (when (some? e)
                (* (if (= "-" sign) -1.0 1.0) n (pow10 (+ scale e)))))))))))

(defn cache-status
  "The oauth-cache-ready decision over already-read records (file
  reads stay host-side, S6): {:fresh? :issuer-bound? :ready?}.
  `tokens`/`meta`/`client` are the cache maps (nil when unreadable),
  `spec` the server spec (client overrides), `now-s` the witness
  clock and `file-mtime-s`/`file?` the token-file witness."
  [tokens meta client spec now-s file-mtime-s file?]
  (let [stored-expiry (parse-float (str (get tokens "expires_at" "NaN")))
        ttl (parse-float (str (get tokens "expires_in" "NaN")))
        expiry (cond
                 (finite? stored-expiry) stored-expiry
                 (and (finite? ttl) file?) (+ (/ file-mtime-s 1000) ttl)
                 :else 0)
        fresh? (boolean (and (get tokens "access_token") (finite? expiry)
                             (> expiry (+ now-s 60))))
        client-id (or (get-in spec ["oauth" "client_id"]) (get client "client_id"))
        client-secret (or (get-in spec ["oauth" "client_secret"]) (get client "client_secret"))
        auth-method (or (get client "token_endpoint_auth_method") "none")
        endpoint (get meta "token_endpoint")
        issuer-bound? (boolean (and (get tokens "refresh_token")
                                   (string? (get tokens "hermes_issuer"))
                                   (= (get tokens "hermes_issuer") (get meta "issuer"))
                                   (string? endpoint) (str/starts-with? endpoint "https://")
                                   client-id
                                   (contains? #{"none" "client_secret_post" "client_secret_basic"} auth-method)
                                   (or (= "none" auth-method) client-secret)))]
    {:fresh? fresh? :issuer-bound? issuer-bound? :ready? (boolean (or fresh? issuer-bound?))}))

(defn project-discovery
  "The pure projection half of discover: exchange results in, schemas
  + dispatch index + errors out. `results` maps server names to the
  exchange-selected outcomes, keyword-enveloped like the legacy
  ({:tools [...]} / {:error ...}; tool payloads stay string-keyed).
  A server with no result counts as an exchange error. Disabled
  servers are skipped silently. Alias rows only fire for native
  names no other server claimed."
  [config servers results]
  (let [rows (vec
              (mapcat
               (fn [server]
                 (let [spec (get-in config ["mcp_servers" server])]
                   (if (not (enabled? spec))
                     []
                     (let [result (get results server)]
                       (if-let [error (or (:error result) (when (nil? result) "no exchange result"))]
                         [{:error-entry {"server" server "error" error}}]
                         (for [tool (get result "tools" [])
                               :let [raw (get tool "name")]
                               :when (and raw (tool-allowed? spec raw))]
                           [(tool-name server raw)
                            {"type" "function"
                             "function" {"name" (tool-name server raw)
                                         "description" (or (get tool "description") (str "MCP tool " raw " from " server))
                                         "parameters" (object-schema (or (get tool "inputSchema") (get tool "input_schema")))}}
                            [server raw]]))))))
               servers))
        data-rows (vec (filter vector? rows))
        alias-rows (for [[_ schema target] data-rows
                         :let [[_ raw] target
                               same-name (filter #(= raw (second (nth % 2))) data-rows)]
                         :when (and (contains? hermes-native-aliases raw)
                                    (= 1 (count same-name)))]
                     [raw (assoc-in schema ["function" "name"] raw) target])
        all-rows (into data-rows alias-rows)]
    {:schemas (mapv second all-rows)
     :index (into {} (map (fn [[name _ target]] [name target]) all-rows))
     :errors (mapv :error-entry (filter map? rows))}))
