(ns itonami.otehon.homeassistant
  "The pure argument shapes of the Hermes-compatible Home Assistant
  REST tools. Ported from itonami.agent.homeassistant: the entity /
  service validators, the blocked-domain gate, data coercion, the
  service payload builder and the state/service/result projections.
  The fetch, the JSON envelopes and the tool dispatch stay host-side
  (S6): these fns answer data, and throwing guards answer reason
  strings (nil when fine) so shared cases pin them without
  host-dependent ex-messages."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(def entity-id-re #"^[a-z_][a-z0-9_]*\.[a-z0-9_]+$")
(def service-name-re #"^[a-z][a-z0-9_]*$")
(def blocked-domains
  #{"shell_command" "command_line" "python_script" "pyscript" "hassio" "rest_command"})

(defn entity-id-error
  [entity-id]
  (when-not (and (string? entity-id) (re-matches entity-id-re entity-id))
    (str "Invalid entity_id format: " entity-id)))

(defn service-error
  [kind value]
  (when-not (and (string? value) (re-matches service-name-re value))
    (str "Invalid " kind " format: " (pr-str value))))

(defn blocked-error
  [domain]
  (when (contains? blocked-domains domain)
    (str "Service domain '" domain "' is blocked for security")))

(defn coerce-data
  "Call data to a map. Verbatim from the legacy: nil is {}, maps pass,
  blank strings are {}, other strings must parse as JSON (whatever the
  parser answers — scalars included, exactly as the legacy passes
  them on). Anything else is refused."
  [data]
  (cond
    (nil? data) {}
    (map? data) data
    (string? data) (if (str/blank? data)
                     {}
                     (try (hio/parse-json data)
                          (catch #?(:lpy python/Exception :clj Exception :cljs :default) _
                            {"error" "Invalid JSON string in 'data' parameter"})))
    :else {"error" "data must be a JSON object or JSON string"}))

(defn build-payload
  "The service-call payload, or the first refusal in legacy order:
  domain format, service format, blocked domain, entity format, data
  coercion (and a data-coercion refusal rides through as the payload)."
  [domain service entity-id data]
  (or (service-error "domain" domain)
      (service-error "service" service)
      (blocked-error domain)
      (when entity-id (entity-id-error entity-id))
      (let [d (coerce-data data)]
        (if (and (map? d) (contains? d "error"))
          d
          (cond-> d entity-id (assoc "entity_id" entity-id))))))

(defn project-states
  "The list-entities filter + projection over fetched states."
  [states domain area]
  (let [states (filter (fn [state]
                         (and (or (str/blank? domain)
                                  (str/starts-with? (get state "entity_id" "") (str domain ".")))
                              (or (str/blank? area)
                                  (let [a (str/lower-case area)
                                        attrs (get state "attributes" {})]
                                    (or (str/includes? (str/lower-case (get attrs "friendly_name" "")) a)
                                        (str/includes? (str/lower-case (get attrs "area" "")) a))))))
                       states)
        entities (mapv (fn [state]
                         {"entity_id" (get state "entity_id")
                          "state" (get state "state")
                          "friendly_name" (get-in state ["attributes" "friendly_name"] "")})
                       states)]
    {"count" (count entities) "entities" entities}))

(defn project-state
  "The get-state projection over one fetched state."
  [state]
  (select-keys state ["entity_id" "state" "attributes" "last_changed" "last_updated"]))

(defn project-services
  "The list-services projection over fetched services."
  [services domain]
  (let [services (filter #(or (str/blank? domain) (= domain (get % "domain"))) services)
        result (mapv (fn [entry]
                       {"domain" (get entry "domain" "")
                        "services" (into {}
                                         (map (fn [[service info]]
                                                [service
                                                 (cond-> {"description" (get info "description" "")}
                                                   (seq (get info "fields"))
                                                   (assoc "fields"
                                                          (into {}
                                                                (map (fn [[field details]]
                                                                       [field (get details "description" "")])
                                                                     (get info "fields")))))]))
                                         (get entry "services" {}))})
                     services)]
    {"count" (count result) "domains" result}))

(defn project-affected
  "The call-service affected-entities projection over one result."
  [result]
  (if (vector? result)
    (mapv #(select-keys % ["entity_id" "state"]) result)
    []))
