(ns itonami.otehon.status
  "What a store is running: the pause flag, every profile with its
  scheduler and active job count, the two gateway pid files and the
  trusted peer count.

  Ported from the status-cmd in src/itonami/agent/main.cljk and the
  pid-state rule beside it. Pure: the CLI gathers the store (files,
  pid liveness, peers) and renders here, so the shared cases assert the
  same lines the legacy CLI prints."
  (:require [itonami.otehon.text :as text]
            [itonami.otehon.cron :as cron]))

(defn valid-name?
  "A profile name: a lowercase token of at most 64 chars. Verbatim from
  profile.cljk: non-strings refuse, so a profile directory the legacy
  store could never have named never enters the listing."
  [s]
  (boolean (and (string? s) (re-matches #"^[a-z0-9][a-z0-9_-]{0,63}$" s))))

(defn profile-row
  "One profile's status line data: the scheduler from its manifest
  (:hermes when it has none) and its active job count."
  [profile-name manifest jobs]
  {:name profile-name
   :scheduler (name (or (get-in manifest [:runtime :scheduler]) :hermes))
   :jobs (count (filter cron/active? (or jobs [])))})

(defn pid-state
  "A gateway line state: `running (pid N)` only for a named live owner,
  else `not running`. The CLI passes the trimmed pid file text and the
  host liveness check; garbage never reads live."
  [pid-text alive?]
  (if (and (string? pid-text) (not (text/blank? pid-text)) alive?)
    (str "running (pid " pid-text ")")
    "not running"))

(defn render-status
  "The legacy status-cmd lines for gathered store data:
  :paused (the since record or nil), :profiles [profile-row ...],
  :gateway-tick / :gateway-serve (pid-state strings), :peers-trusted
  (a count, or nil when the peers file would not parse)."
  [{:keys [paused profiles gateway-tick gateway-serve peers-trusted]}]
  (vec (concat
        [(str "paused: " (or paused "no"))
         (str "profiles (" (count profiles) "):")]
        (mapv (fn [{:keys [name scheduler jobs]}]
                (str "  " (text/pad-end name 32)
                     "scheduler=" scheduler "  jobs=" jobs))
              profiles)
        [(str "gateway (cron tick): " gateway-tick)
         (str "gateway serve: " gateway-serve)
         (str "peers: " (if (nil? peers-trusted) "?" peers-trusted) " trusted")])))
