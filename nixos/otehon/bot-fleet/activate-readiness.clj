;; Install one new owned timer. No existing launchd label is replaced.
(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str]
         '[cheshire.core :as json] '[itonami.otehon.etcd :as e]
         '[itonami.otehon.recurring-host :as h])
(let [[manifest digest runtime-root runner hosted-file] *command-line-args*
      _ (assert (and hosted-file (= digest (e/binary-sha manifest))))
      cfg (edn/read-string (slurp manifest)) home (System/getProperty "user.home")
      root (:state-root cfg) label "network.awai.itonami.readiness.awai2795"
      uid (str/trim (:out (sh/sh "id" "-u"))) domain (str "gui/" uid) target (str domain "/" label)
      plist (str home "/Library/LaunchAgents/" label ".plist")
      _ (assert (not (.exists (java.io.File. plist))) "existing plist must be reconciled, never replaced")
      _ (assert (not (zero? (:exit (sh/sh "launchctl" "print" target)))) "existing service must be reconciled")
      report (json/parse-string (slurp (str root "/public-status.json")) true)
      _ (assert (= (set (map :catalog-bot-id (:jobs cfg))) (set (map :botId (:jobs report)))))
      _ (assert (every? #(and (= "completed" (get-in % [:lastRun :state]))
                             (true? (get-in % [:lastRun :linearResultConfirmed]))) (:jobs report))
                "all selected first-run model/result/Linear proofs required")
      bb (str/trim (:out (sh/sh "which" "bb")))
      capsule (str root "/readiness-worker.clj")
      _ (assert (not (.exists (java.io.File. capsule))))
      _ (spit capsule (slurp runner))
      xml #(str/escape (str %) {\& "&amp;" \< "&lt;" \> "&gt;" \" "&quot;"})
      args [bb "-cp" (str runtime-root "/otehon/src") capsule manifest digest hosted-file]
      contents (str "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>"
                    "<key>Label</key><string>" label "</string><key>ProgramArguments</key><array>"
                    (apply str (map #(str "<string>" (xml %) "</string>") args)) "</array>"
                    "<key>RunAtLoad</key><true/><key>StartInterval</key><integer>60</integer>"
                    "<key>WorkingDirectory</key><string>" (xml root) "</string>"
                    "<key>EnvironmentVariables</key><dict><key>PATH</key><string>" (xml (str home "/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")) "</string>"
                    "<key>MUSE_NO_AUTO_UPDATE</key><string>1</string></dict>"
                    "<key>StandardOutPath</key><string>" (xml (str root "/worker.stdout.log")) "</string>"
                    "<key>StandardErrorPath</key><string>" (xml (str root "/worker.stderr.log")) "</string>"
                    "<key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>\n")]
 (h/durable! plist contents)
 (assert (zero? (:exit (sh/sh "plutil" "-lint" plist))))
 (h/durable! (str root "/activation-intent.edn")
   (pr-str {:issue "AWAI-2795" :label label :manifest-sha digest :runner-sha (e/binary-sha capsule)
            :bb-sha (e/binary-sha bb) :scope "public-readiness-only" :original-jobs-enabled false}))
 (assert (zero? (:exit (sh/sh "launchctl" "bootstrap" domain plist))))
 (assert (zero? (:exit (sh/sh "launchctl" "print" target))))
 (h/durable! (str root "/activated.edn") (pr-str {:loaded true :label label :observed-at (str (java.time.Instant/now))}))
 (println (pr-str {:activated true :label label :bots (count (:jobs cfg)) :scope "public-readiness-only"})))
