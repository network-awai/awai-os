;; Bounded staged executor. The local checkpoint is a scheduling hint, never
;; authority: every actual work unit passes the shared etcd admission/fences.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str] '[cheshire.core :as json]
 '[itonami.otehon.etcd :as e] '[itonami.otehon.original-host :as original] '[itonami.otehon.recurring-host :as h])
(def label "network.awai.itonami.physics.awai2809")
(def url "http://127.0.0.1:8586/itonami-physics-jobs-AWAI-2809-v1/current.json")
(defn record-progress! [cfg job]
 (let [dir (str (:state-root cfg) "/workflow/" (get-in job [:binding :issue-uuid]))
       _ (h/private-dir! dir) intent (str dir "/intent.edn")
       current (h/issue-context! cfg job (str dir "/read"))
       state (get-in current [:result :issue :state :type])]
  (cond
   (= "started" state) (do (h/durable! (str dir "/confirmed.edn") (pr-str {:confirmed true :via "live-readback"})) true)
   (or (h/saved intent) (h/saved (str dir "/confirmed.edn"))) false
   :else
   (do (h/durable! intent (pr-str {:issue (get-in job [:binding :issue-id]) :target "In Progress" :single-write true}))
       (h/call-json! [(:orca cfg) "linear" "status" "set" (get-in job [:binding :issue-id])
                      "--to" "In Progress" "--workspace" (:workspace cfg) "--json"] (str dir "/write"))
       (let [proof (h/issue-context! cfg job (str dir "/readback"))
             confirmed (= "started" (get-in proof [:result :issue :state :type]))]
         (when confirmed (h/durable! (str dir "/confirmed.edn") (pr-str {:confirmed true :via "write-readback"}))) confirmed)))))
(defn publish! [cfg rows]
 (let [label (or (:worker-label cfg) label) url (or (:result-url cfg) url)
       _ (assert (contains? #{"network.awai.itonami.physics.awai2809" "network.awai.itonami.material.awai2809"} label))
       _ (assert (contains? #{"http://127.0.0.1:8586/itonami-physics-jobs-AWAI-2809-v1/current.json"
                             "http://127.0.0.1:8586/itonami-material-jobs-AWAI-2809-v1/current.json"} url))
       uid (str/trim (:out (sh/sh "id" "-u" :in "")))
       loaded (zero? (:exit (sh/sh "launchctl" "print" (str "gui/" uid "/" label) :in "")))
       report {:schema "awai.original-job-observation.v1" :scope "original-bounded-jobs" :observedAt (str (java.time.Instant/now))
               :worker "jun-control" :serviceLoaded loaded :invocation (if (= label (System/getenv "XPC_SERVICE_NAME")) "launchd" "operator")
               :adaptation "pinned-otehon-simulation-only" :jobs rows}
       text (json/generate-string report)
       open (fn [method] (doto ^java.net.HttpURLConnection (.openConnection (.toURL (java.net.URI. url)))
                          (.setRequestMethod method) (.setInstanceFollowRedirects false) (.setConnectTimeout 3000) (.setReadTimeout 30000)))]
  (h/durable! (str (:state-root cfg) "/public-status.json") text)
  (let [^java.net.HttpURLConnection c (open "PUT")]
   (try (.setDoOutput c true) (.setRequestProperty c "Content-Type" "application/json")
    (with-open [out (.getOutputStream c)] (.write out (.getBytes text "UTF-8")))
    (assert (contains? #{200 201 204} (.getResponseCode c)) "physics status write unconfirmed") (finally (.disconnect c))))
  (let [^java.net.HttpURLConnection c (open "GET")]
   (try (assert (= 200 (.getResponseCode c)))
    (assert (= text (with-open [in (.getInputStream c)] (String. (.readNBytes in 8388609) "UTF-8")))) (finally (.disconnect c)))) report))
(let [[manifest digest] *command-line-args*
      _ (assert (= digest (e/binary-sha manifest)) "physics manifest pin mismatch")
      cfg (edn/read-string (slurp manifest)) jobs (:jobs cfg) now (System/currentTimeMillis)
      _ (assert (and (= "itonami.physics-fleet-worker.v1" (:schema cfg)) (<= 1 (count jobs) 1000)
                     (<= 1 (:max-per-tick cfg) 4) (= (:orca-sha cfg) (e/binary-sha (:orca cfg)))))
      checkpoint (or (h/saved (str (:state-root cfg) "/checkpoint.edn")) {})
      rows (atom checkpoint)
      client (e/client (edn/read-string (slurp (:etcd-config cfg))))
      slot-for (fn [job] (let [en (:enrollment job) t (:initial-slot en) p (get-in en [:schedule :every-ms])]
                           (when (<= t now) (+ t (* p (quot (- now t) p))))))
      selected (take (:max-per-tick cfg)
                  (filter (fn [j] (let [r (get checkpoint (:catalog-bot-id j)) slot (slot-for j)]
                    (and slot (not= slot (:completed-slot r))
                         (or (nil? (:checked-at r)) (not (contains? #{"held" "unknown"} (:state r)))
                             (>= (- now (:checked-at r)) 600000))))) jobs))
      public-rows (fn [] (mapv (fn [job]
                       (or (get @rows (:catalog-bot-id job))
                         {:catalog-bot-id (:catalog-bot-id job) :job-id (get-in job [:enrollment :job-id])
                          :state "queued" :next-slot (+ (or (slot-for job) (get-in job [:enrollment :initial-slot])) 86400000)})) jobs))]
 (publish! cfg (public-rows))
 (doseq [job selected]
  (let [bot (:catalog-bot-id job) slot (slot-for job)
        result (try (original/tick-job! cfg client job (System/currentTimeMillis))
                    (catch Exception _ {:catalog-bot-id bot :job-id (get-in job [:enrollment :job-id])
                                        :state "held" :reason "work-binding-or-simulation-unconfirmed"}))
        prior (or (:last-result result) (when (contains? #{"completed" "already-completed"} (:state result)) result))
        confirmed (and (contains? #{"completed" "already-completed"} (:state prior)) (:linear-result-confirmed prior))
        workflow (when confirmed (try (record-progress! cfg job) (catch Exception _ false)))
        row (if confirmed
              {:catalog-bot-id bot :job-id (get-in job [:enrollment :job-id]) :state "waiting"
               :completed-slot slot :last-result prior :next-slot (+ slot 86400000) :linear-workflow-confirmed workflow :checked-at (System/currentTimeMillis)}
              (assoc (merge (select-keys (get @rows bot) [:last-result :completed-slot]) result)
                     :state (if (= "unknown" (:state result)) "unknown" "held") :checked-at (System/currentTimeMillis)))]
    (swap! rows assoc bot row)
    (h/durable! (str (:state-root cfg) "/checkpoint.edn") (pr-str @rows))))
 (let [r (publish! cfg (public-rows))]
  (println (json/generate-string {:physics-jobs (count jobs) :selected (count selected) :observedAt (:observedAt r)
               :states (frequencies (map :state (:jobs r))) :serviceLoaded (:serviceLoaded r)}))))
