(ns meiji.host-test
  (:require [clojure.test :refer [deftest is testing]] [meiji.policy :as p]
            [meiji.host :as host] [babashka.fs :as fs] [org.httpkit.server :as server]
            [cheshire.core :as json] [meiji.kapitsa :as kapitsa] [meiji.transport :as transport]))

(def fixture {:id "meiji-test" :name "Meiji" :backend :qemu :arch :aarch64
              :format :qcow2 :image "/owner/base.qcow2" :sha256 (apply str (repeat 64 "a"))
              :limits {:cpus 2 :memory-mib 1024} :ceiling {:cpus 4 :memory-mib 4096}
              :executable "/trusted/qemu" :firmware "/trusted/efi"})

(deftest policy-boundaries
  (doseq [request [{:op "exec"} {:op "start" :id "meiji-test" :executable "sh"}
                   {:op "snapshot" :args ["-drive"]} {:op "stop"}]]
    (is (thrown? Exception (p/request! request))))
  (doseq [limits [{:cpus 0 :memory-mib 1024} {:cpus 8 :memory-mib 1024}
                  {:cpus 2 :memory-mib 8192} {:cpus 1.5 :memory-mib 1024}
                  {:cpus 2 :memory-mib "1024"} {:cpus 2 :memory-mib 1024 :extra true}]]
    (is (thrown? Exception (p/limits! limits (:ceiling fixture))))))

(deftest host-argv
  (doseq [[platform accel] [[:macos "hvf"] [:linux "kvm"] [:windows "whpx"]]]
    (let [vm (assoc fixture :arch :x86_64)
          args (p/argv {:os platform :arch :x86_64} vm "/owned/disk.qcow2")]
      (is (some #{(str "q35,accel=" accel)} args))
      (is (some #{"if=virtio,format=qcow2,file=/owned/disk.qcow2"} args))
      (is (not-any? #{"tcg" "sh" "-enable-kvm"} args))))
  (is (thrown? Exception (p/argv {:os :macos :arch :aarch64} (assoc fixture :arch :x86_64) "disk")))
  (is (thrown? Exception (p/argv {:os :windows :arch :aarch64} fixture "disk")))
  (is (thrown? Exception (p/argv {:os :macos :arch :aarch64} (assoc fixture :backend :krunkit) "disk")))
  (is (= ["/trusted/qemu" "--cpus" "2" "--memory" "1024"]
         (take 5 (p/argv {:os :macos :arch :aarch64}
                   (assoc fixture :backend :krunkit :format :raw) "/owned/disk.raw")))))

(defn with-controller [f]
  (let [dir (fs/create-temp-dir {:prefix "meiji-test-"})
        config (str (fs/path dir "config.edn"))]
    (try
      (spit config (pr-str {:version 1 :vms [fixture] :providers []}))
      (let [c (host/create-controller config (str dir))]
        (try (f c config dir) (finally (host/shutdown! c))))
      (finally (fs/delete-tree dir)))))

(deftest durable-limits-and-unknown-state
  (with-controller
    (fn [c config dir]
      (let [public (first (:vms (host/snapshot c)))]
        (is (= "stopped" (:state public)))
        (is (= "unknown" (:guest-health public)))
        (is (nil? (:image public))) (is (nil? (:public-key public))))
      (is (thrown? Exception (host/dispatch! c {:op "stop" :id "unowned"})))
      (is (thrown? Exception (host/start! c "meiji-test")))
      (host/set-limits! c "meiji-test" {:cpus 3 :memory-mib 2048})
      (is (= {:cpus 3 :memory-mib 2048}
             (:limits (host/vm-for (host/create-controller config (str dir)) "meiji-test"))))
      (is (thrown? Exception (host/set-limits! c "meiji-test" {:cpus 99 :memory-mib 1024}))))))

(deftest own-process-only
  ;; Real child process, simulated hypervisor: never presented as a VM boot test.
  (with-controller
    (fn [c _ _]
      (let [p (host/process! [(str (fs/which "sleep")) "30"])]
        (swap! (:children c) assoc "meiji-test" {:process p})
        (is (= "running" (:state (first (:vms (host/snapshot c))))))
        (is (thrown? Exception (host/set-limits! c "meiji-test" {:cpus 1 :memory-mib 512})))
        (is (thrown? Exception (host/stop! c "other" true)))
        (is (.isAlive p))
        (host/stop! c "meiji-test" true)
        (is (not (.isAlive p)))
        (is (= "stopped" (:state (first (:vms (host/snapshot c))))))))))

(deftest provider-boundaries
  (with-controller
    (fn [c _ _]
      (let [backend (if (= :macos (get-in c [:host :os])) :metal :cuda)]
       (doseq [origin ["https://example.com" "http://localhost:8080" "http://127.0.0.1:8080/evil"
                       "http://user@127.0.0.1:8080" "http://127.0.0.1:8080/?target=x"]]
        (let [c (-> c (assoc-in [:config :vms 0 :inference-provider] "gpu")
                    (assoc-in [:config :providers] [{:id "gpu" :origin origin :model "pinned-model" :backend backend}]))]
          (is (thrown? Exception (host/provider! c "meiji-test")))))
      (let [c (-> c (assoc-in [:config :vms 0 :inference-provider] "gpu")
                  (assoc-in [:config :providers] [{:id "gpu" :origin "http://127.0.0.1:8080" :model "pinned-model" :backend backend}]))]
        (is (= backend (:backend (host/provider! c "meiji-test")))))))))

(deftest public-report-integrity
  (with-controller
    (fn [c _ dir]
      (let [c (assoc-in c [:config :reports-dir] (str dir))
            text "{\"schema\":\"awai.fleet-artifact.v1\",\"payload\":{\"z\":1,\"a\":2}}"]
        (spit (str (fs/path dir "fleet-state.json")) text)
        (is (= text (:text (host/dispatch! c {:op "report" :id "fleet-state.json"}))))
        (is (thrown? Exception (host/dispatch! c {:op "report" :id "../config.edn"})))
        (is (thrown? Exception (host/dispatch! c {:op "report" :id "secrets.json"})))))))

(deftest explicit-inference-rail
  (let [calls (atom [])
        stop (server/run-server
               (fn [request]
                 (swap! calls conj {:uri (:uri request) :body (json/parse-string (slurp (:body request)) true)})
                 {:status 200 :headers {"Content-Type" "application/json"}
                  :body (json/generate-string {:choices [{:message {:content "OK"}}]
                                               :usage {:prompt_tokens 3 :completion_tokens 1}})})
               {:ip "127.0.0.1" :port 0})]
    (try
      (with-controller
        (fn [c _ _]
          (doseq [[os backend] [[:macos :metal] [:linux :cuda] [:linux :rocm] [:linux :vulkan] [:windows :directml]]]
            (let [c (-> c (assoc-in [:host :os] os) (assoc-in [:config :vms 0 :inference-provider] "gpu")
                        (assoc-in [:config :providers] [{:id "gpu" :origin (str "http://127.0.0.1:" (:local-port (meta stop)))
                                                        :model "fixture-model" :backend backend}]))
                  r (host/inference-check! c "meiji-test")]
              (is (= "responded" (:state r))) (is (= "unknown" (:gpu-use r)))
              (is (= backend (:backend r)))))))
      (is (= 5 (count @calls)))
      (is (every? #(= "/v1/chat/completions" (:uri %)) @calls))
      (is (every? #(= "fixture-model" (get-in % [:body :model])) @calls))
      (finally (stop)))))

(deftest kapitsa-private-fixed-model
  (is (thrown? Exception (kapitsa/enabled! {})))
  (is (thrown? Exception (kapitsa/enabled! {:enabled false})))
  (is (nil? (kapitsa/enabled! {:enabled true})))
  (let [dir (fs/create-temp-dir {:prefix "meiji-kapitsa-test-"})
        config {:port 18095 :context 2048 :model-dir (str dir) :model-revision kapitsa/model-revision}
        token (apply str (repeat 43 "t"))]
    (try
      (with-redefs [host/host-platform (constantly {:os :macos :arch :aarch64})]
        (let [request (kapitsa/serve-config config token)]
          (is (= "127.0.0.1" (:host request))) (is (true? (:private request)))
          (is (true? (:local request))) (is (false? (:allow_switch request)))
          (is (= kapitsa/model-id (:model_id request)))
          (is (= [] (:peer request)))
          (is (= "0" (:disk_cache request)))
          (is (= kapitsa/jacob-model-id
                 (:model_id (kapitsa/serve-config
                              (assoc config :model-id kapitsa/jacob-model-id
                                            :model-revision kapitsa/jacob-model-revision
                                            :source-sha256 kapitsa/jacob-source-sha256) token))))
          (is (thrown? Exception (kapitsa/model! {:model-id kapitsa/jacob-model-id
                                                 :model-revision kapitsa/jacob-model-revision
                                                 :source-sha256 "unverified"})))
          (is (thrown? Exception (kapitsa/serve-config (assoc config :model-revision "main") token)))
          (is (thrown? Exception (kapitsa/serve-config (assoc config :context 262144) token)))))
      (with-redefs [host/host-platform (constantly {:os :linux :arch :x86_64})]
        (is (thrown? Exception (kapitsa/serve-config config token))))
      (let [path (str (fs/path dir "token")) first-token (kapitsa/token! path)]
        (is (<= 32 (count first-token))) (is (= first-token (kapitsa/token! path))))
      (finally (fs/delete-tree dir)))))

(deftest stdio-eof-and-lock-release
  (with-controller
    (fn [_ config dir]
      (let [source (str (fs/parent (fs/parent (:file (meta #'host/-main)))))
            run (fn []
                  (let [p (host/process! [(str (fs/which "bb")) "-cp" source "-m" "meiji.host" config (str (fs/path dir "stdio"))])
                        output (future (slurp (.getInputStream p)))
                        error (future (slurp (.getErrorStream p)))]
                    (with-open [in (.getOutputStream p)] (.write in (.getBytes "{\"op\":\"snapshot\"}\n" "UTF-8")))
                    (is (.waitFor p 5 java.util.concurrent.TimeUnit/SECONDS))
                    (is (zero? (.exitValue p))) (is (empty? @error))
                    (is (= p/version (get-in (json/parse-string @output true) [:ok :schema])))))]
        (run) (run)))))

(deftest model-manifest-boundaries
  (is (thrown? Exception (kapitsa/verified-model! {:files []})))
  (is (thrown? Exception (kapitsa/verified-model! {:files (vec (repeat 13 {:file "config.json" :sha256 "x"}))})))
  (when (= :macos (:os (host/host-platform)))
    (let [dir (fs/create-temp-dir {:prefix "meiji-model-hash-test-"})
          names (sort kapitsa/required-model-files)
          expected "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"]
      (try
        (doseq [name names]
          (let [path (fs/path dir name)] (fs/create-dirs (fs/parent path)) (spit (str path) "abc")))
        (let [config {:model-dir (str dir) :model-revision kapitsa/model-revision :files (mapv #(hash-map :file % :sha256 expected) names)}]
          (is (= expected (kapitsa/model-sha256 (str (fs/path dir "config.json")))))
          (is (nil? (kapitsa/verified-model! config)))
          (spit (str (fs/path dir "config.json")) "tampered")
          (is (thrown? Exception (kapitsa/verified-model! config))))
        (finally (fs/delete-tree dir))))))

(deftest ssh-node-binding
  (let [p {:id "jacob-kapitsa" :node "jacob" :origin "http://127.0.0.1:18095"
           :tunnel {:host "jacob" :user "node" :tail-ip "100.117.208.83" :local-port 18095 :remote-port 18095}}
        args (transport/ssh-argv p)]
    (is (some #{"StrictHostKeyChecking=yes"} args))
    (is (some #{"ExitOnForwardFailure=yes"} args))
    (is (some #{"127.0.0.1:18095:127.0.0.1:18095"} args))
    (doseq [bad [(assoc p :node "other") (assoc p :origin "http://127.0.0.1:9999")
                  (assoc-in p [:tunnel :host] "jacob;sh")
                  (assoc-in p [:tunnel :tail-ip] "8.8.8.8")
                  (assoc-in p [:tunnel :user] "node -oProxyCommand=sh")]]
      (is (thrown? Exception (transport/ssh-argv bad))))))
