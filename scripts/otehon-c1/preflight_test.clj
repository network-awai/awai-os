(ns otehon-c1.preflight-test
  (:require [clojure.test :refer [deftest is run-tests]]
            [clojure.string :as str]))

(load-file "scripts/otehon-c1/preflight.clj")
(require '[otehon-c1.preflight :as p])

(def facts
  (str "os=Darwin\narch=arm64\ncpus=10\nmemory_bytes=17179869184\n"
       "disk_available_kib=168625204\n"
       "tool_docker=present\ntool_podman=absent\ntool_limactl=present\n"
       "tool_qemu-system-aarch64=present\nlima_checked=yes\nprobe_complete=yes\n"))

(deftest inventory-is-not-admission
  (let [report (p/collect-report ["a" "b"]
                (fn [_] {:status "observed" :facts (p/parse-facts facts)}))]
    (is (= "collected" (:collection-status report)))
    (is (false? (:operational-ready report)))
    (is (= 9 (count (:blockers report))))
    (is (= {:status "observed" :instances 0 :running 0}
           (get-in report [:nodes 0 :observation :facts :lima])))))

(deftest missing-observation-stays-unknown
  (let [report (p/collect-report ["a" "b"] (fn [_] {:status "unknown"}))]
    (is (= "incomplete" (:collection-status report)))
    (is (false? (:operational-ready report)))
    (is (some #{"host-inventory-incomplete"} (:blockers report)))))

(deftest refuse-invalid-targets-before-ssh
  (let [calls (atom 0)]
    (doseq [targets [["a" "a"] ["a"] ["a" "b" "c"]
                     ["a" "-oProxyCommand=x"] ["a" "node@b"] ["a" "b;id"]]]
      (is (thrown? Exception (p/collect-report targets (fn [_] (swap! calls inc))))))
    (is (zero? @calls))))

(deftest malformed-output-never-becomes-facts
  (doseq [bad [(str facts "cpus=8\n")
               (str facts "secret=do-not-persist\n")
               (str/replace facts "probe_complete=yes\n" "")
               (str/replace facts "memory_bytes=17179869184" "memory_bytes=unknown")
               (str/replace facts "disk_available_kib=168625204" "disk_available_kib=-1")
               (str/replace facts "tool_docker=present\n" "")
               (str facts "lima_status=unrecognized\n")
               (str (str/replace facts "lima_checked=yes\n" "") "lima_status=Running\n")
               (apply str (repeat 8193 "x")) ""]]
    (is (thrown? Exception (p/parse-facts bad)))))

(deftest count-lima-without-recording-names
  (is (= {:status "observed" :instances 2 :running 1}
         (:lima (p/parse-facts (str facts "lima_status=Running\nlima_status=Stopped\n")))))
  (is (= {:status "unknown"}
         (:lima (p/parse-facts (str/replace facts "lima_checked=yes\n" ""))))))

(deftest qemu-is-independent-of-lima
  (let [observed (p/parse-facts (str facts "qemu_checked=yes\nqemu_running=1\n"))]
    (is (zero? (get-in observed [:lima :running])))
    (is (= {:status "observed" :processes 1} (:qemu observed))))
  (is (= {:status "unknown"} (:qemu (p/parse-facts facts))))
  (is (= 0 (get-in (p/parse-facts (str facts "qemu_checked=yes\nqemu_running=0\n")) [:qemu :processes])))
  (doseq [extra ["qemu_running=1\n" "qemu_checked=yes\n" "qemu_checked=yes\nqemu_running=-1\n"]]
    (is (thrown? Exception (p/parse-facts (str facts extra))))))

(deftest ssh-failure-does-not-export-diagnostics
  (with-redefs [p/run-probe-process (fn [& _] {:exit 255 :err "private diagnostic"})]
    (is (= {:status "unknown" :reason "ssh-or-probe-failed" :exit 255}
           (p/ssh-probe "a"))))
  (with-redefs [p/run-probe-process (fn [& _] {:exit 0 :out "credential=private"})]
    (is (= {:status "unknown" :reason "timeout-or-invalid-probe"}
           (p/ssh-probe "a")))))

(deftest actual-process-deadline
  (try (p/run-probe-process ["sleep" "10"] "" 50)
       (is false "Sleeping process must time out")
       (catch Exception e (is (= "Probe deadline exceeded" (ex-message e)))))
  (is (= 0 (:exit (p/run-probe-process ["sh" "-c" "printf ok"] "" 1000)))))

(deftest actual-output-bound
  (is (thrown? Exception
        (p/run-probe-process ["sh" "-c" "head -c 9000 /dev/zero"] "" 1000))))

(let [result (run-tests)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
