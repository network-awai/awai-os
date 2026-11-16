(ns meiji.build
  (:require [babashka.fs :as fs] [babashka.process :as process] [clojure.string :as str]))

(defn -main [& _]
  ;; Run from nixos/otehon/meiji. Reuse the canonical Soshiki build, never fork it.
  (fs/copy "../shell/vendor/kotoba-client-runtime.js" "../shell/src/vendor-runtime.gen.js" {:replace-existing true})
  (process/check (process/shell {:dir "../shell" :extra-env {"OTEHON_HTTP" "1"}} "npm" "run" "build"))
  (fs/copy-tree "../shell/dist" "dist" {:replace-existing true})
  (spit "dist/assets/meiji.css" (slurp "meiji.css"))
  (let [path "dist/soshiki-runtime/index.html"]
    (spit path (-> (slurp path)
                  (str/replace #"connect-src[^;\"]*" "connect-src 'self' ipc: http://ipc.localhost")
                  (str/replace "</head>" "<link rel=\"stylesheet\" href=\"../assets/meiji.css\"></head>"))))
  (println "Built Meiji UI. Runtime binaries and platform signing are separate release inputs."))
