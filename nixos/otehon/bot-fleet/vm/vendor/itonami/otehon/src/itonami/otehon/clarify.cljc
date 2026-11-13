(ns itonami.otehon.clarify
  "The clarify tool core: structured multiple-choice / open-ended
  questions to the user. Faithful port of the pure core of
  itonami.agent.clarify (Hermes tools/clarify_tool.py semantics):
  entry shapes (qid/question/choices/choices_offered/multi_select),
  statuses (answered/skipped/unanswered), filter order, falsy handling
  and error strings all match. String answers print Python-style for
  nil/booleans (None/True/False); numbers and collections follow the
  host printer (a documented legacy divergence). `ask!` (a platform
  callback over a promise) stays host-side (S6c); `clean-answer` is
  public here so the step runner can reach it."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(def max-choices 4)   ;; the UI always appends an Other row
(def max-questions 5)
(def max-choice-chars 8000)
(def recommended-label "(Recommended)")
(def unavailable "Clarify tool is not available in this execution context.")
(def shape "Pass questions=[{question, choices?, multi_select?}]; a single question is a one-entry array.")

(defn- py-str
  "Python str() on an answer value: nil and booleans print Python-style
  (None/True/False); everything else follows the host printer."
  [x]
  (cond
    (nil? x) "None"
    (true? x) "True"
    (false? x) "False"
    :else (str x)))

(defn- py-truthy
  "Python truthiness: nil/false/zero/empty string and empty collections
  are falsy; everything else (including the whitespace string) is truthy."
  [x]
  (cond
    (nil? x) false
    (false? x) false
    (and (number? x) (zero? x)) false
    (and (string? x) (= "" x)) false
    (and (coll? x) (empty? x)) false
    :else true))

(defn- hermes-truthy-str
  "Hermes str(x-or-empty): falsy values (nil, false, empty string, 0,
  empty collections) become the empty string; everything else is stringified."
  [x]
  (cond
    (or (nil? x) (false? x)) ""
    (and (string? x) (str/blank? x)) ""
    (and (number? x) (zero? x)) ""
    (and (sequential? x) (empty? x)) ""
    (and (map? x) (empty? x)) ""
    :else (py-str x)))

(defn strip-recommended
  "Remove the recommendation label so presentation never leaks into
  `user_response`."
  [text]
  (let [s (str/trim (str text))
        lab recommended-label]
    (if (str/ends-with? (str/lower-case s) (str/lower-case lab))
      (str/trim (subs s 0 (- (count s) (count lab))))
      s)))

(defn mark-recommended
  "Suffix the first choice (schema says best-first) with the recommendation
  label; idempotent, and a lone choice is left untouched."
  [choices]
  (let [choices (vec choices)
        first0 (str/trim (str (first choices)))]
    (if (or (< (count choices) 2)
            (not= first0 (strip-recommended first0)))
      choices
      (into [(str first0 " " recommended-label)] (rest choices)))))

(defn clean-answer
  "Strip presentation (the label, multi-select JSON) from a locked answer,
  with Hermes' ORDER: blanks are filtered on the RAW item and the label is
  stripped after (so a label-only item is a non-blank raw that survives to
  become \"\"). A multi answer must be sequential: a scalar raises, exactly as
  Python's iteration does. Host arrays never cross the EDN step boundary,
  so only sequential values iterate here."
  [raw multi?]
  (if-not multi?
    (strip-recommended (py-str raw))
    (let [items (cond
                  (string? raw) (try (let [p (hio/parse-json raw)]
                                       (if (sequential? p) (vec p) [raw]))
                                     (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ [raw]))
                  (sequential? raw) (vec raw)
                  :else (throw (ex-info (str (py-str raw) " object is not iterable") {})))]
      (->> items
           ;; Python str(item).strip() truthiness: None and booleans are
           ;; NON-blank and survive ("None", "True"/"False"); only empty or
           ;; whitespace strings drop
           (remove #(str/blank? (py-str %)))
           (map (comp strip-recommended py-str))
           vec))))

(defn- normalize-item
  "One question entry -> [entry error]."
  [index item]
  (let [text (str/trim (hermes-truthy-str (get item "question")))]
    (cond
      (not (map? item))
      [nil (str "questions[" index "] must be an object. " shape)]

      (str/blank? text)
      [nil (str "questions[" index "].question must be non-empty text.")]

      :else
      (let [choices (get item "choices")]
        (if (nil? choices)
          [{"qid" (str "q" index)
            "question" text
            "choices" nil
            "choices_offered" nil
            "multi_select" false} nil]
          (cond
            (or (not (sequential? choices)) (some (fn [c] (not (string? c))) choices))
            [nil (str "questions[" index "].choices must be a list of strings.")]

            (some (fn [c] (< max-choice-chars (count (str/trim c)))) choices)
            [nil (str "questions[" index "].choices[" (count (take-while #(<= (count (str/trim %)) max-choice-chars) choices))
                      "] is over " max-choice-chars " characters; the limit is " max-choice-chars
                      ". Move detail into the question text and resend.")]

            :else
            (let [cleaned (vec (take max-choices (remove str/blank? (map str/trim choices))))]
              (if (and (seq choices) (empty? cleaned))
                [nil (str "questions[" index "].choices has " (count choices)
                          " entries but all are blank. Send real labels, or omit choices to ask open-ended.")]
                (let [offer (when (seq cleaned) cleaned)]
                  [{"qid" (str "q" index)
                    "question" text
                    "choices" (when offer (mark-recommended offer))
                    "choices_offered" offer
                    "multi_select" (and (py-truthy (get item "multi_select")) (some? offer))} nil])))))))))

(defn normalize-questions
  "Hermes `_normalize_questions`: -> [normalized error]. Entries carry qid
  (stable wire id q<index>), question, decorated choices, bare choices_offered
  and multi_select."
  [questions]
  (cond
    (or (not (sequential? questions)) (empty? questions))
    [nil (str "questions must be a non-empty array. " shape)]

    (< max-questions (count questions))
    [nil (str "questions supports at most " max-questions " items.")]

    :else
    (reduce (fn [acc pair]
              (let [index (first pair)
                    item (second pair)
                    [entry error] (normalize-item index item)]
                (if error
                  (reduced [nil error])
                  (update acc 0 conj entry))))
            [[] nil]
            (map-indexed vector questions))))

(defn response-status
  "One entry's answering state -> [status value]: the answered-or-not
  decision follows Python truthiness of the cleaned value."
  [qid answers multi?]
  (let [raw (get answers qid)
        cleaned (when-not (or (nil? raw) (= "" raw)) (clean-answer raw multi?))]
    ;; the answered-or-not decision follows Python truthiness of the cleaned
    ;; value, in one place (py-truthy), like every other truthiness call here
    (if (and cleaned (py-truthy cleaned))
      ["answered" cleaned]
      [(if (contains? answers qid) "skipped" "unanswered") nil])))

(defn result-json
  "Hermes `_result`: every response carries status and user_response (null
  unless answered); outcome says how the wait ended and notice (surface-
  supplied) says why. A reply without `outcome` is an error, never a silent null."
  [normalized reply]
  (when-not (contains? (into #{} (keys reply)) "outcome")
    (throw (ex-info "'outcome'" {})))
  (let [raw-answers (get reply "answers")
        ;; a non-map answers (42, "abc", [1 2]) is a contract violation, not
        ;; a silent all-unanswered
        _ (when (and (some? raw-answers) (not (map? raw-answers)))
            (throw (ex-info "answers must be a map of qid to answer" {})))
        answers (or raw-answers {})
        responses (mapv (fn [entry]
                          (let [[status value] (response-status (get entry "qid") answers (get entry "multi_select"))]
                            {"question" (get entry "question")
                             "choices_offered" (get entry "choices_offered")
                             "status" status
                             "user_response" value}))
                        normalized)
        ;; Hermes includes the notice on Python TRUTHINESS of the raw value:
        ;; " " is included; 0/false/empty strings and collections are not
        notice (get reply "notice")
        result (cond-> {"responses" responses "outcome" (get reply "outcome")}
                 (py-truthy notice) (assoc "notice" (py-str notice)))]
    (hio/json-str result)))
