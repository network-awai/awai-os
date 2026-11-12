;; Wakeup frequency is separate from the enrolled original job intervals.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str]
         '[cheshire.core :as json] '[itonami.otehon.etcd :as e]
         '[itonami.otehon.original-host :as original] '[itonami.otehon.recurring-host :as h])
(let [[manifest digest] *command-line-args*
      _ (assert (= digest (e/binary-sha manifest)) "manifest pin required")
      cfg (edn/read-string (slurp manifest))
      label "network.awai.itonami.jobs.awai2795"
      uid (str/trim (:out (sh/sh "id" "-u" :in "")))
      loaded (zero? (:exit (sh/sh "launchctl" "print" (str "gui/" uid "/" label) :in "")))
      report (assoc (original/tick! cfg) :serviceLoaded loaded
                    :invocation (if (= label (System/getenv "XPC_SERVICE_NAME")) "launchd" "operator"))
      text (json/generate-string report {:pretty true})
      url "http://127.0.0.1:8586/itonami-job-results-AWAI-2795-v1/current.json"
      open (fn [method] (doto ^java.net.HttpURLConnection (.openConnection (.toURL (java.net.URI. url)))
                         (.setRequestMethod method) (.setInstanceFollowRedirects false)
                         (.setConnectTimeout 3000) (.setReadTimeout 30000)))]
 (h/durable! (str (:state-root cfg) "/public-status.json") text)
 (let [^java.net.HttpURLConnection c (open "PUT")]
  (try (.setDoOutput c true) (.setRequestProperty c "Content-Type" "application/json")
   (with-open [out (.getOutputStream c)] (.write out (.getBytes text "UTF-8")))
   (assert (contains? #{200 201 204} (.getResponseCode c)) "status write unconfirmed")
   (finally (.disconnect c))))
 (let [^java.net.HttpURLConnection c (open "GET")]
  (try (assert (= 200 (.getResponseCode c)) "status readback unavailable")
   (assert (= text (with-open [in (.getInputStream c)] (String. (.readNBytes in 1048577) "UTF-8"))) "status readback mismatch")
   (finally (.disconnect c))))
 (println (json/generate-string {:originalJobs (count (:jobs report)) :serviceLoaded loaded
                                :invocation (:invocation report) :statusReadback true})))
