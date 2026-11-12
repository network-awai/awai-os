(ns itonami.otehon.execute
  "Running one gated turn, as data, with the host's step runner injected.
  Plus rendering the finished transcript as a document, the ad-hoc
  counterpart of run/output-doc (the host saves and delivers it).
  Plus folding a finished transcript back into the legacy executor-result
  shape (`turn-from-transcript`) so the host can save it the legacy way.

  The gate (`itonami.otehon.turn/turn-gate`) decides; this namespace
  executes: it walks the gated plan's `:exec` steps in order with the
  caller-supplied `:step-fn`, records every step result in a
  transcript, and stops at the first non-ok step. Nothing is called,
  read or written here besides `:step-fn`: the model call, the tools
  and the stores stay host-side (the S5c injected-transport idiom).

  Fail-closed throughout: a non-ok gate passes through untouched
  (nothing runs), a malformed plan or step fails without running
  anything further, an unknown step outcome fails the turn, a
  non-map or throwing step function fails the turn. Steps are a
  sequential collection; anything else is a bad plan."
  (:require [clojure.string :as str]))

(defn- fail [reason more]
  (merge {:status :failed :reason reason :steps [] :ran 0} more))

(defn run-turn
  "Run gated plan `planned` with injected `:step-fn` (called as
  `(step-fn step)` for each `:exec` step, in order). Returns the
  transcript: `:status` is `:done` when every step reported `:ok`,
  otherwise the gate status passed through (`:held`/`:refused`) or
  `:failed`. `:steps` holds `{:id :index :result}` per attempted step,
  `:ran` counts them, `:failed-step` names the step that stopped a
  failed turn."
  [planned {:keys [step-fn]}]
  (cond
    (not (map? planned))
    (fail "turn/bad-plan" {:plan (str (type planned))})

    (not= :ok (:status planned))
    {:status (:status planned)
     :reason (:reason planned)
     :steps []
     :ran 0}

    :else
    (let [exec (:exec planned)]
      (cond
        (or (nil? exec) (and (sequential? exec) (empty? exec)))
        {:status :done :steps [] :ran 0}

        (not (sequential? exec))
        (fail "turn/bad-exec" {:exec (str (type exec))})

        (not (fn? step-fn))
        (fail "turn/no-step-fn" {})

        :else
        (loop [idx 0, [step & rest-steps] (vec exec), done []]
          (if (nil? step)
            {:status :done :steps done :ran (count done)}
            (if (not (and (map? step) (some? (:id step))))
              {:status :failed :reason "turn/bad-step"
               :steps done :ran (count done) :failed-step idx}
              (let [result (try (step-fn step)
                                (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
                                  {:status :threw :reason "turn/step-threw"
                                   :error (ex-message e)}))]
                (if (not (map? result))
                  {:status :failed :reason "turn/bad-result"
                   :steps done :ran (count done) :failed-step (:id step)}
                  (let [entry {:id (:id step) :index idx :result result}
                        done+ (conj done entry)]
                    (cond
                      (= :ok (:status result))
                      (recur (inc idx) rest-steps done+)

                      (= :unknown (:status result))
                      {:status :failed :reason "turn/unknown-step"
                       :steps done+ :ran (count done+)
                       :failed-step (:id step)}

                      :else
                      {:status :failed
                       :reason (or (:reason result) "turn/step-failed")
                       :steps done+ :ran (count done+)
                       :failed-step (:id step)})))))))))))

(defn render-transcript
  "The ad-hoc turn document for a finished `run-turn` transcript: the
  counterpart of run/output-doc (cron jobs). `run-at` is the host's
  display time. Secrets are the host's business (same contract as
  output-doc): only already-decided data goes in."
  [transcript {:keys [prompt run-at]}]
  (let [status (:status transcript)
        failed? (= :failed status)]
    (str "# Ad-hoc Turn" (when failed? " (FAILED)") "\n\n"
         "**Status:** " (name (or status :unknown)) "\n"
         (when-let [reason (:reason transcript)]
           (str "**Reason:** " reason "\n"))
         (when-let [failed-step (:failed-step transcript)]
           (str "**Failed step:** " failed-step "\n"))
         "**Ran:** " (count (:steps transcript [])) " step(s)\n"
         (when run-at (str "**Run Time:** " run-at "\n"))
         "\n## Prompt\n\n" (or prompt "") "\n"
         (if (seq (:steps transcript))
           (str "\n## Steps\n\n"
                (str/join "\n" (map (fn [{:keys [id index result]}]
                                      (str "- [" index "] " id ": "
                                           (name (or (:status result) :unknown))))
                                    (:steps transcript))))
           "\n(no steps ran)\n"))))

(defn turn-from-transcript
  "Fold a finished `run-turn` transcript into the legacy executor-result
  shape (`{:final :exit-reason ...}`, what `apply-turn!` saves): the live
  call stays host-side (the host's `:step-fn` performs the rail request
  and returns the legacy fields with `:status :ok`), this only decides
  which result the host saves. `:done` saves the last executed step's
  result (`:status` stripped: the legacy shape has none); anything else
  — failed turn, passed-through gate, empty or malformed transcript —
  fails closed as a `[CRON_FAILURE]` turn naming the transcript reason."
  [transcript]
  (if (and (map? transcript)
           (= :done (:status transcript))
           (seq (:steps transcript)))
    (dissoc (:result (last (:steps transcript))) :status)
    (let [reason (or (when (map? transcript) (:reason transcript))
                     "turn/empty-transcript")
          step (when (map? transcript) (:failed-step transcript))]
      {:final (str "[CRON_FAILURE] " reason
                   (when (some? step) (str " (step " step ")")))
       :exit-reason reason
       :error {:error reason}})))
