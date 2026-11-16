(ns meiji.fleet-audit
  "Read-only recovery inventory using the owning node's existing etcd identity.
   Never admits work, resets cursors, copies keys or infers liveness from enrollment."
  (:require [cheshire.core :as json] [clojure.edn :as edn]
            [clojure.string :as str] [meiji.host :as host])
  (:import [java.util Base64] [java.time Instant]
           [java.util.concurrent TimeUnit]))

(defn decode [text]
  (String. (.decode (Base64/getDecoder) ^String text) "UTF-8"))

(defn rows [document]
  (into {} (map (fn [kv] [(decode (:key kv))
                          (edn/read-string {:readers {} :default (fn [& _] (throw (ex-info "tag refused" {})))}
                                           (decode (:value kv)))]) (:kvs document))))

(defn read-prefix! [cfg prefix]
  (let [process (host/process! [(:etcdctl cfg)
                 (str "--endpoints=" (str/join "," (:endpoints cfg)))
                 (str "--cacert=" (:ca cfg)) (str "--cert=" (:cert cfg))
                 (str "--key=" (:key cfg)) "--dial-timeout=4s" "--command-timeout=8s"
                 "get" prefix "--prefix" "--write-out=json"])
        output (future (slurp (.getInputStream process)))
        errors (future (slurp (.getErrorStream process)))]
    (when-not (.waitFor process 15 TimeUnit/SECONDS)
      (.destroyForcibly process) (throw (ex-info "ledger-read-timeout" {})))
    ;; Do not expose transport stderr, cert paths or arbitrary ledger payloads.
    (when-not (zero? (.exitValue process)) (throw (ex-info "ledger-read-refused" {})))
    @errors
    (json/parse-string @output true)))

(defn public-inventory [enrollments cursors]
  (->> enrollments
       (keep (fn [[key enrollment]]
               (when (some #(str/starts-with? % "vm-") (:nodes enrollment))
                 (let [cursor (get cursors (str/replace key "/enrollment/" "/cursor/"))]
                   {:bot-id (:bot-id enrollment) :job-id (:job-id enrollment)
                    :issue-id (:issue-id enrollment) :nodes (:nodes enrollment)
                    :executor (:executor enrollment) :vm-executor (:vm-executor enrollment)
                    :provider (:provider enrollment) :model (:model enrollment)
                    :schedule (:schedule enrollment) :source-schedule (:source-schedule enrollment)
                    :initial-slot (:initial-slot enrollment)
                    :cursor (if cursor (select-keys cursor [:state :slot]) {:state "unknown"})
                    :liveness "unknown"}))))
       (sort-by (juxt :bot-id :job-id)) vec))

(defn -main [& [config]]
  (try
    (let [cfg (json/parse-string (slurp config) true)
          _ (when-not (= (:etcdctl-sha256 cfg) (host/sha256 (:etcdctl cfg)))
              (throw (ex-info "etcdctl-digest-mismatch" {})))
          enrollments (read-prefix! cfg "/itonami/occurrence/v1/enrollment/")
          cursors (read-prefix! cfg "/itonami/occurrence/v1/cursor/")]
      (when-not (= (get-in enrollments [:header :cluster_id]) (get-in cursors [:header :cluster_id]))
        (throw (ex-info "cluster-changed" {})))
      (when-not (= (str (:cluster-id cfg)) (str (get-in enrollments [:header :cluster_id])))
        (throw (ex-info "cluster-binding-mismatch" {})))
      (println (json/generate-string
                 {:schema "meiji.fleet-recovery-audit.v1" :observed-at (str (Instant/now))
                  :coverage "ledger-enrollments-and-cursors-only"
                  :enrollment-revision (get-in enrollments [:header :revision])
                  :cursor-revision (get-in cursors [:header :revision])
                  :jobs (public-inventory (rows enrollments) (rows cursors))})))
    (catch Exception exception
      (binding [*out* *err*] (println (ex-message exception)))
      (System/exit 1))))
