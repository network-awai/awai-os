(require '[clojure.java.shell :as sh] '[clojure.string :as str] '[cheshire.core :as json]
         '[itonami.otehon.etcd :as e] '[itonami.otehon.recurring-host :as h])
(let [[manifest digest repo runtime] *command-line-args*
      _ (assert (and runtime (= digest (e/binary-sha manifest))))
      cfg (json/parse-string (slurp manifest) true) root (:stateRoot cfg)
      _ (assert (true? (:storageReadback (json/parse-string (slurp (str root "/receipt.json")) true))))
      label "network.awai.itonami.fleet-observer.awai2795" home (System/getProperty "user.home")
      uid (str/trim (:out (sh/sh "id" "-u" :in ""))) domain (str "gui/" uid) target (str domain "/" label)
      plist (str home "/Library/LaunchAgents/" label ".plist")
      _ (assert (and (not (.exists (java.io.File. plist))) (not (.exists (java.io.File. runtime)))
                     (not (zero? (:exit (sh/sh "launchctl" "print" target :in ""))))) "existing deployment must be reconciled")
      command! (fn [& args] (let [r (apply sh/sh (concat args [:in ""]))] (assert (zero? (:exit r))) (str/trim (:out r))))
      revision (command! "git" "-C" repo "rev-parse" "HEAD")
      archive (str root "/source.tar") _ (h/private-dir! runtime)
      _ (command! "git" "-C" repo "archive" "--format=tar" (str "--output=" archive) revision
           "nixos/otehon/bot-fleet/project-runtime.mjs" "nixos/otehon/bot-fleet/repository-connections.mjs" "nixos/otehon/bot-fleet/stabilization.mjs"
           "nixos/otehon/shell/src/fleet-projection.js" "nixos/otehon/shell/package.json")
      _ (command! "tar" "-xf" archive "-C" runtime)
      node (command! "which" "node") args [node (str runtime "/nixos/otehon/bot-fleet/project-runtime.mjs") manifest digest]
      xml #(str/escape (str %) {\& "&amp;" \< "&lt;" \> "&gt;" \" "&quot;"})
      text (str "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Label</key><string>" label "</string>"
                "<key>ProgramArguments</key><array>" (apply str (map #(str "<string>" (xml %) "</string>") args)) "</array>"
                "<key>RunAtLoad</key><true/><key>StartInterval</key><integer>60</integer>"
                "<key>WorkingDirectory</key><string>" (xml root) "</string>"
                "<key>StandardOutPath</key><string>" (xml (str root "/worker.stdout.log")) "</string>"
                "<key>StandardErrorPath</key><string>" (xml (str root "/worker.stderr.log")) "</string>"
                "<key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>")]
 (h/durable! plist text) (command! "plutil" "-lint" plist)
 (h/durable! (str root "/activation-intent.json") (json/generate-string {:revision revision :manifestSha256 digest
  :archiveSha256 (e/binary-sha archive) :label label :nodeSha256 (e/binary-sha node)}))
 (command! "launchctl" "bootstrap" domain plist) (command! "launchctl" "print" target)
 (prn {:activated true :label label :revision revision}))
