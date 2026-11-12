(ns itonami.otehon.dapps
  "The `itonami_dapps` toolset's static surface and checkout resolution.
  Faithful port of the `status` half of itonami.agent.dapps: the registry
  pin, the server table, resolve-checkout and status. `env` is one merged
  string map (the CLI passes the case env or the whole process env, so no
  host read hides inside the unit); the agent root comes from
  ITONAMI_AGENT_BIN in that same map. `with-servers` / `select-servers`
  stay a later slice: they need the MCP module's allowlist (S6)."
  (:require [clojure.string :as str]
            [itonami.otehon.exec :as exec]
            [itonami.otehon.io :as hio]
            [itonami.otehon.mcp :as mcp]))

(def toolset "itonami_dapps")

(def registry
  {:repository "cloud-itonami/itonami-registry"
   :commit "422e10b3fe6f1261e2daf9a58ada4f2b2b489a2b"})

(def servers
  [{:name "mihari"
    :entry "mcp/mihari"
    :title "mihari — Sentry-compatible error grouping and triage rules"
    :source {:repository "cloud-itonami/app-itonami-mihari"
             :commit "8f2ec46a27910b3ccb0827029819e109b34949"}
    :placeholder "MIHARI_REPO"
    :west-path "cloud-itonami/app-itonami-mihari"
    :launcher "bin/mihari-mcp"}
   {:name "dandori"
    :entry "mcp/dandori"
    :title "dandori — Linear-compatible export conversion and planning checks"
    :source {:repository "cloud-itonami/app-itonami-dandori"
             :commit "dbe623ba5b1048bddaab8b2d2b5630dd0c0e8"}
    :placeholder "DANDORI_REPO"
    :west-path "cloud-itonami/app-itonami-dandori"
    :launcher "bin/dandori-mcp"}])

(defn requested?
  [sets]
  (boolean (some #{toolset} sets)))

(defn- agent-root
  [env]
  (when-let [bin (get env "ITONAMI_AGENT_BIN")]
    (hio/dirname (hio/dirname bin))))

(defn- candidates
  [{:keys [placeholder west-path]} env]
  (let [explicit (get env placeholder)
        root (agent-root env)]
    (cond-> []
      (and (string? explicit) (not (str/blank? explicit)))
      (conj {:from placeholder
             :dir (exec/expand-home explicit (get env "HOME"))})
      root
      (conj {:from "west sibling"
             :dir (str root "/../../" west-path)}))))

(defn resolve-checkout
  "{:dir d :launcher l :from how} for the first candidate whose launcher
  exists, else {:error msg}. An explicit placeholder that does not hold
  the launcher is an error — falling through to another checkout would
  run something the operator did not name."
  [server env]
  (let [cs (candidates server env)
        found (first (filter #(hio/file? (str (:dir %) "/" (:launcher server))) cs))
        explicit (first (filter #(= (:placeholder server) (:from %)) cs))]
    (cond
      (and explicit (not= explicit found))
      {:error (str toolset ": " (:placeholder server) "=" (:dir explicit)
                   " has no " (:launcher server))}
      found
      (assoc found :launcher (str (:dir found) "/" (:launcher server)))
      :else
      {:error (str toolset ": no " (:west-path server) " checkout found; set "
                   (:placeholder server) " to its absolute path")})))

(defn server-spec
  [launcher]
  {"command" "kbb" "args" [launcher] "timeout" 90})

(defn with-servers
  "When `itonami_dapps` is requested: {:config c :added [names] :errors [...]}.
  `c` is `config` with each resolvable dapp server added to `mcp_servers`; a
  server the profile already defines is kept as the profile wrote it and still
  counts as added. Otherwise the config is returned unchanged."
  [config requested-sets env]
  (if-not (requested? requested-sets)
    {:config config :added [] :errors []}
    (reduce (fn [acc {:keys [name] :as server}]
              (if (get-in acc [:config "mcp_servers" name])
                (update acc :added conj name)
                (let [{:keys [error launcher]} (resolve-checkout server env)]
                  (if error
                    (update acc :errors conj {"server" name "error" error})
                    (-> acc
                        (assoc-in [:config "mcp_servers" name] (server-spec launcher))
                        ;; NOTE: the legacy threads `acc` twice here
                        ;; `(update acc ...)` inside `->`, so its success
                        ;; path always crashes with a 3-arg keyword call.
                        ;; Fixed here; recorded in COMPAT.md.
                        (update :added conj name))))))
            {:config config :added [] :errors []}
            servers)))

(defn select-servers
  "The MCP servers a run starts. `mcp/names-for` treats explicitly named
  servers as an allowlist, which would drop the dapps whenever another server
  is named (`-t mcp-cloudflare,itonami_dapps`); requesting the toolset names
  its servers, so they are added back unless the run opts out."
  [config requested disabled added]
  (let [base (mcp/names-for config requested disabled)
        off? (fn [s] (some #{s (str "mcp-" s)} disabled))]
    (cond
      (some #{"no_mcp"} requested) base
      (some #{toolset} disabled) (vec (remove (set added) base))
      :else (vec (distinct (concat base
                                   (filter #(and (not (off? %))
                                                (mcp/enabled? (get-in config ["mcp_servers" %])))
                                           added)))))))

(defn status
  "One row per dapp server for `itonami-agent dapps`: how it resolves on
  this host, without starting anything."
  [env]
  (vec (for [{:keys [name entry title source placeholder] :as server} servers
             :let [{:keys [error launcher from]} (resolve-checkout server env)]]
         (cond-> {"server" name "entry" entry "title" title
                  "registry" (str (:repository registry) "@" (subs (:commit registry) 0 12))
                  "source" (str (:repository source) "@" (subs (:commit source) 0 12))
                  "placeholder" placeholder}
           launcher (assoc "launcher" launcher "resolved_from" from)
           error (assoc "error" error)))))
