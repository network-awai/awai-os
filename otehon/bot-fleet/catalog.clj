;; Otehon host utility; deliberately outside the Native build/runtime closure.
(require '[babashka.fs :as fs] '[cheshire.core :as json] '[clojure.string :as str])
(load-file (str (fs/parent *file*) "/src/bot_fleet/core.cljc"))
(let [[registry projects issues revision output alias-file] *command-line-args*]
  (when-not (and output (not (fs/exists? output)))
    (throw (ex-info "usage: bb catalog.clj REGISTRY_DIR PROJECTS_JSON ISSUES_JSON REVISION NEW_OUTPUT" {})))
  (let [read-json #(json/parse-string (slurp (str %)) true)
        manifests (mapv read-json (sort (fs/glob (fs/path registry "profiles") "*/manifest.json")))
        aliases (when alias-file (into {} (map (juxt :source identity)
                                               (filter :repository (read-json alias-file)))))
        result (bot-fleet.core/catalog manifests (read-json projects) (read-json issues) revision aliases)]
    (spit output (str (json/generate-string result {:pretty true}) "\n"))
    (println (json/generate-string {:profiles (count manifests)
                                   :circles (count (get-in result [:organization :circles]))
                                   :linear-bound (count (filter #(= "bound" (get-in % [:linear :state]))
                                                               (get-in result [:organization :bots])))
                                   :runtime-started 0}))))
