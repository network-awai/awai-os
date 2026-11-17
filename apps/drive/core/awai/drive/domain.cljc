(ns awai.drive.domain (:require [clojure.string :as str]))
(def schema "awai.drive.local-adapter.v1")
(def limits {:fileBytes 1073741824 :bufferBytes 65536 :entries 1000 :depth 16})
(defn valid-name? [s]
  (and (string? s) (not (str/blank? s)) (<= (count s) 160)
       (not (contains? #{"." ".."} s)) (not (re-find #"[/\\\x00-\x1f\x7f]" s))
       (not (str/starts-with? s ".pending-"))))
(defn valid-path? [s]
  (and (string? s) (<= (count s) 2048)
       (or (= s "") (let [parts (str/split s #"/" -1)] (and (<= (count parts) (:depth limits)) (every? valid-name? parts))))))
(defn descriptor [] {:schema "kotoba.app.client-runtime.v1" :target "browser" :profile "trusted-page-v1" :entry "index.html"
                    :local-state {:adapter "memory" :schema "awai.drive.view.v1" :version 1} :workers [] :operations []})
