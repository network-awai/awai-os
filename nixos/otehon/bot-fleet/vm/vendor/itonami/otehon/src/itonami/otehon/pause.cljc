(ns itonami.otehon.pause
  "The emergency stop marker: one flag for the whole store that gates cron
  dispatch, `gateway serve` turns and manual cron runs. A one-shot turn is
  not a gateway turn and stays available, exactly as Hermes leaves the CLI.

  Ported from src/itonami/agent/pause.cljk (marker) and the pause-cmd /
  resume-cmd messages in src/itonami/agent/main.cljk. Pure: paths, the
  record shape and the printed lines. The CLI threads the store root
  (ITONAMI_DIR, else ~/.itonami) and does the three file touches, so the
  shared cases assert the same strings the legacy CLI prints."
  (:require [itonami.otehon.text :as text]))

(defn marker-path
  "The flag file inside a store root."
  [root]
  (str root "/paused"))

(defn store-root
  "The store root: ITONAMI_DIR when it names a directory, else ~/.itonami
  under HOME. `getenv` is injected (the host env on the CLI, a map lookup
  in cases) so the rule stays pure and testable."
  [getenv]
  (let [d (getenv "ITONAMI_DIR")]
    (if (and (string? d) (not (text/blank? d)))
      d
      (str (or (getenv "HOME") "~") "/.itonami"))))

(defn format-record
  "The marker content: the local timestamp, then the reason when one was
  given (never secrets — the caller passes the reason only)."
  [iso reason]
  (str iso (when-not (text/blank? (str reason)) (str " " reason)) "\n"))

(defn since-of
  "The pause record (timestamp + reason) from marker text, nil when no
  stop is recorded. Mirrors the legacy `since`: whatever text is there
  reads back trimmed."
  [content]
  (let [t (when (some? content) (text/trim (str content)))]
    (when-not (text/blank? (str t)) t)))

(defn pause-message
  "What setting the stop prints. Verbatim from the legacy pause-cmd,
  including the `itonami-agent resume` lift hint: the day Otehon becomes
  the CLI the line stays byte-identical."
  [reason]
  (str "paused — cron dispatch and new gateway turns are stopped"
       (when-not (text/blank? (str reason)) (str " (" reason ")"))
       ". lift with: itonami-agent resume"))

(defn resume-message
  "What lifting the stop prints: legacy resume-cmd verbatim."
  [was-active?]
  (if was-active?
    "resumed — emergency stop lifted"
    "nothing to resume (not paused)"))
