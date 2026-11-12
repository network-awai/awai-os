(ns itonami.otehon.notepad
  "Per-job durable KV notepad (cursors, watermarks) carried across cron
  wake-ups. Ported from notepad.cljk: the same store shape (profile-local
  SQLite), the same caps (16 KB per value, 128 characters per key, 64 KB
  per job in total), the same prompt section ('' when unused). Oversized
  writes fail and leave the store untouched."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(def max-value-bytes (* 16 1024))
(def max-key-chars 128)
(def max-job-total-bytes (* 64 1024))

(defn db-path [home] (str home "/cron/notepad.db"))

(def ^:private schema-sql
  (str "PRAGMA journal_mode=WAL; "
       "CREATE TABLE IF NOT EXISTS cron_notepad ("
       "job_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, "
       "updated_at TEXT NOT NULL, PRIMARY KEY (job_id, key))"))

(defn- ensure-db! [home]
  (hio/mkdirs! (str home "/cron"))
  (hio/sqlite-exec! (db-path home) schema-sql))

(defn- total-query-sql
  []
  (str "SELECT COALESCE(SUM(LENGTH(CAST(key AS BLOB))"
       " + LENGTH(CAST(value AS BLOB))), 0) AS n"
       " FROM cron_notepad WHERE job_id=? AND key<>?"))

(defn set-note
  "Upsert one key. Throws ex-info when a size cap would be exceeded; the
  store is left untouched in that case."
  [home job-id key value now-iso]
  (let [job-id (str job-id) key (str key) value (str value)]
    (when (str/blank? job-id)
      (throw (ex-info "job_id must be non-empty" {})))
    (when (str/blank? key)
      (throw (ex-info "key must be non-empty" {})))
    (when (> (count key) max-key-chars)
      (throw (ex-info (str "key too long (max " max-key-chars " characters)") {})))
    (when (> (hio/utf8-bytes value) max-value-bytes)
      (throw (ex-info (str "value too large (max " max-value-bytes " bytes per key)") {})))
    (ensure-db! home)
    (let [other (or (get (first (hio/sqlite-rows (db-path home) (total-query-sql) [job-id key])) "n") 0)
          entry (+ (hio/utf8-bytes key) (hio/utf8-bytes value))]
      (when (> (+ other entry) max-job-total-bytes)
        (throw (ex-info (str "notepad full: job '" job-id "' would exceed "
                             max-job-total-bytes " bytes total; delete unused keys first")
                        {})))
      (hio/sqlite-run! (db-path home)
                       (str "INSERT INTO cron_notepad (job_id, key, value, updated_at)"
                            " VALUES (?, ?, ?, ?)"
                            " ON CONFLICT(job_id, key)"
                            " DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
                       [job-id key value now-iso])
      {"job_id" job-id "key" key "value" value "updated_at" now-iso})))

(defn get-note
  [home job-id key]
  (ensure-db! home)
  (get (first (hio/sqlite-rows (db-path home)
                               "SELECT value FROM cron_notepad WHERE job_id=? AND key=?"
                               [(str job-id) (str key)]))
       "value"))

(defn delete-note
  [home job-id key]
  (ensure-db! home)
  (let [rows (hio/sqlite-rows (db-path home)
                              "SELECT 1 AS n FROM cron_notepad WHERE job_id=? AND key=?"
                              [(str job-id) (str key)])]
    (when (seq rows)
      (hio/sqlite-run! (db-path home)
                       "DELETE FROM cron_notepad WHERE job_id=? AND key=?"
                       [(str job-id) (str key)])
      true)))

(defn list-notes
  "All entries for one job, sorted by key."
  [home job-id]
  (ensure-db! home)
  (hio/sqlite-rows (db-path home)
                   (str "SELECT job_id, key, value, updated_at FROM cron_notepad"
                        " WHERE job_id=? ORDER BY key")
                   [(str job-id)]))

(defn render-section
  "The job's notepad as a prompt section ('' when unused, so jobs that
  never touch the notepad keep a byte-identical prompt). Read-only: a
  missing store reads as empty without creating it (the legacy render
  creates it as a side effect; only command outputs are compat)."
  [home job-id]
  (try
    (let [notes (if (hio/file? (db-path home)) (list-notes home job-id) [])]
      (if (empty? notes)
        ""
        (str "## Job notepad (persistent across runs)\n"
             "This durable scratchpad survives between scheduled runs of this "
             "job. Update it via the CLI, e.g.:\n"
             "`itonami-agent cron notepad " job-id " set <key> <value>` "
             "(also: get/delete/list; `itonami-agent cron notepad " job-id " delete "
             "<key>` removes an entry).\n\n"
             (str/join "\n" (for [n notes] (str "- " (get n "key") ": " (get n "value"))))
             "\n\n")))
    (catch #?(:lpy python/Exception :clj Exception :cljs :default) _ "")))
