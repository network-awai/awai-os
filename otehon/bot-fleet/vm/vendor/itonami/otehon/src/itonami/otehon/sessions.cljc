(ns itonami.otehon.sessions
  "This profile's conversations from state.db: `sessions list` rows and
  `sessions show` transcripts. Ported from tools.cljk (sessions-browse,
  session-latest-messages, bounded-limit); the SQL text is verbatim and
  the host reads it read-only through io/sqlite-rows."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]
            [itonami.otehon.text :as text]))

(def browse-sql
  "SELECT s.id AS session_id, s.title, s.started_at, s.message_count FROM sessions s WHERE COALESCE(s.hidden, 0) = 0 AND COALESCE(s.source, '') NOT IN ('tool', 'delegate', 'kanban') ORDER BY COALESCE(s.last_activity_at, s.started_at) DESC LIMIT ?")

(def show-sql
  "SELECT m.id, m.role, m.content, m.timestamp FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.id = ? AND COALESCE(s.hidden, 0) = 0 AND COALESCE(s.source, '') NOT IN ('tool', 'delegate', 'kanban') ORDER BY m.id DESC LIMIT ?")

(defn bounded-limit
  "A query LIMIT from raw CLI input: a whole positive integer of at most
  9 digits, capped at `cap`. Anything else is nil (the caller refuses by
  name). Verbatim from tools/bounded-limit."
  [raw cap]
  (when-not (nil? raw)
    (let [s (str raw)]
      (when (and (<= (count s) 9) (re-matches #"\d+" s))
        (let [n (hio/parse-edn s)]
          (when (and (integer? n) (pos? n))
            (min cap n)))))))

(defn browse-lines
  "One `sessions list` body: padded columns, or \"no sessions\"."
  [rows]
  (if (seq rows)
    (mapv (fn [r]
            (str (text/pad-end (str (get r "session_id")) 40)
                 (text/pad-end (str (or (get r "started_at") "")) 24)
                 (text/pad-end (str (get r "message_count") " msgs") 9)
                 (or (get r "title") "")))
          rows)
    ["no sessions"]))

(defn show-lines
  "One `sessions show` body, oldest first: the rows arrive newest-first."
  [rows]
  (mapv (fn [m] (str "[" (get m "role") "] " (get m "content")))
        (reverse rows)))

(defn browse
  "The `sessions list` rows: this profile's visible conversations, newest
  activity first. Returns {:rows [...]} or {:error ...} — a missing or
  corrupt state.db is a named error, never a raw throw."
  [db-path limit]
  (if-not (hio/file? db-path)
    {:error "state.db missing"}
    (try {:rows (hio/sqlite-rows db-path browse-sql [limit])}
         (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
           {:error (str "state.db unreadable: " (ex-message e))}))))

(defn latest-messages
  "The `sessions show` body: the newest `limit` messages of one session.
  Returns {:rows [...]} — an empty :rows is an unknown session — or
  {:error ...} for a missing or corrupt state.db."
  [db-path session-id limit]
  (if-not (hio/file? db-path)
    {:error "state.db missing"}
    (try {:rows (hio/sqlite-rows db-path show-sql [session-id limit])}
         (catch #?(:lpy python/Exception :clj Exception :cljs :default) e
           {:error (str "state.db unreadable: " (ex-message e))}))))
