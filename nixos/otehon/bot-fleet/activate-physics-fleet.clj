(require '[clojure.edn :as edn] '[clojure.java.shell :as sh] '[clojure.string :as str] '[cheshire.core :as json]
 '[itonami.otehon.etcd :as e] '[itonami.otehon.recurring-host :as h])
(let [[manifest digest runner] *command-line-args*
      _ (assert (and runner (= digest (e/binary-sha manifest))))
      cfg (edn/read-string (slurp manifest)) root (:state-root cfg)
      _ (assert (and (= "itonami.physics-fleet-worker.v1" (:schema cfg)) (.exists (java.io.File. (str root "/provenance.edn")))))
      report (json/parse-string (slurp (str root "/public-status.json")) true)
      proofs (filter #(and (true? (get-in % [:last-result :linear-result-confirmed]))
                            (true? (get-in % [:last-result :artifact :readback]))
                            (= "measured" (get-in % [:last-result :domain-result :status]))) (:jobs report))
      _ (assert (and (= (count (:jobs cfg)) (count (:jobs report))) (>= (count proofs) 1)) "actual bounded first-wave proofs required")
      home (System/getProperty "user.home") label (or (:worker-label cfg) "network.awai.itonami.physics.awai2809")
      _ (assert (contains? #{"network.awai.itonami.physics.awai2809" "network.awai.itonami.material.awai2809"} label))
      uid (str/trim (:out (sh/sh "id" "-u" :in ""))) domain (str "gui/" uid) target (str domain "/" label)
      plist (str home "/Library/LaunchAgents/" label ".plist") capsule (str root "/physics-worker.clj")
      _ (assert (and (not (.exists (java.io.File. plist))) (not (.exists (java.io.File. capsule)))
                     (not (zero? (:exit (sh/sh "launchctl" "print" target :in ""))))) "existing physics worker must be reconciled")
      bb (:bb (first (:jobs cfg))) runtime (:runtime-root (first (:jobs cfg)))
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
 (h/durable! (str root "/activation-intent.edn") (pr-str {:issue "AWAI-2809" :label label :manifest-sha digest
  :runner-sha (e/binary-sha capsule) :first-wave-confirmed (count proofs) :max-per-wake (:max-per-tick cfg)
  :scope "pinned-otehon-simulation-only" :native-tests "unmeasured" :growth "held" :actuation "disabled"}))
 (assert (zero? (:exit (sh/sh "launchctl" "bootstrap" domain plist :in ""))))
 (assert (zero? (:exit (sh/sh "launchctl" "print" target :in ""))))
 (prn {:activated true :jobs (count (:jobs cfg)) :first-wave-confirmed (count proofs) :label label}))
