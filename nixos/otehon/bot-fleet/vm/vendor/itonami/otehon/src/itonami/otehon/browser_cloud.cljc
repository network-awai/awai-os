(ns itonami.otehon.browser-cloud
  "Cloud browser provider data shapes: Browserbase / Browser Use
  session payloads, the 402 paid-feature downgrade, feature flags,
  session records, close-request specs and config checks. Faithful
  port of the pure heads of itonami.agent.browser-cloud (the bundled
  Hermes plugins ported to the itonami plane).

  Host-side and staying S6: env reads, random-hex, fetch, timeouts,
  the 402 retry loop itself (the single downgrade step is pure) and
  provider registration."
  (:require [clojure.string :as str]))

(def browser-use-base-url "https://api.browser-use.com/api/v3")

(defn session-name
  "The unique name handed to agent-browser --session. The random
  suffix is generated host-side (the CLI) and passed in."
  [task-id rand-hex]
  (str "itonami_" task-id "_" rand-hex))

(defn browserbase-config
  "BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID are both required
  (cheap check, no network); the endpoint defaults per-profile.
  Blank values count as unset, as everywhere else."
  [api-key project-id base-url]
  (when-not (or (str/blank? (str api-key)) (str/blank? (str project-id)))
    {"api_key" (str api-key) "project_id" (str project-id)
     "base_url" (str/replace (str (or base-url "https://api.browserbase.com")) #"/$" "")}))

(defn browser-use-config
  [api-key]
  (when-not (str/blank? (str api-key))
    {"api_key" (str api-key) "base_url" browser-use-base-url}))

(defn browserbase-payload
  "The POST /v1/sessions body. Flags arrive explicit (the env-string
  reading stays host-side); a non-positive timeout is dropped, as
  the legacy `pos?` guard does."
  [project-id {:keys [keep-alive? proxies? stealth? timeout]}]
  (cond-> {"projectId" (str project-id)}
    keep-alive? (assoc "keepAlive" true)
    (and (number? timeout) (pos? timeout)) (assoc "timeout" timeout)
    proxies? (assoc "proxies" true)
    stealth? (assoc "browserSettings" {"advancedStealth" true})))

(defn downgrade-payload
  "One 402 paid-feature downgrade step: drop keepAlive first, then
  proxies. Returns [payload dropped-this-step]; a third call is a
  no-op, and the retry loop itself stays S6."
  [payload]
  (cond (contains? payload "keepAlive") [(dissoc payload "keepAlive") #{"keepAlive"}]
        (contains? payload "proxies") [(dissoc payload "proxies") #{"proxies"}]
        :else [payload #{}]))

(defn browserbase-features
  "The feature flags recorded on the session: a flag survives only
  when it was requested and not dropped by a 402 downgrade;
  custom_timeout mirrors whether the sent payload carried one."
  [enable-proxies enable-stealth enable-keep-alive has-timeout? dropped]
  {"basic_stealth" true
   "proxies" (boolean (and enable-proxies (not (contains? dropped "proxies"))))
   "advanced_stealth" (boolean enable-stealth)
   "keep_alive" (boolean (and enable-keep-alive (not (contains? dropped "keepAlive"))))
   "custom_timeout" (boolean has-timeout?)})

(defn browserbase-session
  "The session metadata record (verbatim keys — bb_session_id is the
  legacy key name holding the provider's session id)."
  [session-name data features]
  {"session_name" (str session-name)
   "bb_session_id" (get data "id")
   "cdp_url" (get data "connectUrl")
   "features" features})

(defn browser-use-session
  [session-name data]
  {"session_name" (str session-name)
   "bb_session_id" (get data "id")
   "cdp_url" (or (get data "cdpUrl") (get data "connectUrl") "")
   "expires_at" (get data "timeoutAt")
   "features" {"browser_use" true}})

(defn- close-spec [config session-id method path headers body]
  {:method (str/upper-case (str method))
   :url (str (get config "base_url") (str/replace (str path) "{session_id}" (str session-id)))
   :headers headers
   :body body})

(defn browserbase-close
  "The release call spec: POST .../v1/sessions/{id} with the project
  + REQUEST_RELEASE body."
  [config session-id]
  (close-spec config session-id "post" "/v1/sessions/{session_id}"
              {"X-BB-API-Key" (get config "api_key")
               "Content-Type" "application/json"}
              {"projectId" (get config "project_id")
               "status" "REQUEST_RELEASE"}))

(defn browser-use-close
  [config session-id]
  (close-spec config session-id "patch" "/browsers/{session_id}"
              {"Content-Type" "application/json"
               "X-Browser-Use-API-Key" (get config "api_key")}
              {"action" "stop"}))
