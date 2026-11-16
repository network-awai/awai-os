(ns itonami.otehon.store
  "Moving a profile's DEFINITION between the Hermes and itonami stores,
  without moving anything.

  Ported from src/itonami/agent/profile.cljk (definition-files,
  definition-dirs, copy-profile!): the same file set travels byte for byte,
  state and DBs never cross, a non-empty target is refused unless forced,
  and exporting an itonami-scheduled profile leaves the gateway.parked
  marker behind.

  Pure: the caller hands in the two stores' file listings
  ({rel-path text-or-:dir}) and gets the plan. The host copies the bytes.
  Nothing is read, written, or moved here."
  (:require [clojure.string :as str]))

(def definition-files
  "What a profile IS, in the format both stores share."
  ["SOUL.md" "profile.yaml" "config.yaml" ".env" "secrets.command"
   "yakuwari.edn" "itonami.edn" "cron/jobs.json"])

(def definition-dirs ["scripts" "skills"])

(def state-paths
  "What never crosses: sessions, run logs, cron output, ticker state, the
  host-local itonami state. Listed so plans can show what was left behind."
  ["sessions/" "workspace/" "memories/" "logs/" ".itonami/"
   "cron/output/" "cron/usage_audit.jsonl" "cron/ticker_heartbeat"
   "cron/ticker_last_success" "cron/itonami-runs.jsonl"
   "cron/executions.db" "cron_incidents"])

(defn- under-dirs? [rel]
  (some #(str/starts-with? rel (str % "/")) definition-dirs))

(defn- dotfile? [rel]
  (str/starts-with? (last (str/split rel #"/")) "."))

(defn definition-rel?
  "A store-relative path that is part of a profile's DEFINITION."
  [rel]
  (or (some #(= rel %) definition-files) (under-dirs? rel)))

(defn collect-files
  "Every file under `dir`, as store-relative paths, sorted. `read-dir`
  lists one level (names), `dir?` tests a joined path; both are injected so
  the shared cases run without a disk and the CLI passes the io versions."
  [read-dir dir? dir]
  (letfn [(go [rel]
            (let [abs (if (= rel "") dir (str dir "/" rel))]
              (if (dir? abs)
                (mapcat #(go (if (= rel "") % (str rel "/" %))) (sort (read-dir abs)))
                [rel])))]
    (vec (sort (go "")))))

(defn plan-copy
  "The copy plan from a `from` listing to a `to` listing.
  Listings map rel-path to text (or :dir). Only DEFINITION paths travel;
  dotfiles under scripts/ and skills/ stay, like the legacy route's walk
  filter. A non-empty target is refused unless :force?."
  [{:keys [from to force? direction from-name to-name]}]
  (let [travel (vec (sort (filter #(and (definition-rel? %) (not (dotfile? %))) (keys from))))
        target-non-empty? (boolean (seq to))]
    (cond
      (and target-non-empty? (not force?))
      {:status :refused :reason "store/target-not-empty"
       :detail (str "target " (or to-name "profile") " is not empty; pass :force? to overwrite")}

      :else
      {:status :ok
       :direction direction
       :copied travel
       :skipped-dotfiles (vec (sort (filter (fn [rel]
                                              (and (under-dirs? rel)
                                                   (str/starts-with? (last (str/split rel #"/")) ".")))
                                            (keys from))))})))

(defn parked-after-export
  "Exporting an itonami-scheduled profile parks the itonami gateway for it:
  the Hermes side ticks again, the itonami side must not. Pure data version
  of the legacy route's set-hermes-parked! marker."
  [scheduler]
  (if (= scheduler :itonami)
    {:parked true :marker "gateway.parked"
     :detail "exported while the itonami scheduler owned cron; the itonami side stays parked"}
    {:parked false}))
