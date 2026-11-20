(ns itonami.otehon.assembly
  "Portable turn-assembly core of `itonami.agent.loop` (the agent turn
  loop) for the Otehon .cljc core, with one pinned answer on every runner.

  Ported: `history-messages`, `wrapup-notice`, `wrap-up?`,
  `maybe-inject-run-budget-wrapup`, `turn-limit-unlimited`,
  `unlimited-spellings`, `parse-turn-count`, `resolve-turn-limit`,
  `resolve-max-turns`. The `:turn-asm` shared-case op exercises these.

  The `run` loop itself stays host-side (MCP/browser/dapps/tool wiring,
  clarify-fn, subagents, live rail calls), as do `system-prompt`,
  `skills-index` and `context-file` (they read the skills home, the
  context file and the live clock, so no shared case can pin them).

  Portability: the turn cap is `Number.MAX_SAFE_INTEGER`
  (9007199254740991), exactly the legacy `.cljk` sentinel, so every
  runner pins the same digits. Float parsing, finiteness and truncation
  use per-runner readers (`:lpy` included); NaN is detected portably
  with `(not= v v)`. Underscore separators are stripped by an explicit
  char loop (no `$1` replacement groups, whose portable meaning the
  oracle never established). The `∞` spelling is built from its code
  point, never a `\\u` escape."
  (:require [clojure.string :as str]))

(def max-safe-int
  "The legacy `.cljk` unlimited sentinel (`js/Number.MAX_SAFE_INTEGER`)."
  9007199254740991)

(def turn-limit-unlimited max-safe-int)

(def ^:private infinity-glyph (str #?(:lpy (chr 8734) :clj (char 8734) :cljs (.fromCharCode js/String 8734))))

(def unlimited-spellings
  "Hermes' `_UNLIMITED_SPELLINGS`, matched against the trimmed,
  lowercased string."
  (conj #{"none" "null" "unlimited" "infinite" "infinity" "inf" "-1" "0"} infinity-glyph))

(defn history-messages
  "Normalize prior user/assistant messages for a new agent turn. System/developer
  instructions are supplied separately; tool messages belong to the previous
  turn and are intentionally omitted from the desktop-compatible history."
  [history]
  (vec (for [m (or history [])
             :let [role (or (get m "role") (:role m))
                   content (or (get m "content") (:content m))]
             :when (contains? #{"user" "assistant"} role)]
         {"role" role
          "content" (cond
                      (string? content) content
                      (sequential? content)
                      (str/join "\n" (keep (fn [part]
                                            (when (or (= "text" (get part "type"))
                                                      (= "text" (:type part)))
                                              (or (get part "text") (:text part) "")))
                                          content))
                      (nil? content) ""
                      :else (str content))})))

(def wrapup-notice
  "Hermes agent/conversation_loop.RUN_BUDGET_WRAPUP_NOTICE, verbatim."
  "[SYSTEM NOTICE — run time budget nearly exhausted] Run time budget nearly exhausted. Stop new discovery/verification work now. Produce the required final deliverable (answer/JSON/summary) from the state you already have, completing only mandatory writes.")

(defn wrap-up?
  "Hermes' _maybe_inject_run_budget_wrapup threshold: the notice fires at
  elapsed >= 0.8 * budget — 5 * elapsed >= 4 * budget in whole milliseconds —
  and never on a non-positive budget (Hermes treats an unset budget as dormant)."
  [elapsed-ms budget-ms]
  (and (pos? budget-ms) (>= (* 5 elapsed-ms) (* 4 budget-ms))))

(defn maybe-inject-run-budget-wrapup
  "Hermes agent/conversation_loop._maybe_inject_run_budget_wrapup: append the
  one-shot wrap-up notice (\"\\n\\n\" + notice) to the NEWEST tool result.
  `injected?` (an atom) latches only on a successful append, so a round with
  no tool results leaves it open and a later round delivers the notice."
  [results injected? budget-ms elapsed-ms]
  (if (and (seq results) (not @injected?) (wrap-up? elapsed-ms budget-ms))
    (do (reset! injected? true)
        (update-in results [(dec (count results)) "content"] #(str % "\n\n" wrapup-notice)))
    results))

(defn- parse-num
  [s]
  (try #?(:lpy (python/float (str s))
          :clj (Double/parseDouble (str s))
          :cljs (js/parseFloat (str s)))
       (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ nil)))

(defn- finite-num?
  [v]
  (boolean (and (number? v)
                (= v v)
                #?(:lpy (try (boolean (.isfinite (python/__import__ "math") v))
                             (catch python/Exception _ false))
                   :clj (Double/isFinite (double v))
                   :cljs (js/Number.isFinite v)))))

(defn- trunc-num
  [v]
  #?(:lpy (python/int v)
     :clj (long v)
     :cljs (js/Math.trunc v)))

(defn- strip-num-underscores
  "Drop `_` only between two digits, as Python's int/float accept them."
  [s]
  (let [n (count s)]
    (loop [i 0 out []]
      (if (>= i n)
        (apply str out)
        (let [c (nth s i)]
          (if (and (= c \_) (> i 0) (< (inc i) n)
                   (let [p (nth s (dec i)) q (nth s (inc i))
                         digit? #{\0 \1 \2 \3 \4 \5 \6 \7 \8 \9}]
                     (and (contains? digit? p) (contains? digit? q))))
            (recur (inc i) out)
            (recur (inc i) (conj out c))))))))

(defn- parse-turn-count
  "Python's int(s), then int(float(s)) as the fallback. Returns the
  truncated integer, or nil when Python would raise (hex, garbage,
  non-finite)."
  [s]
  (let [norm (strip-num-underscores (str s))]
    (when (re-matches #"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?" norm)
      (let [f (parse-num norm)]
        (when (and (some? f) (finite-num? f)) (trunc-num f))))))

(defn resolve-turn-limit
  "Hermes hermes_cli/config.py:resolve_turn_limit — normalize a raw
  `agent.max_turns` value into an int iteration cap (always >= 1). nil, bools,
  unknown types and unparseable strings return the default (unlimited at every
  call site); numbers truncate toward zero and any n <= 0 is unlimited."
  ([raw] (resolve-turn-limit raw turn-limit-unlimited))
  ([raw default]
   (cond
     (or (nil? raw) (boolean? raw)) default
     (number? raw) (if (finite-num? raw)
                     (let [n (trunc-num raw)]
                       (if (<= n 0) turn-limit-unlimited n))
                     default)
     (string? raw) (let [s (str/trim (str/lower-case raw))]
                     (cond
                       (str/blank? s) default
                       (contains? unlimited-spellings s) turn-limit-unlimited
                       :else (if-let [n (parse-turn-count s)]
                               (if (<= n 0) turn-limit-unlimited n)
                               default)))
     :else default)))

(defn resolve-max-turns
  "Hermes hermes_cli/cli_init_mixin._init_turn_limits — the turn cap is the
  first NON-nil of (CLI/API value, agent.max_turns, root-level max_turns,
  HERMES_MAX_ITERATIONS) resolved through resolve-turn-limit. Unset is
  unlimited, never a fixed default; a present `false` is resolved (and becomes
  unlimited), not skipped."
  [opt-val config env-val]
  (resolve-turn-limit
   (reduce (fn [_ x] (if (some? x) (reduced x) nil)) nil
           [opt-val (get-in config ["agent" "max_turns"]) (get config "max_turns") env-val])))
