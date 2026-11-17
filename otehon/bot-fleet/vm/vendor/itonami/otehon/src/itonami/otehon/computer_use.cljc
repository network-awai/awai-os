(ns itonami.otehon.computer-use
  "The pure argument half of itonami.agent.computer-use: key-name
  canonicalization, the dangerous-input gate, window selection, the
  driver request builder, action request assembly and result shaping.
  The driver spawn, capture/list flows, approval and the tool dispatch
  stay host-side (S6). `action-request` reads its target from the
  ctx atom and throws exactly like the legacy; shared cases pin the
  throws as crash messages (static strings, identical on every
  runner)."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(defn build-request
  [name session args]
  [name (assoc (or args {}) "session" session)])

(defn content-text
  [result]
  (->> (get result "content" [])
       (keep #(when (and (= "text" (get % "type")) (string? (get % "text"))) (get % "text")))
       (str/join "\n")))

(defn image-parts
  [result]
  (->> (get result "content" [])
       (keep (fn [part]
               (when (and (= "image" (get part "type"))
                          (string? (get part "data"))
                          (<= (count (get part "data")) (* 12 1024 1024)))
                 {"type" "image_url"
                  "image_url" {"url" (str "data:" (or (get part "mimeType") "image/png")
                                           ";base64," (get part "data"))}})))
       vec))

(defn result-error
  [result]
  (when (or (true? (get result "isError")) (get result "error"))
    (or (get result "error") (content-text result) "cua-driver rejected the operation")))

(defn structured
  [result]
  (let [value (get result "structuredContent")]
    (if (map? value) value {})))

(defn error-result
  [message]
  {"$kotoba_tool_text" (hio/json-str {"error" message})})

(defn success-result
  [text images]
  {"$kotoba_tool_text" text "$kotoba_tool_images" (vec images)})

(defn select-window
  [windows app pid window-id]
  (let [visible (filter #(not (true? (get % "off_screen"))) windows)
        exact (when (and pid window-id)
                (filter #(and (= pid (get % "pid")) (= window-id (get % "window_id"))) visible))
        matched (when (and app (not (str/blank? app)))
                  (filter #(let [name (str/lower-case (str (get % "app_name")))
                                 wanted (str/lower-case (str/trim app))]
                             (or (= name wanted) (str/includes? name wanted) (str/includes? wanted name))) visible))]
    (first (or (seq exact) (seq matched) (when-not app (seq visible)) []))))

(defn canon-keys
  [keys]
  (let [parts (remove str/blank? (map str/trim (str/split (str/lower-case (or keys "")) #"\s*[+\-]\s*")))
        aliases {"command" "cmd" "control" "ctrl" "alt" "option" "windows" "win" "super" "win" "meta" "win" "⌘" "cmd" "⌥" "option"}
        modifiers #{"cmd" "shift" "option" "ctrl" "fn" "win"}
        canonical (map #(get aliases % %) parts)
        key (last (remove modifiers canonical))
        mods (vec (filter modifiers canonical))]
    {:key key :modifiers mods}))

(defn blocked-input?
  [action args]
  (let [text (or (get args "text") "")
        keys (:key (canon-keys (get args "keys")))
        modifiers (set (:modifiers (canon-keys (get args "keys"))))]
    (or (and (= action "type")
             (re-find #"(?i)(curl\s+[^|]*\|\s*(?:bash|sh)|wget\s+[^|]*\|\s*bash|sudo\s+rm\s+-[rf]|rm\s+-rf\s+/\s*$|:\s*\(\)\s*\{\s*:\|:\s*&\s*\})" text))
        (and (= action "key") keys
             (or (and (contains? modifiers "cmd") (contains? modifiers "option") (contains? #{"escape" "esc"} keys))
                 (and (contains? modifiers "cmd") (contains? modifiers "shift") (contains? #{"q" "delete" "backspace"} keys))
                 (and (contains? modifiers "win") (contains? #{"l" "r"} keys))
                 (and (contains? modifiers "ctrl") (contains? modifiers "alt") (contains? #{"delete" "del" "f4"} keys)))))))

(defn action-request
  [ctx action args]
  (let [state @(:computer-state ctx)
        session (:computer-session ctx)
        target (select-keys state [:pid :window-id])
        base (cond-> {"session" session}
               (:window-id state) (assoc "window_id" (:window-id state)))
        element (get args "element")
        token (get-in state [:tokens element])
        target-args (cond-> base token (assoc "element_token" token))]
    (when-not (and (:pid state) (:window-id state))
      (throw (ex-info "capture a target window before sending computer input" {})))
    (case action
      "click" ["click" (merge target-args (cond-> {"button" (or (get args "button") "left")}
                                              (number? element) (assoc "element_index" element)
                                              (vector? (get args "coordinate"))
                                              (assoc "x" (first (get args "coordinate")) "y" (second (get args "coordinate")))))]
      "double_click" ["double_click" (merge target-args (cond-> {}
                                                         (number? element) (assoc "element_index" element)
                                                         (vector? (get args "coordinate"))
                                                         (assoc "x" (first (get args "coordinate")) "y" (second (get args "coordinate")))))]
      "right_click" ["click" (merge target-args {"button" "right"} (when (number? element) {"element_index" element}))]
      "middle_click" ["click" (merge target-args {"button" "middle"} (when (number? element) {"element_index" element}))]
      "type" ["type_text" (assoc target-args "text" (or (get args "text") ""))]
      "key" (let [{:keys [key modifiers]} (canon-keys (get args "keys"))]
              (when-not key (throw (ex-info "key action requires a key name" {})))
              (if (seq modifiers)
                ["hotkey" (assoc target-args "keys" (conj modifiers key))]
                ["press_key" (assoc target-args "key" key)]))
      "scroll" ["scroll" (merge target-args {"direction" (or (get args "direction") "down")
                                               "amount" (max 1 (min 50 (or (get args "amount") 3)))}
                                  (when (number? element) {"element_index" element})
                                  (when (vector? (get args "coordinate"))
                                    {"x" (first (get args "coordinate")) "y" (second (get args "coordinate"))}))]
      "set_value" (if (number? element)
                    ["set_value" (assoc target-args "element_index" element "value" (get args "value"))]
                    (throw (ex-info "set_value requires element" {})))
      "drag" (let [source (get args "from_coordinate") destination (get args "to_coordinate")]
               ["drag" (merge target-args
                              (cond-> {}
                                (and (number? (get args "from_element")) (number? (get args "to_element")))
                                (assoc "from_element" (get args "from_element") "to_element" (get args "to_element"))
                                (and (vector? source) (vector? destination))
                                (assoc "from_x" (first source) "from_y" (second source)
                                       "to_x" (first destination) "to_y" (second destination))))])
      (throw (ex-info (str "unsupported computer-use action: " action) {})))))
