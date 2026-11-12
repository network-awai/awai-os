;; Operator-only installation. Preserve all existing labels and uncertain claims.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str]
         '[cheshire.core :as json] '[itonami.otehon.etcd :as e]
         '[itonami.otehon.recurring-host :as h])
(let [[manifest digest runtime runner] *command-line-args*
      _ (assert (and runner (= digest (e/binary-sha manifest))))
      cfg (edn/read-string (slurp manifest)) root (:state-root cfg)
      report (json/parse-string (slurp (str root "/status.json")) true)
      _ (assert (= "awai.original-job-observation.v1" (:schema report)))
      _ (assert (= (set (map :catalog-bot-id (:jobs cfg))) (set (map :catalog-bot-id (:jobs report)))) )
      _ (assert (every? #(let [r (or (:last-result %) %)]
                          (and (contains? #{"completed" "already-completed"} (:state r))
                               (true? (:linear-result-confirmed r)) (true? (get-in r [:artifact :readback])))) (:jobs report))
                "every selected original job needs actual result, storage and Linear proofs")
      home (System/getProperty "user.home") label "network.awai.itonami.jobs.awai2795"
      uid (str/trim (:out (sh/sh "id" "-u" :in ""))) domain (str "gui/" uid) target (str domain "/" label)
      plist (str home "/Library/LaunchAgents/" label ".plist") capsule (str root "/original-worker.clj")
      _ (assert (and (not (.exists (java.io.File. plist))) (not (.exists (java.io.File. capsule)))
                     (not (zero? (:exit (sh/sh "launchctl" "print" target :in ""))))) "existing deployment must be reconciled")
      bb (str/trim (:out (sh/sh "which" "bb" :in "")))
      xml #(str/escape (str %) {\& "&amp;" \< "&lt;" \> "&gt;" \" "&quot;"})
      args [bb "-cp" (str runtime "/otehon/src") capsule manifest digest]
      text (str "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Label</key><string>" label "</string>"
                "<key>ProgramArguments</key><array>" (apply str (map #(str "<string>" (xml %) "</string>") args)) "</array>"
                "<key>RunAtLoad</key><true/><key>StartInterval</key><integer>60</integer>"
                "<key>WorkingDirectory</key><string>" (xml root) "</string>"
                "<key>EnvironmentVariables</key><dict><key>PATH</key><string>" (xml (str home "/.local/bin:/opt/homebrew/bin:/usr/bin:/bin")) "</string></dict>"
                "<key>StandardOutPath</key><string>" (xml (str root "/worker.stdout.log")) "</string>"
                "<key>StandardErrorPath</key><string>" (xml (str root "/worker.stderr.log")) "</string>"
                "<key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>")]
 (h/durable! capsule (slurp runner)) (h/durable! plist text)
 (assert (zero? (:exit (sh/sh "plutil" "-lint" plist :in ""))))
 (h/durable! (str root "/activation-intent.edn")
   (pr-str {:issue "AWAI-2795" :manifest-sha digest :runtime runtime :runner-sha (e/binary-sha capsule)
            :label label :bb-sha (e/binary-sha bb) :scope "original-bounded-jobs"}))
 (assert (zero? (:exit (sh/sh "launchctl" "bootstrap" domain plist :in ""))))
 (assert (zero? (:exit (sh/sh "launchctl" "print" target :in ""))))
 (h/durable! (str root "/activated.edn") (pr-str {:loaded true :label label :observed-at (str (java.time.Instant/now))}))
 (prn {:activated true :jobs (count (:jobs cfg)) :label label}))
