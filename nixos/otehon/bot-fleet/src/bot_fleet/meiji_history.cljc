(ns bot-fleet.meiji-history
  "One-time import from an owner-attached read-only legacy guest disk.
   Never overwrites current guest state or recomputes an original result."
  (:require [babashka.fs :as fs] [clojure.edn :as edn]
            [otehon.pack-store :as pack] [itonami.otehon.recurring-host :as durable])
  (:import [java.nio.file Files LinkOption]))

(defn require! [condition message] (when-not condition (throw (ex-info message {}))))
(defn check-tree! [root]
  (let [seen (atom 0)]
    (letfn [(visit [path]
              (require! (not (Files/isSymbolicLink path)) "history-symlink-refused")
              (require! (< (swap! seen inc) 10000) "history-tree-bound")
              (if (Files/isDirectory path (make-array LinkOption 0))
                (with-open [entries (Files/newDirectoryStream path)]
                  (doseq [entry entries] (visit entry)))
                (require! (and (Files/isRegularFile path (make-array LinkOption 0))
                                (<= (Files/size path) (* 64 1024 1024))) "history-file-refused")))]
      (visit (fs/path root)))))

(defn verified-summary [root]
  (let [store (pack/recover (str (fs/path root "packs")))
        summary (pack/summary store)]
    (require! (seq (:files summary)) "history-results-required")
    ;; Exercise every referenced result; recovery alone isn't a byte readback.
    (doseq [name (keys (:files summary))] (pack/read-data store name))
    summary))

(defn import! [source target]
  (require! (and (fs/absolute? source) (fs/absolute? target)) "absolute-history-path-required")
  (let [marker (str (fs/path target "meiji-history.edn"))]
    (if (fs/exists? marker)
      (do (require! (not (fs/sym-link? marker)) "history-marker-refused")
          (let [record (edn/read-string (slurp marker))]
            (require! (= "meiji.history-import.v1" (:schema record)) "history-marker-invalid")
            (verified-summary target)
            {:state "already-imported" :results (:results record)}))
      (do
        (require! (not (fs/exists? target)) "preserve-existing-guest-state")
        (check-tree! source)
        (let [before (verified-summary source)]
          (fs/copy-tree source target {:copy-attributes true :nofollow-links true})
          (require! (= before (verified-summary target)) "history-import-mismatch")
          (durable/durable! marker
            (pr-str {:schema "meiji.history-import.v1" :results (count (:files before))
                     :sourceReadOnly true :originalResultsRetained true}))
          {:state "imported" :results (count (:files before))})))))

(defn -main [& _]
  (println (pr-str (import! "/run/meiji-history/var/lib/itonami-bot-vm"
                            "/var/lib/itonami-bot-vm"))))
