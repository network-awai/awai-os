(ns itonami.otehon.tts
  "The text_to_speech tool shape: config checks, the /audio/speech request,
  the filename-safe format guard and the abort-delay clamp. Faithful port of
  the pure core of itonami.agent.tts (an OpenAI-compatible /audio/speech
  endpoint on the chat chain's hop resolution). An unset piece is a NAMED
  absence (nil), never an inference. Audio bytes, the provider hop, the fetch
  and the file write stay host-side (S6c)."
  (:require [clojure.string :as str]
            [itonami.otehon.bundle :as bundle]
            [itonami.otehon.io :as hio]))

(defn configured
  "The tts settings from config, or nil when incomplete: provider AND model
  are required; voice defaults to `alloy` only once the rest is configured."
  [config]
  (let [c (get config "tts")]
    (when-not (or (str/blank? (str (get c "provider")))
                  (str/blank? (str (get c "model"))))
      {:provider (str (get c "provider"))
       :model (str (get c "model"))
       ;; blank counts as unset, as everywhere else in the module
       :voice (let [v (str (get c "voice"))] (if (str/blank? v) "alloy" v))})))

(defn speech-request
  "The /audio/speech request (pure): one hop -> {url headers body}. The
  response is audio bytes, so the body carries the OpenAI speech fields and
  the hop's headers ride along. The body is canonical JSON (sorted keys),
  so the same request hashes the same everywhere."
  [hop voice text format]
  {:url (str (:base-url hop) "/audio/speech")
   ;; Content-Type is REQUIRED: FastAPI-based OpenAI-compatible servers
   ;; (vLLM and friends) answer 422 to a JSON body sent as text/plain
   :headers (cond-> (assoc (or (:headers hop) {}) "Content-Type" "application/json")
              (not (str/blank? (str (:token hop)))) (assoc "Authorization" (str "Bearer " (:token hop))))
   :body (hio/json-str {"model" (:model hop)
                        "voice" voice
                        "input" (str text)
                        "response_format" (str format)})})

(defn safe-format
  "The response format as a filename-safe token: alphanumeric only, so a
  caller-supplied format can never escape the workspace through the path."
  [f]
  (let [s (str f)]
    (when (re-matches #"[A-Za-z0-9]+" s) s)))

(defn- digits10
  "A decimal digit run to an integer (shared digit table with webguard)."
  [s]
  (reduce (fn [a ch] (+ (* a 10) (get bundle/hex-digit (str ch) 0))) 0 s))

(defn- parse-num10
  "A hand-rolled js/Number for timeout strings: optional sign, leading
  zeros (\"010\" is 10, as in JS, not 8), an optional fraction. Integers
  stay exact; fractions come back doubles so the printed form matches the
  legacy (20.5, not 41/2). Exponent, hex, Infinity and NaN spellings are
  NOT numbers here (they land on the cap); they never occur in timeout
  configs (see the S6b evidence doc)."
  [s]
  (let [t (str/trim (str s))
        m (re-matches #"([+-]?)0*(\d+)(?:\.(\d+))?" t)]
    (when m
      (let [[_ sign ip fp] m
            neg? (= sign "-")
            n (if fp
                (* 1.0 (+ (digits10 ip) (/ (digits10 fp) (apply * (repeat (count fp) 10)))))
                (digits10 ip))]
        (if neg? (- n) n)))))

(defn clamp-timeout-s
  "The abort delay in seconds, floor AND CAP: below the floor a tiny timeout
  would abort instantly; above the cap Node collapses the setTimeout delay
  to ~1 ms. Numeric strings coerce; unusable values land on the cap
  (everything is bounded — the hop's own 900 s default is capped here too)."
  [t0]
  (let [t (if (string? t0) (parse-num10 t0) t0)
        t (if (and (number? t) (pos? t)) t 600)]
    (min 600 (max 1 t))))
