(ns itonami.otehon.connections
  "The connection surfaces, read-only: the local MCP servers from the run
  config with their cached OAuth state, plus the dapp surface. Faithful
  port of itonami.agent.connections (slice 1). Install/authorize is slice
  2 (config writing plus human approval) and stays out, as do the hosted
  connector accounts: with no tool gateway on this world they answer the
  named error, never a silent fallback. `env` is the one merged string
  map (case env or the whole process env); `home` is the store root whose
  mcp-tokens/ dir holds the cached token records."
  (:require [clojure.string :as str]
            [itonami.otehon.dapps :as dapps]
            [itonami.otehon.io :as hio]
            [itonami.otehon.oauth :as oauth]))

(def hosted-error
  "hosted connector accounts need a tool gateway - not configured here")

(defn- auth-status
  "The cached OAuth state for one server: the mcp-tokens store the Hermes
  MCP token cache reads (issuer-bound). File presence and expiry only —
  never a token value."
  [home server]
  (let [f (str home "/mcp-tokens/" (oauth/store-name server) ".json")]
    (if (hio/file? f)
      (try
        (let [rec (hio/parse-json (hio/slurp-utf8 f))
              exp-present (and (map? rec) (contains? rec "expires_at"))
              exp (when exp-present (get rec "expires_at"))]
          ;; a parseable but non-object record (null, [], 42, false) is
          ;; corrupt — it must never read as healthy
          (when-not (map? rec)
            (throw (ex-info "token record is not an object" {})))
          ;; policy: a record WITHOUT expires_at is a no-expiry token
          ;; (token-cached); the boundary itself counts as expired; a
          ;; PRESENT but non-numeric expires_at is corrupt
          (cond
            ;; ABSENT key = the no-expiry policy; a PRESENT null is corrupt
            (not exp-present) "token-cached"
            (nil? exp) "token-unreadable"
            (number? exp) (if (<= exp (quot (hio/now-ms) 1000)) "token-expired" "token-cached")
            :else "token-unreadable"))
        (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ "token-unreadable"))
      "needs-login")))

(defn connection-status
  "One row per requested connector — or every configured surface when none
  is named. Each row names its kind and either its state or its error; a
  hosted connector answers the named unavailability, never a silent
  fallback."
  [config env home requested]
  (let [mcp-names (set (keys (get config "mcp_servers")))
        req (if (and (sequential? requested) (seq requested)) (vec requested) nil)]
    (cond
      (and (some? requested) (not (sequential? requested)))
      {"error" "connections must be a list of objects like {name, mcp}"}

      (and req (some (fn [i] (not (map? i))) req))
      {"error" "connections must be a list of objects like {name, mcp}"}

      :else
      (if (nil? req)
        ;; nothing named: every configured surface
        (vec (concat
              (for [n (sort mcp-names)]
                {"name" n "kind" "mcp" "configured" true "auth" (auth-status home n)})
              (for [row (dapps/status env)]
                ;; normalize the row identity to "name" like every other row
                (cond-> (assoc row "kind" "dapp")
                  (and (get row "server") (not (get row "name"))) (assoc "name" (get row "server"))))))
        (mapv (fn [item]
                (let [raw-name (get item "name")
                      n (if (string? raw-name) raw-name "")
                      mcp-val (get item "mcp")]
                  (cond
                    ;; names must be non-blank STRINGS — never coerced from
                    ;; false/numbers into usable-looking names
                    (str/blank? n)
                    {"name" (str raw-name) "error" "a connection needs a non-blank name string"}

                    ;; a PRESENT mcp must be boolean — null is not absent
                    (and (contains? item "mcp") (not (boolean? mcp-val)))
                    {"name" n "error" "mcp must be boolean or absent (omit the key)"}

                    :else
                    (let [mcp? (or (true? mcp-val) (contains? mcp-names n))]
                      (if mcp?
                        {"name" n "kind" "mcp"
                         "configured" (contains? mcp-names n)
                         "auth" (if (contains? mcp-names n) (auth-status home n) "needs-login")}
                        {"name" n "kind" "hosted" "error" hosted-error})))))
              req)))))
