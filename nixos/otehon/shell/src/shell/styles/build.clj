(ns shell.styles.build
  "Writes the Garden stylesheets into dist/. Run from the shell directory:
  clojure -M -m shell.styles.build. build.mjs calls this before the bundles."
  (:require [clojure.java.io :as io]
            [garden.core :as garden]
            [shell.styles.link :as link]
            [shell.styles.main :as main]))

(defn- write-css! [path styles]
  (.mkdirs (.getParentFile (io/file path)))
  (spit path (garden/css styles))
  (println "wrote" path))

(defn -main []
  (write-css! "dist/assets/main.css" main/styles)
  (write-css! "dist/link/assets/main.css" link/styles))
