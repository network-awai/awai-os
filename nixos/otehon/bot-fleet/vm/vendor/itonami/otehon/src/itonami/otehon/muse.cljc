(ns itonami.otehon.muse
  "Explicit, tool-free Muse/Meta adapter contract. No fallback or authority grants."
  (:require [clojure.string :as str]
            [itonami.otehon.turn :as turn]))

(defn plan [prof prompt]
  (let [gate (turn/turn-gate prof prompt {:capabilities [:inference_muse] :toolsets ["inference-only"]
                                         :known-catalog ["inference-only"]})
        target (:inference gate)]
    (cond
      (not= :ok (:status gate)) gate
      (not (some #{:muse} (get-in prof [:manifest :inference :rails])))
      {:status :refused :reason "muse/explicit-opt-in-required"}
      (or (not= "muse" (:provider target)) (not= "https://api.meta.ai/v1" (:base-url target)))
      {:status :refused :reason "muse/meta-cli-target-required"}
      (not (and (string? (:model target)) (re-matches #"[A-Za-z0-9][A-Za-z0-9._-]{0,127}" (:model target))))
      {:status :refused :reason "muse/pinned-model-required"}
      (or (not (string? prompt)) (str/blank? prompt) (> (count prompt) 32768))
      {:status :refused :reason "muse/prompt-limit"}
      :else {:status :ok :profile (:name prof) :provider "meta" :model (:model target)
             :reasoning-effort (or (:reasoning-effort gate) "low")
             :tools [] :max-model-steps 1 :fallback false})))

(defn result
  "Only one configured real Meta run, its final terminal and cumulative usage.
  A process exit is not completion. Unknown never authorizes replay."
  [planned events exit-code]
  (let [configs (filter #(= "run.model.configured" (:payload_type %)) events)
        ids (set (keep #(get-in % [:payload :run_stream :id]) configs))
        run-id (when (= 1 (count ids)) (first ids))
        rows (filter #(and run-id (= run-id (get-in % [:payload :run_stream :id]))) events)
        terminals (filter #(= "run.terminal.completed" (:payload_type %)) rows)
        terminal (:payload (last (sort-by :sequence terminals)))
        usage (filter #(= "run.usage" (:payload_type %)) rows)
        grouped (group-by #(vector (get-in % [:stream :kind]) (get-in % [:stream :id]) (:sequence %)) usage)
        conflict? (some #(> (count (set (map :payload %))) 1) (vals grouped))
        snapshot (:payload (last (sort-by :sequence (map first (vals grouped)))))
        configured? (and (seq configs) (= 1 (count ids))
                         (every? #(and (= "meta" (get-in % [:payload :provider_id]))
                                       (= (:model planned) (get-in % [:payload :model_id]))) configs))
        tools? (some #(re-find #"(^tool[.]|[.]tool[.])" (str (:payload_type %))) rows)
        complete? (and (= :ok (:status planned)) (zero? exit-code) configured? (not conflict?) (not tools?)
                       (= "completed" (:terminal terminal)) (string? (:text terminal))
                       (not (str/blank? (:text terminal))))]
    {:schema "itonami.muse-result.v1" :state (if complete? "completed" "unknown")
     :provider "meta" :model (:model planned) :reasoning-effort (:reasoning-effort planned)
     :muse-run-id run-id :tools [] :fallback false
     :text (when complete? (:text terminal))
     :usage (when (and configured? (not conflict?)) snapshot)
     :usage-coverage (if snapshot "selected-run-final-cumulative-snapshot" "unknown")
     :normalization {:reasoning "output subset; do not add" :cached "raw field; relationship unverified; do not add"}
     :reason (when-not complete? "muse/incomplete-or-ambiguous-no-retry")}))
