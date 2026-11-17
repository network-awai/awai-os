(ns itonami.otehon.browser-provider
  "Cloud browser provider resolution. Faithful port of the pure heads
  of itonami.agent.browser-provider (the Hermes registry +
  resolution layer): explicit provider wins regardless of
  availability, a configured-but-unregistered name falls back to
  auto-detect, auto-detect walks only the legacy preference list
  (browser-use -> browserbase), otherwise nil for local mode.

  The registry atom and the is-available probes stay host-side (S6):
  resolution takes the registry snapshot and an availability witness
  explicitly, like the runner-stub pattern."
  (:require [clojure.string :as str]))

(def default-provider "local")

(def legacy-preference ["browser-use" "browserbase"])

(defn normalize-provider
  "Trimmed, lower-cased; `local` when unset or blank."
  [v]
  (let [s (str/trim (str/lower-case (str v)))]
    (if (str/blank? s) default-provider s)))

(defn resolve-provider
  "The active cloud browser provider name for a config value, or nil
  for local browser mode. `registry` maps names to provider records
  (presence = registered); `available` maps names to booleans (absent
  counts as unavailable, matching the legacy is-available-safe
  catch)."
  [registry available configured]
  (let [raw (str/trim (str configured))
        nm (normalize-provider configured)
        eligible? (fn [name] (and (contains? registry name) (true? (get available name))))
        auto-detect (fn [] (some (fn [name] (when (eligible? name) name)) legacy-preference))]
    (cond
      (= raw "local") nil
      (not (str/blank? raw)) (or (when (contains? registry nm) nm) (auto-detect))
      :else (auto-detect))))
