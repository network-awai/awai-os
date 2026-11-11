(ns otehon-c1.preflight
  "Read-only Otehon operator tooling, never a permission or admission gate."
  (:require [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; No payload, key, process argv, VM name or endpoint is collected.
;; No VM/container/model is started. SSH uses existing host trust only.
(def probe-script
  "set -eu
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH
printf 'os=%s\\n' \"$(uname -s)\"
printf 'arch=%s\\n' \"$(uname -m)\"
printf 'cpus=%s\\n' \"$(getconf _NPROCESSORS_ONLN)\"
case $(uname -s) in
  Darwin) printf 'memory_bytes=%s\\n' \"$(sysctl -n hw.memsize)\" ;;
  Linux) awk '/^MemTotal:/ {printf \"memory_bytes=%.0f\\n\", $2 * 1024}' /proc/meminfo ;;
esac
df -Pk . | awk 'NR == 2 {printf \"disk_available_kib=%s\\n\", $4}'
for tool in docker podman limactl qemu-system-aarch64; do
  if command -v \"$tool\" >/dev/null 2>&1; then
    printf 'tool_%s=present\\n' \"$tool\"
  else
    printf 'tool_%s=absent\\n' \"$tool\"
  fi
done
if command -v limactl >/dev/null 2>&1; then
  if lima_status=$(limactl list --format '{{.Status}}' 2>/dev/null); then
    printf 'lima_checked=yes\\n'
    printf '%s\\n' \"$lima_status\" | awk 'NF {printf \"lima_status=%s\\n\", $0}'
  fi
fi
printf 'probe_complete=yes\\n'
")

(def fact-keys
  #{"os" "arch" "cpus" "memory_bytes" "disk_available_kib"
    "tool_docker" "tool_podman" "tool_limactl" "tool_qemu-system-aarch64"
    "lima_checked" "lima_status" "probe_complete"})

(defn positive-number [s]
  (when (and (string? s) (re-matches #"[0-9]{1,16}" s))
    (let [n (parse-long s)] (when (pos? n) n))))

(defn parse-facts [output]
  (when-not (and (string? output) (<= (count output) 8192))
    (throw (ex-info "Invalid probe size" {})))
  (let [pairs (mapv #(str/split % #"=" 2) (str/split-lines output))]
    (when (some #(or (not= 2 (count %)) (not (fact-keys (first %)))) pairs)
      (throw (ex-info "Unexpected probe fields" {})))
    (let [grouped (group-by first pairs)
          facts (into {} pairs)]
      (when (or (some (fn [[k vs]] (and (not= k "lima_status") (> (count vs) 1))) grouped)
                (not= "yes" (get facts "probe_complete"))
                (not (#{"Darwin" "Linux"} (get facts "os")))
                (not (#{"arm64" "aarch64" "x86_64"} (get facts "arch")))
                (some #(nil? (positive-number (get facts %)))
                      ["cpus" "memory_bytes" "disk_available_kib"])
                (some #(not (#{"present" "absent"} (get facts %)))
                      ["tool_docker" "tool_podman" "tool_limactl" "tool_qemu-system-aarch64"])
                (and (contains? facts "lima_checked")
                     (not= "yes" (get facts "lima_checked")))
                (and (contains? facts "lima_status")
                     (or (not= "yes" (get facts "lima_checked"))
                         (some #(not (#{"Running" "Stopped" "Broken" "Installing"} (second %)))
                               (get grouped "lima_status")))))
        (throw (ex-info "Incomplete or malformed probe" {})))
      {:os (get facts "os") :arch (get facts "arch")
       :cpu-count (positive-number (get facts "cpus"))
       :physical-memory-bytes (positive-number (get facts "memory_bytes"))
       :home-filesystem-available-kib (positive-number (get facts "disk_available_kib"))
       :tools (into {} (for [t ["docker" "podman" "limactl" "qemu-system-aarch64"]]
                        [t (get facts (str "tool_" t))]))
       :lima (if (= "yes" (get facts "lima_checked"))
               {:status "observed" :instances (count (get grouped "lima_status"))
                :running (count (filter #(= "Running" (second %)) (get grouped "lima_status")))}
               {:status "unknown"})})))

(defn valid-target? [target]
  ;; A host alias, never an option, URI, shell expression or login.
  (and (string? target) (boolean (re-matches #"[a-zA-Z][a-zA-Z0-9-]{0,62}" target))))

(defn run-probe-process [command input timeout-ms]
  (let [child (process/process {:cmd command :in input :err :discard
                                :shutdown process/destroy-tree})
        pending (future
                  (let [output (.readNBytes (:out child) 8193)]
                    (when (> (alength output) 8192)
                      (throw (ex-info "Probe output limit exceeded" {})))
                    (assoc @child :out (String. output "UTF-8"))))]
    (try
      (let [result (deref pending timeout-ms ::timeout)]
        (when (= ::timeout result)
          (throw (ex-info "Probe deadline exceeded" {})))
        result)
      (finally
        (process/destroy-tree child)
        (when (.isAlive (:proc child)) (.destroyForcibly (:proc child)))
        (future-cancel pending)))))

(defn ssh-probe [target]
  (try
    (let [result (run-probe-process
                                ["ssh" "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=yes"
                                "-o" "ConnectTimeout=8" "-o" "ConnectionAttempts=1"
                                "-o" "ClearAllForwardings=yes" "-o" "ForwardAgent=no"
                                "-o" "ForwardX11=no" "-o" "PermitLocalCommand=no"
                                "-T" (str "node@" target) "/bin/sh" "-s"] probe-script 15000)]
      ;; Never persist SSH diagnostics: they may contain paths or account data.
      (if (zero? (:exit result))
        {:status "observed" :facts (parse-facts (:out result))}
        {:status "unknown" :reason "ssh-or-probe-failed" :exit (:exit result)}))
    (catch Exception _ {:status "unknown" :reason "timeout-or-invalid-probe"})))

(def operational-blockers
  ["independent-host-identity-and-failure-domains-unverified"
   "pinned-otehon-guest-and-artifact-model-digests-unverified"
   "allocatable-capacity-and-hard-resource-limits-unverified"
   "live-consent-revocation-and-root-provisioning-unverified"
   "durable-reservation-lease-and-executor-fence-unverified"
   "real-oci-execution-and-independent-signed-witness-unverified"
   "authenticated-two-node-inference-and-complete-answer-unverified"
   "encrypted-authorized-replication-repair-and-backup-restore-unverified"
   "failure-injection-monitoring-and-soak-slo-unverified"])

(defn collect-report [targets probe]
  (when-not (and (= 2 (count targets)) (= 2 (count (set targets)))
                 (every? valid-target? targets))
    (throw (ex-info "Exactly two distinct SSH host aliases are required" {})))
  (let [nodes (mapv (fn [target] {:node target :observation (probe target)}) targets)
        observed? (every? #(= "observed" (get-in % [:observation :status])) nodes)]
    {:schema "awai.otehon.c1-preflight/1"
     :observed-at (str (java.time.Instant/now))
     :collection-status (if observed? "collected" "incomplete")
     :operational-ready false
     :evidence-class "host-inventory-only"
     :nodes nodes
     :blockers (cond-> operational-blockers (not observed?) (conj "host-inventory-incomplete"))
     :limits ["SSH aliases do not establish independent identities or failure domains."
              "Physical RAM and filesystem free space are observations, not reservations."
              "Executable presence and running VM counts do not establish service readiness."
              "No model request, VM start/stop, container run, disk write or service change on targets."]}))

(defn -main [& args]
  (let [report (collect-report args ssh-probe)]
    (println (json/generate-string report {:pretty true}))
    ;; Collection success is deliberately distinct from operational readiness.
    (when-not (= "collected" (:collection-status report)) (System/exit 2))))

(when (= *file* (System/getProperty "babashka.file"))
  (try (apply -main *command-line-args*)
       (catch Exception _
         (binding [*out* *err*] (println "Usage: bb scripts/otehon-c1/preflight.clj HOST_A HOST_B"))
         (System/exit 2))))
