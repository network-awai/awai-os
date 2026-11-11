(ns profile-catalog.core
  "Read-only platform inventory. Reads only bounded itonami.edn metadata; never Hermes or runtime state."
  (:require [cheshire.core :as json] [clojure.edn :as edn] [clojure.java.io :as io] [clojure.string :as str])
  (:import [java.nio.file Files LinkOption]))

(defn metadata [manifest]
  (when (and (map? manifest)
             (contains? #{"cloud.itonami.profile.v1" "cloud.itonami.profile.v2"} (:itonami/schema manifest))
             (= :itonami-agent (get-in manifest [:runtime :engine]))
             (string? (:profile/id manifest))
             (re-matches #"^[a-z0-9][a-z0-9_-]{0,63}$" (:profile/id manifest)))
    {:id (:profile/id manifest)
     :description (let [s (:profile/description manifest)] (if (string? s) (subs s 0 (min 280 (count s))) ""))
     :skills (->> (get-in manifest [:bundle :skills])
                  (filter #(and (string? %) (not (str/blank? %))))
                  (take 12) (mapv #(subs % 0 (min 80 (count %)))))}))

(defn catalog [store]
  (let [root (.toPath (io/file store "profiles"))]
    (if-not (Files/isDirectory root (make-array LinkOption 0))
      (throw (ex-info "profile-store-unavailable" {}))
      (with-open [dirs (Files/list root)]
        (let [results
              (doall
               (for [dir (iterator-seq (.iterator dirs))
                     :let [name (str (.getFileName dir))]
                     :when (re-matches #"^[a-z0-9][a-z0-9_-]{0,63}$" name)]
                 (try
                   (let [file (.resolve dir "itonami.edn")]
                     (when (and (not (Files/isSymbolicLink dir))
                                (not (Files/isSymbolicLink file))
                                (Files/isRegularFile file (make-array LinkOption 0))
                                (<= (Files/size file) 262144))
                       (let [row (metadata (edn/read-string (slurp (.toFile file))))]
                         (when (= name (:id row)) row))))
                   (catch Exception _ nil))))]
          {:schema "awai.itonami.profile-catalog.v1"
           :profiles (vec (sort-by :id (remove nil? results)))
           :skipped (count (filter nil? results))})))))

(defn -main [& _]
  (print (json/generate-string (catalog (or (System/getenv "ITONAMI_DIR")
                                           (str (System/getProperty "user.home") "/.itonami"))))))
