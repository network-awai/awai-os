(ns itonami.otehon.muse-host
  "Babashka Otehon host adapter. Executes the real installed Muse CLI once."
  (:require [clojure.string :as str]
            [itonami.otehon.muse :as muse]
            [itonami.otehon.profile :as profile]
            [itonami.otehon.bundle :as bundle]
            [itonami.otehon.occurrence :as occurrence]
            [itonami.otehon.io :as hio]
            #?(:clj [cheshire.core :as json]))
  #?(:clj (:import [java.nio.file Files Paths]
                   [java.nio.file.attribute PosixFilePermissions]
                   [java.util.concurrent TimeUnit])))

(defn load-profile [dir]
  (let [names (concat profile/hermes-files profile/itonami-files)
        texts (into {} (for [rel names :let [p (str dir "/" rel)]]
                         [rel (when (hio/file? p)
                                (let [s (hio/slurp-utf8 p)]
                                  (when (> (count s) 262144) (throw (ex-info "profile file limit" {}))) s))]))
        prof (profile/load-profile {:name (hio/basename dir) :read-text texts
                                    :parse-edn hio/parse-edn :parse-json hio/parse-json})]
    (assoc prof :soul (get texts "SOUL.md") :source-sha (occurrence/digest texts))))

(defn binding-valid? [b]
  (and (= "awai.bot-run-binding.v1" (:schema b))
       (every? #(and (string? (get b %)) (not (str/blank? (get b %))))
               [:issue-id :issue-uuid :project-id :initiative-id :run-id :acceptance-unit])
       (boolean (re-matches #"[A-Z][A-Z0-9]*-[0-9]+" (:issue-id b)))
       (boolean (re-matches #"[a-f0-9]{40}" (str (:revision b))))
       (map? (:forecast b))))

(defn invoke! [prof prompt directory binding]
  #?(:clj
     (let [planned (muse/plan prof prompt)]
       (when-not (= :ok (:status planned)) (throw (ex-info "Muse gate refused" (select-keys planned [:status :reason]))))
       (when-not (binding-valid? binding) (throw (ex-info "explicit issue/run/revision/forecast binding required" {})))
       (let [root (Paths/get directory (make-array String 0))
             _ (Files/createDirectory root (into-array java.nio.file.attribute.FileAttribute
                  [(PosixFilePermissions/asFileAttribute (PosixFilePermissions/fromString "rwx------"))]))
             path #(str (.resolve root ^String %))
             _ (.mkdirs (java.io.File. (path "config/muse")))
             _ (spit (path "config/muse/settings.json") "{\"schema_version\":1,\"mcpServers\":{}}")
             effective-prompt (str (:soul prof) "\n\n" prompt)
             _ (when (> (count effective-prompt) 65536) (throw (ex-info "combined prompt limit" {})))
             _ (spit (path "prompt.txt") effective-prompt)
             _ (spit (path "binding.edn") (pr-str binding))
             _ (spit (path "intent.edn") (pr-str (assoc planned :state :admitted-local-call-only :binding binding)))
             argv ["muse" "exec" "--json" "--provider" "meta" "--model" (:model planned)
                   "--reasoning-effort" (:reasoning-effort planned) "--preset" "empty"
                   "--contributor-mode" "off" "--disable-shell" "--disable-write" "--disable-web-tools"
                   "--disable-reminders" "--disable-request-user-input" "--no-foreign-personal-context"
                   "--max-model-steps" "1" "--workspace" (str (.toAbsolutePath root))
                   "--prompt-file" (str (.toAbsolutePath (.resolve root "prompt.txt")))]
             pb (doto (ProcessBuilder. ^java.util.List argv)
                  (.redirectOutput (java.io.File. (path "events.jsonl")))
                  (.redirectError (java.io.File. (path "stderr.txt"))))
             env (.environment pb)
             auth (or (System/getenv "MUSE_AUTH_PATH")
                      (str (or (System/getenv "XDG_CONFIG_HOME") (str (System/getProperty "user.home") "/.config")) "/muse/auth.json"))]
         (.put env "MUSE_AUTH_PATH" auth) ; path only; never copy/read credentials
         ;; Muse's binary resolves auth under XDG_CONFIG_HOME; its launcher also
         ;; uses MUSE_AUTH_PATH. Link the existing host file, never copy secrets.
         (when (.isFile (java.io.File. auth))
           (Files/createSymbolicLink (.resolve root "config/muse/auth.json")
             (.toAbsolutePath (Paths/get auth (make-array String 0)))
             (make-array java.nio.file.attribute.FileAttribute 0)))
         (.put env "XDG_CONFIG_HOME" (str (.toAbsolutePath (.resolve root "config"))))
         (.put env "MUSE_NO_AUTO_UPDATE" "1")
         (try
           (let [process (.start pb)
                 finished? (.waitFor process 120 TimeUnit/SECONDS)
                 _ (when-not finished? (.destroyForcibly process))
                 raw (java.io.File. (path "events.jsonl"))
                 _ (when (> (.length raw) 8388608) (throw (ex-info "event limit" {})))
                 events (mapv #(json/parse-string % true) (remove str/blank? (str/split-lines (slurp raw))))
                 r (assoc (muse/result planned events (if finished? (.exitValue process) -1))
                          :binding binding :process-exit (when finished? (.exitValue process)))]
             (spit (path "result.edn") (pr-str r)) r)
           (catch Exception _
             (let [r {:schema "itonami.muse-result.v1" :state "unknown" :binding binding
                      :provider "meta" :model (:model planned) :reason "host/uncertain-no-retry"}]
               (spit (path "result.edn") (pr-str r)) r)))))
     :default (throw (ex-info "Muse host adapter requires the Babashka Otehon host" {}))))

(defn dispatch-muse!
  "Composes confirmed distributed admission with the real Muse host, without
  selecting a KV backend or minting membership. A backend is required."
  [client profile-dir prompt output binding request now-ms]
  (let [prof (load-profile profile-dir) plan (muse/plan prof prompt)
        input-sha (occurrence/digest [(:source-sha prof) prompt])
        pinned (bundle/bundle-cid (bundle/bundle-files profile-dir {}))
        bound (merge binding (select-keys request [:attempt-id :input-sha :run-id :slot :bot-id :job-id :profile-cid :schedule-cid :executor :grant-cid]))]
    (when-not (and (= :ok (:status plan)) (binding-valid? binding)
                   (= (:name prof) (:bot-id request)) (= pinned (:profile-cid request))
                   (= (:model plan) (:model request)) (= "meta" (:provider request))
                   (= input-sha (:input-sha request))
                   (= (:source-sha prof) (:source-sha (load-profile profile-dir)))
                   (every? #(= (get request %) (get binding %)) [:issue-id :project-id :initiative-id :run-id]))
      (throw (ex-info "profile/input/work binding mismatch" {})))
    (occurrence/dispatch! (assoc client :invoke-once #(invoke! prof prompt output bound))
                          request (:authenticated-node client) now-ms)))

(defn recover-muse!
  "Reparse the original local transcript; no process spawn/model request.
  Private result files alone cannot fabricate a completed model terminal."
  [client request output]
  #?(:clj
     (let [binding (hio/parse-edn (hio/slurp-utf8 (str output "/binding.edn")))
           intent (hio/parse-edn (hio/slurp-utf8 (str output "/intent.edn")))
           saved (hio/parse-edn (hio/slurp-utf8 (str output "/result.edn")))
           raw (java.io.File. (str output "/events.jsonl"))]
       (when (> (.length raw) 8388608) (throw (ex-info "event limit" {})))
       (when-not (and (= binding (:binding intent)) (= binding (:binding saved))
                      (every? #(= (get request %) (get binding %)) [:attempt-id :input-sha :run-id :slot :bot-id :job-id :profile-cid :schedule-cid :issue-id :project-id :initiative-id :executor :grant-cid]))
         (throw (ex-info "original run binding required" {})))
       (let [events (mapv #(json/parse-string % true) (remove str/blank? (str/split-lines (slurp raw))))
             result (assoc (muse/result intent events (or (:process-exit saved) -1)) :binding binding)
             ks (occurrence/keys-for (:bot-id request) (:job-id request) (:slot request))
             claim ((:read client) (:occurrence ks))]
         (occurrence/reconcile! client request claim result)))
     :default (throw (ex-info "Muse recovery requires the Babashka Otehon host" {}))))

(defn -main [& [dir prompt-file output binding-file]]
  (when-not binding-file (throw (ex-info "usage: muse-host PROFILE PROMPT_FILE NEW_OUTPUT BINDING.edn" {})))
  (let [r (invoke! (load-profile dir) (hio/slurp-utf8 prompt-file) output (hio/parse-edn (hio/slurp-utf8 binding-file)))]
    (println (pr-str (dissoc r :text :usage)))
    (hio/exit! (if (= "completed" (:state r)) 0 3))))
