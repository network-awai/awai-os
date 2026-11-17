(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[cheshire.core :as json]
 '[bot-fleet.vm-host :as host] '[itonami.otehon.etcd :as e] '[itonami.otehon.recurring-host :as h])
(let [[manifest digest] *command-line-args* _ (assert (= digest (e/binary-sha manifest)))
      cfg (edn/read-string (slurp manifest))
      _ (assert (and (= "itonami.vm-job-worker.v1" (:schema cfg)) (<= 1 (count (:jobs cfg)) 16)
                     (= (:orca-sha cfg) (e/binary-sha (:orca cfg)))))
      client (e/client (edn/read-string (slurp (:etcd-config cfg))))
      rows (mapv (fn [job] (try (host/tick-job! cfg client job (System/currentTimeMillis))
                      (catch Exception _ {:catalog-bot-id (:catalog-bot-id job) :job-id (get-in job [:enrollment :job-id])
                                          :state "unknown" :reason "vm-outcome-or-publication-unconfirmed-no-redispatch"}))) (:jobs cfg))
      uid (clojure.string/trim (:out (sh/sh "id" "-u" :in ""))) label "network.awai.itonami.vm-jobs.awai2820"
      loaded (zero? (:exit (sh/sh "launchctl" "print" (str "gui/" uid "/" label) :in "")))
      report {:schema "awai.original-job-observation.v1" :scope "original-bounded-jobs" :observedAt (str (java.time.Instant/now))
              :worker "jun-control-recording; enrolled Awai VM compute" :serviceLoaded loaded :jobs rows}
      text (json/generate-string report) url "http://127.0.0.1:8586/itonami-vm-jobs-AWAI-2820-v1/current.json"
      open (fn [method] (doto ^java.net.HttpURLConnection (.openConnection (.toURL (java.net.URI. url)))
                         (.setRequestMethod method) (.setInstanceFollowRedirects false) (.setConnectTimeout 3000) (.setReadTimeout 30000)))]
 (h/durable! (str (:state-root cfg) "/public-status.json") text)
 (let [^java.net.HttpURLConnection c (open "PUT")]
  (try (.setDoOutput c true) (.setRequestProperty c "Content-Type" "application/json")
   (with-open [out (.getOutputStream c)] (.write out (.getBytes text "UTF-8")))
   (assert (contains? #{200 201 204} (.getResponseCode c))) (finally (.disconnect c))))
 (let [^java.net.HttpURLConnection c (open "GET")]
  (try (assert (= 200 (.getResponseCode c)))
   (assert (= text (with-open [in (.getInputStream c)] (String. (.readNBytes in 1048577) "UTF-8")))) (finally (.disconnect c))))
 (println (json/generate-string {:observedAt (:observedAt report) :jobs (count rows) :states (frequencies (map :state rows)) :serviceLoaded loaded})))
