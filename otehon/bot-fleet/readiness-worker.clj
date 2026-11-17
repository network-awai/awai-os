;; Otehon host entry; periodic wakeup is NOT an individual Bot frequency.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[cheshire.core :as json]
         '[itonami.otehon.etcd :as e] '[itonami.otehon.occurrence :as o]
         '[itonami.otehon.recurring :as recurring] '[itonami.otehon.recurring-host :as h])
(defn webdav! [url text]
 (assert (= "http://127.0.0.1:8586/itonami-bot-readiness-AWAI-2795-20261112-v1/current.json" url)
         "explicit selected loopback WebDAV resource only")
 (let [open (fn [method]
              (doto ^java.net.HttpURLConnection (.openConnection (.toURL (java.net.URI. url)))
                (.setConnectTimeout 3000) (.setReadTimeout 30000)
                (.setInstanceFollowRedirects false) (.setRequestMethod method)))
       ^java.net.HttpURLConnection put (open "PUT")]
  (.setDoOutput put true) (.setRequestProperty put "Content-Type" "application/json")
  (with-open [out (.getOutputStream put)] (.write out (.getBytes text "UTF-8")))
  (assert (contains? #{200 201 204} (.getResponseCode put)) "WebDAV write unconfirmed")
  (.disconnect put)
  (let [^java.net.HttpURLConnection get (open "GET")]
   (assert (= 200 (.getResponseCode get)) "WebDAV readback unconfirmed")
   (let [body (with-open [in (.getInputStream get)] (String. (.readNBytes in 262145) "UTF-8"))]
    (assert (and (<= (count body) 262144) (= text body)) "WebDAV readback mismatch"))
   (.disconnect get))))
(let [[manifest digest hosted-file] *command-line-args*
      _ (assert (and hosted-file (= digest (e/binary-sha manifest))) "pinned manifest and explicit hosted output required")
      cfg (edn/read-string (slurp manifest))
      tick (h/tick! cfg)
      _ (println "readiness-export: reading completed cursors")
      client (e/client (edn/read-string (slurp (:etcd-config cfg))))
      _ (println "readiness-export: authenticated observer ready")
      now (System/currentTimeMillis)
      jobs
      (mapv (fn [job]
        (let [en (:enrollment job) keys (o/keys-for (:bot-id en) (:job-id en) (:initial-slot en))
              cursor ((:read client) (:cursor keys))
              plan (recurring/plan en cursor now)
              dir (when cursor (h/run-path cfg job (:slot cursor)))
              request (when dir (h/saved (str dir "/request.edn")))
              result (when dir (h/saved (str dir "/model/result.edn")))
              model (when (= 1 (count (get-in result [:usage :models]))) (first (get-in result [:usage :models])))
              state (some #(when (= (:catalog-bot-id job) (:catalog-bot-id %)) (:state %)) (:jobs tick))]
          {:botId (:catalog-bot-id job) :name (:bot-id en) :jobId (:job-id en) :originalJobId (:source-job-id job)
           :scope "public-readiness-only" :originalJobState "held-unported-effects" :configuredEnabled true
           :intervalMinutes (:source-interval-minutes job) :issueId (:issue-id en) :projectId (:project-id en)
           :initiativeId (:initiative-id en) :worker (:authenticated-node client) :state state
           :nextSlot (:next-slot plan) :cursorState (:state cursor)
           :lastRun (when result {:runId (:run-id request) :museRunId (:muse-run-id result) :state (:state result)
                                  :provider (:provider result) :model (:model result)
                                  :completedAt (str (java.time.Instant/ofEpochMilli (.lastModified (java.io.File. (str dir "/model/result.edn")))))
                                  :inputTokens (:input_tokens model) :outputTokens (:output_tokens model)
                                  :reasoningTokens (:reasoning_tokens model) :rawCachedTokens (:cached_tokens model)
                                  :cacheReadTokens nil :cacheWriteTokens nil
                                  :linearResultConfirmed (true? (:confirmed (h/saved (str dir "/linear-result-confirmed.edn")) ))})})) (:jobs cfg))
      label "network.awai.itonami.readiness.awai2795"
      _ (println "readiness-export: cursor collection complete")
      uid (clojure.string/trim (:out (sh/sh "id" "-u" :in "")))
      loaded (zero? (:exit (sh/sh "launchctl" "print" (str "gui/" uid "/" label) :in "")))
      report {:schema "awai.bot-readiness-observation.v1" :observedAt (str (java.time.Instant/now))
              :scope "public-readiness-only" :serviceLoaded loaded
              :invocation (if (= label (System/getenv "XPC_SERVICE_NAME")) "launchd" "operator")
              :allOriginalJobsActivated false :worker (:authenticated-node client) :jobs jobs}
      text (str (json/generate-string report {:pretty true}) "\n")]
 (h/durable! (str (:state-root cfg) "/public-status.json") text)
 (println "readiness-export: local snapshot saved")
 (webdav! hosted-file text)
 (println (json/generate-string {:readiness-bots (count jobs) :service-loaded loaded :hosted-snapshot-written true})))
