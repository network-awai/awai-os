(ns itonami.otehon.rails
  "The pure selection core of itonami.agent.rails: which local
  OpenAI-compatible rail answers a model. Ported: small-model? (with a
  portability rewrite, see below), the llama path-id normalization, the
  detect row shape, all-models / agent-models / candidates. Host-side and
  staying out (S6): rails.edn read/write, the loopback probe, detect's
  port fan-out, complete's fetch loop. `detect-entries` takes already
  probed [port base ids] rows the way injected seams do elsewhere, so
  the same shape the live fan-out builds is what the cases pin."
  (:require [clojure.string :as str]))

(defn small-model?
  "A model too small for tool-calling agent turns (served only when a
  request names it exactly). Truthiness only: the legacy answers the
  re-find match and every caller branches on it, so the port answers a
  boolean. The trailing `\\b` is an explicit guard — regex `\\b` never
  matches on the bb runner (see PORTABILITY.md)."
  [ids]
  (boolean (some #(re-find #"(?i)(0\.[0-9]+b|1\.?[0-9]?b)(?:[^A-Za-z0-9_]|$)|-0\.6b|-1b" (str %)) ids)))

(defn normalize-model-ids
  "llama-server names its model by file path: serve it under the file's
  base name, and under the deployment directory name
  (/data/mishima/model/x.gguf -> \"mishima\") so peers can ask for it."
  [ids]
  (vec (distinct
        (mapcat (fn [id]
                  (let [id (str id)]
                    (if (str/starts-with? id "/")
                      (let [parts (str/split id #"/")
                            base (str/replace (last parts) #"\.gguf$" "")
                            dep (some (fn [[a b]] (when (= b "model") a)) (partition 2 1 parts))]
                        (remove #(or (nil? %) (= % "model")) [dep base]))
                      [id])))
                ids))))

(defn detect-entries
  "One row per probed rail, best-effort order kept: small rails sink by
  +100 priority and lose the agent flag. `found` is [[port base ids]
  ...] without nils, as the live fan-out hands over."
  [found]
  (vec (map-indexed
        (fn [i [port base ids]]
          (let [ids (normalize-model-ids ids)]
            {:name (str "local-" port) :base-url base :models ids
             :priority (if (small-model? ids) (+ 100 i) i)
             :agent? (not (small-model? ids))}))
        found)))

(defn all-models [rails]
  (vec (distinct (mapcat :models (:local rails)))))

(defn agent-models [rails]
  (vec (distinct (mapcat :models (filter :agent? (:local rails))))))

(defn select-candidates
  "Rails that can answer `model`, best first. \"auto\" / blank / unknown
  model -> every agent-capable rail, each with its own first model."
  [rails model]
  (let [rs (sort-by :priority (:local rails))
        exact (filter #(some #{model} (:models %)) rs)]
    (vec (if (seq exact)
           (map #(assoc % :use-model model) exact)
           (for [r rs :when (:agent? r)] (assoc r :use-model (first (:models r))))))))
