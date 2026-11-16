(ns meiji.host-test
  (:require [clojure.test :refer [deftest is testing]] [meiji.policy :as p]
            [meiji.host :as host] [babashka.fs :as fs] [org.httpkit.server :as server]
            [cheshire.core :as json]))

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
    (is (thrown? Exception (p/limits! limits (:ceiling fixture)))))

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
      (let [p (host/process! ["/bin/sleep" "30"])]
        (swap! (:children c) assoc "meiji-test" {:process p})
        (is (= "running" (:state (first (:vms (host/snapshot c))))))
        (is (thrown? Exception (host/set-limits! c "meiji-test" {:cpus 1 :memory-mib 512})))
        (is (thrown? Exception (host/stop! c "other" true)))
        (is (.isAlive p))
        (host/stop! c "meiji-test" true)
        (is (not (.isAlive p)))))))

(deftest provider-boundaries
  (with-controller
    (fn [c _ _]
      (doseq [origin ["https://example.com" "http://localhost:8080" "http://127.0.0.1:8080/evil"
                       "http://user@127.0.0.1:8080" "http://127.0.0.1:8080/?target=x"]]
        (let [c (-> c (assoc-in [:config :vms 0 :inference-provider] "gpu")
                    (assoc-in [:config :providers] [{:id "gpu" :origin origin :model "pinned-model" :backend :metal}]))]
          (is (thrown? Exception (host/provider! c "meiji-test")))))
      (let [c (-> c (assoc-in [:config :vms 0 :inference-provider] "gpu")
                  (assoc-in [:config :providers] [{:id "gpu" :origin "http://127.0.0.1:8080" :model "pinned-model" :backend :metal}]))]
        (is (= :metal (:backend (host/provider! c "meiji-test")))))))))

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
