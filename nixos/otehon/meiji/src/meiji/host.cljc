(ns meiji.host
  "Otehon host controller. One locked, serialized stdio session. No HTTP listener.
   Tauri carries JSON only; lifecycle, policy, persistence and GPU adapter live here."
  (:require [meiji.policy :as policy] [meiji.transport :as transport] [babashka.fs :as fs]
            [cheshire.core :as json] [clojure.edn :as edn]
            [clojure.java.io :as io] [clojure.string :as str]
            [org.httpkit.client :as http])
  (:import [java.security MessageDigest] [java.nio.channels FileChannel]
           [java.nio.file StandardOpenOption] [java.util.concurrent TimeUnit]))

(defn host-platform []
  {:os (let [os (str/lower-case (System/getProperty "os.name"))]
         (cond (str/includes? os "mac") :macos (str/includes? os "win") :windows :else :linux))
   :arch (if (contains? #{"aarch64" "arm64"} (System/getProperty "os.arch")) :aarch64 :x86_64)})

(defn sha256 [path]
  (let [digest (MessageDigest/getInstance "SHA-256") buffer (byte-array 65536)]
    (with-open [in (io/input-stream (str path))]
      (loop [] (let [n (.read in buffer)] (when (pos? n) (.update digest buffer 0 n) (recur)))))
    (apply str (map #(format "%02x" (bit-and 255 %)) (.digest digest)))))

(defn save! [path value]
  (let [tmp (str path ".tmp")]
    (spit tmp (pr-str value))
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn configured-file! [path]
  (policy/require! (and (string? path) (fs/absolute? path) (fs/regular-file? path)) "configured-file-missing")
  ;; QEMU interprets commas in drive paths as option separators.
  (policy/require! (not (re-find #"[,\r\n]" path)) "unsafe-configured-path")
  path)

(defn process! [args]
  (.start (ProcessBuilder. ^java.util.List args)))

(defn verify-image! [vm]
  (doseq [k [:image :signature :minisign]] (configured-file! (k vm)))
  (policy/require! (= (:sha256 vm) (sha256 (:image vm))) "image-digest-mismatch")
  (policy/require! (and (string? (:public-key vm)) (re-matches #"[A-Za-z0-9+/=]{56}" (:public-key vm))) "image-key-required")
  (let [p (process! [(:minisign vm) "-Vm" (:image vm) "-x" (:signature vm) "-P" (:public-key vm)])]
    (future (slurp (.getInputStream p))) (future (slurp (.getErrorStream p)))
    (when-not (.waitFor p 15 TimeUnit/SECONDS) (.destroyForcibly p) (policy/fail "signature-check-timeout"))
    (policy/require! (zero? (.exitValue p)) "image-signature-invalid")))

(defn create-controller [config-path state-dir]
  (fs/create-dirs state-dir)
  (when-not (fs/exists? config-path)
    (fs/create-dirs (fs/parent config-path))
    (save! config-path {:version 1 :vms [] :providers []}))
  (let [config (edn/read-string (slurp config-path))
        settings-path (str (fs/path state-dir "limits.edn"))
        overrides (if (fs/exists? settings-path) (edn/read-string (slurp settings-path)) {})
        vms (:vms config)]
    (policy/require! (= 1 (:version config)) "unsupported-config")
    (policy/require! (and (vector? vms) (<= (count vms) 32)
                          (= (count vms) (count (set (map :id vms))))) "invalid-catalog")
    {:host (host-platform) :config config :state-dir state-dir :settings-path settings-path
     :overrides (atom overrides) :children (atom {}) :tunnels (atom {})}))

(defn vm-for [controller id]
  (let [vm (first (filter #(= id (:id %)) (get-in controller [:config :vms])))]
    (policy/require! vm "unknown-vm")
    (if-let [limits (get @(:overrides controller) id)] (assoc vm :limits limits) vm)))

(defn alive? [controller id]
  (boolean (when-let [child (get @(:children controller) id)] (.isAlive (:process child)))))

(declare provider!)

(defn snapshot [controller]
  {:schema policy/version :host (:host controller)
   :vms (mapv #(cond-> (policy/public-vm (vm-for controller (:id %))
                (let [child (get @(:children controller) (:id %))]
                  (cond (alive? controller (:id %)) (if (:stopping child) "stopping" "running")
                        (:stopped-by-owner child) "stopped"
                        (and child (not (zero? (.exitValue (:process child))))) "failed"
                        :else "stopped")))
                (:inference-provider %) (assoc :inference
                  (try (select-keys (provider! controller (:id %)) [:id :origin :backend :model :node])
                       (catch Exception _ {:state "unconfigured"}))))
              (get-in controller [:config :vms]))})

(defn start! [controller id]
  (let [vm (vm-for controller id) host (:host controller)]
    (policy/vm! host vm)
    (policy/require! (not (alive? controller id)) "already-running")
    (configured-file! (:executable vm))
    (when-let [firmware (:firmware vm)] (configured-file! firmware))
    (verify-image! vm)
    (let [work (str (fs/path (:state-dir controller) (str id "." (name (:format vm)))))
          meta-path (str work ".edn")
          binding {:image-sha256 (:sha256 vm) :id id}]
      ;; Never replace a working disk or adopt a disk whose provenance is unknown.
      (if (fs/exists? work)
        (policy/require! (and (fs/exists? meta-path) (= binding (edn/read-string (slurp meta-path)))) "working-disk-unbound")
        (do (fs/copy (:image vm) work) (save! meta-path binding)))
      (let [p (process! (policy/argv host vm work))]
        (future (with-open [in (.getInputStream p)] (io/copy in (java.io.OutputStream/nullOutputStream))))
        (future (with-open [in (.getErrorStream p)] (io/copy in (java.io.OutputStream/nullOutputStream))))
        (swap! (:children controller) assoc id {:process p})
        (when (.waitFor p 150 TimeUnit/MILLISECONDS) (policy/fail "hypervisor-exited")))))
  (snapshot controller))

(defn stop! [controller id force?]
  (let [vm (vm-for controller id) p (:process (get @(:children controller) id))]
    (policy/require! (and p (.isAlive p)) "not-running")
    (if force?
      (do (.destroyForcibly p)
          (policy/require! (.waitFor p 5 TimeUnit/SECONDS) "stop-timeout")
          (swap! (:children controller) update id assoc :stopped-by-owner true))
      (do
        (policy/require! (= :qemu (:backend vm)) "graceful-stop-unavailable")
        (let [out (.getOutputStream p)]
          (doseq [command [{:execute "qmp_capabilities"} {:execute "system_powerdown"}]]
            (.write out (.getBytes (str (json/generate-string command) "\n") "UTF-8")))
          (.flush out))
        (swap! (:children controller) update id assoc :stopping true))))
  (snapshot controller))

(defn set-limits! [controller id limits]
  (let [vm (vm-for controller id)]
    (policy/require! (not (alive? controller id)) "stop-before-limits")
    (policy/limits! limits (:ceiling vm))
    (let [next (assoc @(:overrides controller) id limits)]
      (save! (:settings-path controller) next)
      (reset! (:overrides controller) next)))
  (snapshot controller))

(defn provider! [controller id]
  (let [vm (vm-for controller id)
        p (first (filter #(= (:inference-provider vm) (:id %)) (get-in controller [:config :providers])))
        uri (when (:origin p) (java.net.URI. (:origin p)))]
    ;; Initial adapter is deliberately host-local only. No SSRF, redirect or remote fallback.
    (policy/require! (and uri (= "http" (.getScheme uri))
                         (contains? #{"127.0.0.1" "[::1]"} (.getHost uri))
                         (nil? (.getUserInfo uri)) (nil? (.getQuery uri)) (nil? (.getFragment uri))
                         (contains? #{"" "/"} (.getPath uri))
                         (contains? (get policy/gpu-backends
                                         (if (:tunnel p) (:execution-os p) (get-in controller [:host :os])) #{}) (:backend p))
                         (let [timeout (:timeout-ms p 15000)]
                           (and (integer? timeout) (<= 1000 timeout 180000)))
                         (string? (:model p)) (seq (:model p))) "inference-not-configured")
    (when (:tunnel p) (transport/ssh-argv p))
    p))

(defn ensure-tunnel! [controller provider]
  (when (:tunnel provider)
    (let [id (:id provider) existing (get @(:tunnels controller) id)]
      (when-not (and existing (.isAlive existing))
        (let [ssh (if (= :windows (get-in controller [:host :os]))
                    (str (System/getenv "SystemRoot") "/System32/OpenSSH/ssh.exe") "/usr/bin/ssh")
              p (process! (transport/ssh-argv provider (configured-file! ssh))) ready (promise)
              bound (str "debug1: Local forwarding listening on 127.0.0.1 port " (get-in provider [:tunnel :local-port]) ".")]
          (future (slurp (.getInputStream p)))
          (future (with-open [reader (io/reader (.getErrorStream p))]
                    (doseq [line (line-seq reader)]
                      (when (str/starts-with? line bound) (deliver ready true)))))
          (swap! (:tunnels controller) assoc id p)
          ;; Wait for the client's bind receipt, not a timing guess or an arbitrary local listener.
          (when-not (and (deref ready 10000 false) (.isAlive p))
            (.destroy p) (policy/fail "inference-tunnel-failed")))))))

(defn inference-check! [controller id]
  (let [p (provider! controller id)
        _ (ensure-tunnel! controller p)
        started (System/nanoTime)
        response @(http/post (str (str/replace (:origin p) #"/$" "") "/v1/chat/completions")
                    {:timeout (:timeout-ms p 15000) :follow-redirects false
                     :headers (cond-> {"content-type" "application/json"}
                                (:token-file p) (assoc "authorization" (str "Bearer " (str/trim (slurp (configured-file! (:token-file p)))))))
                     :body (json/generate-string {:model (:model p) :stream false :max_tokens 4
                                                  :chat_template_kwargs {:enable_thinking false}
                                                  :messages [{:role "user" :content "Reply OK."}]})})]
    (policy/require! (= 200 (:status response)) "inference-check-failed")
    (let [body (json/parse-string (:body response) true)]
      (policy/require! (and (= (:model p) (:model body (:model p)))
                           (seq (get-in body [:choices 0 :message :content]))) "inference-empty-response")
      {:schema policy/version :provider (:id p) :backend (:backend p) :model (:model p)
       :observed-at (str (java.time.Instant/now))
       :duration-ms (quot (- (System/nanoTime) started) 1000000)
       :state "responded" :gpu-use "unknown" :usage (:usage body)})))

(def report-files #{"fleet-state.json" "agent-presence.json" "peer-cycles.json"
                    "circle-work-state.json" "mail-executor-state.json" "meiji-production.json" "meiji-review.json"})
(defn report [controller id]
  (policy/require! (contains? report-files id) "unknown-report")
  (let [dir (get-in controller [:config :reports-dir])]
    (policy/require! (and (string? dir) (fs/absolute? dir)) "reports-not-configured")
    (let [path (str (fs/path dir id))]
      (configured-file! path)
      (policy/require! (<= (fs/size path) 8388608) "report-too-large")
      ;; Public observation only. Existing Soshiki schema/freshness checks still apply.
      ;; Preserve the original JSON text: reordering payload map keys breaks the
      ;; existing fleet envelope's JSON.stringify digest even if values match.
      {:text (slurp path)})))

(defn dispatch! [controller request]
  (policy/request! request)
  (case (:op request)
    "snapshot" (snapshot controller)
    "report" (report controller (:id request))
    "start" (start! controller (:id request))
    "stop" (stop! controller (:id request) false)
    "force-stop" (stop! controller (:id request) true)
    "limits" (set-limits! controller (:id request) (:limits request))
    "inference-check" (inference-check! controller (:id request))))

(defn shutdown! [controller]
  ;; An abnormal controller exit must not leave unowned hypervisors behind.
  (doseq [[_ process] @(:tunnels controller)] (.destroy process))
  (doseq [[_ {:keys [process]}] @(:children controller)]
    (when (.isAlive process) (.destroy process)
      (when-not (.waitFor process 2 TimeUnit/SECONDS) (.destroyForcibly process)))))

(defn -main [config-path state-dir]
  (fs/create-dirs state-dir)
  (with-open [channel (FileChannel/open (fs/path state-dir "controller.lock")
                       (into-array StandardOpenOption [StandardOpenOption/CREATE StandardOpenOption/WRITE]))]
    (let [lock (.tryLock channel)]
      (policy/require! lock "controller-already-running")
      (try
        (let [controller (create-controller config-path state-dir)]
          (.addShutdownHook (Runtime/getRuntime) (Thread. #(shutdown! controller)))
          (try
            (doseq [line (line-seq (io/reader *in*))]
              (let [reply (try (policy/require! (<= (count line) 4096) "request-too-large")
                              {:ok (dispatch! controller (json/parse-string line true))}
                              (catch Exception e {:error (or (:code (ex-data e)) "operation-failed")}))]
                (println (json/generate-string reply)) (flush)))
            (finally (shutdown! controller))))
        ;; Closing the channel releases the lock, including on exceptions.
        ;; Avoid reflective calls on JDK-private FileLockImpl in Babashka.
        (finally nil)))))
