(ns meiji.vm-migration
  "Owner-side migration of the two task-owned guests only. All original VM
   admissions must be CAS-held before an old hypervisor can stop."
  (:require [babashka.fs :as fs] [cheshire.core :as json] [clojure.edn :as edn]
            [clojure.java.shell :as sh] [clojure.string :as str]
            [meiji.host :as host] [meiji.policy :as p] [meiji.recovery :as recovery]
            [meiji.fleet-audit :as audit])
  (:import [java.net ServerSocket] [java.nio.file StandardCopyOption]))

(def label "network.awai.itonami.bot-vm.awai2820")
(defn run! [& args]
  (let [result (apply sh/sh args)]
    (p/require! (zero? (:exit result)) "migration-command-unconfirmed") (:out result)))

(defn held! [cfg digest]
  (let [enrollments (audit/rows (audit/read-prefix! cfg "/itonami/occurrence/v1/enrollment/"))
        cursors (audit/rows (audit/read-prefix! cfg "/itonami/occurrence/v1/cursor/"))
        jobs (filter (fn [[_ v]] (= "awai-vm-physics-v1" (:vm-executor v))) enrollments)]
    (p/require! (and (= 5 (count jobs))
                     (every? (fn [[key en]]
                               (let [cursor (get cursors (str/replace key "/enrollment/" "/cursor/"))]
                                 (and (= [] (:nodes en)) (= (str "AWAI-2820:" digest) (:meiji-recovery-hold en))
                                      (or (nil? cursor) (= "completed" (:state cursor)))))) jobs))
                "all-original-vm-admissions-must-be-held")))

(defn qemu-argv [root old image]
  ["/opt/homebrew/bin/qemu-system-aarch64" "-name" "Awai Meiji Bot VM AWAI-2820"
   "-machine" "virt,accel=hvf" "-cpu" "host" "-smp" "2" "-m" "1024"
   "-bios" "/opt/homebrew/share/qemu/edk2-aarch64-code.fd"
   "-drive" (str "if=none,id=system,format=qcow2,file=" root "/vm-disk.qcow2")
   "-device" "virtio-blk-pci,drive=system,serial=meiji-system,bootindex=1"
   "-boot" "strict=on"
   "-drive" (str "if=none,id=keys,format=raw,readonly=on,file=" root "/key-disk.tar")
   "-device" "virtio-blk-pci,drive=keys,serial=itonami-vm-key"
   "-drive" (str "if=none,id=history,format=qcow2,readonly=on,file=" old "/vm-disk.qcow2")
   "-device" "virtio-blk-pci,drive=history,serial=itonami-vm-history"
   "-nic" "user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:22280-:22"
   "-qmp" (str "unix:" root "/qmp.sock,server=on,wait=off")
   "-display" "none" "-monitor" "none" "-serial" (str "file:" root "/serial.log")])

(defn -main [& [phase image-sha operator-sha signing-pub-sha drain-sha]]
  (p/require! (contains? #{"prepare" "switch" "reconfigure" "status"} phase) "fixed-migration-phase-required")
  (p/require! (= "node" (System/getProperty "user.name")) "owning-node-account-required")
  (let [home (System/getProperty "user.home")
        old (str home "/.itonami/vm-workers/awai-2820")
        root (str home "/.itonami/vm-workers/awai-2820-meiji-v1")
        image-root (str home "/github/workspaces/codex/awai-2820-meiji-image/0.2.0")
        image (str image-root "/meiji.qcow2")
        cfg (json/parse-string (slurp (str home "/.itonami/control-plane/etcd/awai-bots-v1/worker-client.json")) true)
        node (str "vm-" (:authenticated-node cfg))
        owner (json/parse-string (slurp (str old "/owner.json")) true)
        plist (str home "/Library/LaunchAgents/" label ".plist")
        current (json/parse-string (run! "/usr/bin/plutil" "-convert" "json" "-o" "-" plist) true)
        uid (str/trim (run! "/usr/bin/id" "-u")) target (str "user/" uid "/" label)]
    (p/require! (and (contains? #{"vm-levi" "vm-benjamin"} node)
                     (= {:issue "AWAI-2820" :node node} owner) (= label (:Label current))
                     (= "/opt/homebrew/bin/qemu-system-aarch64" (first (:ProgramArguments current)))) "owned-guest-required")
    (if (= phase "status")
      (let [serial (str root "/serial.log")
            service (sh/sh "/bin/launchctl" "print" target)
            owned? (some #{(str "if=virtio,format=qcow2,file=" root "/vm-disk.qcow2")
                            (str "if=none,id=system,format=qcow2,file=" root "/vm-disk.qcow2")} (:ProgramArguments current))
            running? (and owned? (zero? (:exit service)) (boolean (re-find #"state = running" (:out service))))
            booted (and (fs/exists? serial)
                        (str/includes? (slurp serial) "OTEHON_BOOT_REPORT id=awai-meiji-bot-vm version=0.2.0-AWAI-2820")
                        (boolean (re-find #"OTEHON_BOOT_REPORT[^\r\n]*failed=0" (slurp serial))))]
        (println (json/generate-string {:node node :meijiBootReport (boolean booted)
                                       :processRunning (boolean running?) :guestHealth "unknown"
                                       :configuredMemoryMiB (when owned? 1024) :configuredVcpus (when owned? 2)
                                       :historyPreserved (fs/exists? (str old "/vm-disk.qcow2"))})))
      (do
        (doseq [path [old image-root]] (p/require! (not (fs/sym-link? path)) "migration-symlink-refused"))
        (p/require! (= image-sha (host/sha256 image)) "meiji-image-digest-mismatch")
        (p/require! (= operator-sha (host/sha256 (str image-root "/operator_authorized_keys"))) "operator-public-key-pin-mismatch")
        (p/require! (= signing-pub-sha (host/sha256 (str image-root "/meiji.pub"))) "image-signing-key-pin-mismatch")
        (run! "/opt/homebrew/bin/minisign" "-V" "-p" (str image-root "/meiji.pub")
              "-m" image "-x" (str image-root "/meiji.qcow2.minisig"))
        (if (= phase "prepare")
          (do
            (p/require! (not (fs/exists? root)) "preserve-existing-migration-state")
            (recovery/private-dir! root)
            (recovery/private-write! (str root "/operator_authorized_keys") (slurp (str image-root "/operator_authorized_keys")))
            (p/require! (= node (:node (edn/read-string (slurp (str old "/node.edn"))))) "preserve-node-identity")
            (run! "/usr/bin/tar" "-cf" (str root "/key-disk.tar") "-C" old
                  "node.edn" "client.key" "client.pem" "client-ca.pem" "ssh_host_ed25519_key"
                  "-C" root "operator_authorized_keys")
            (fs/set-posix-file-permissions (str root "/key-disk.tar") "rw-------")
            (run! "/opt/homebrew/bin/qemu-img" "create" "-f" "qcow2" "-F" "qcow2"
                  "-b" image (str root "/vm-disk.qcow2"))
            (recovery/private-write! (str root "/old-launch.plist") (slurp plist))
            (recovery/private-write! (str root "/prepared.json")
              (json/generate-string {:node node :imageSha256 image-sha :operatorSha256 operator-sha :oldDisk (str old "/vm-disk.qcow2")}))
            (println (json/generate-string {:node node :prepared true :oldDiskChanged false :nodeKeysStayedOnHost true})))
          (let [prepared (json/parse-string (slurp (str root "/prepared.json")) true)
                _ (p/require! (= image-sha (:imageSha256 prepared)) "prepared-image-required")
                expected-root (if (= phase "reconfigure") root old)
                _ (p/require! (some #{(str "if=virtio,format=qcow2,file=" expected-root "/vm-disk.qcow2")
                                      (str "if=none,id=system,format=qcow2,file=" expected-root "/vm-disk.qcow2")} (:ProgramArguments current)) "owned-guest-launch-required")
                _ (held! cfg drain-sha)
                ;; bootout returns before launchd finishes removing the job.
                ;; Resume an already-stopped preparation without booting it again.
                _ (when (zero? (:exit (sh/sh "/bin/launchctl" "print" target)))
                    (run! "/bin/launchctl" "bootout" target))
                _ (loop [attempt 0]
                    (when (zero? (:exit (sh/sh "/bin/launchctl" "print" target)))
                      (p/require! (< attempt 100) "old-service-still-loaded")
                      (Thread/sleep 200) (recur (inc attempt))))
                _ (with-open [_ (ServerSocket. 22280)] true)
                history-sha (host/sha256 (str old "/vm-disk.qcow2"))
                job {:Label label :ProgramArguments (qemu-argv root old image) :WorkingDirectory root
                     :RunAtLoad true :KeepAlive {:SuccessfulExit false} :ThrottleInterval 15
                     :LimitLoadToSessionType "Background" :StandardOutPath (str root "/qemu.stdout.log")
                     :StandardErrorPath (str root "/qemu.stderr.log")}
                pending (str root "/launch.pending.plist")
                xml (sh/sh "/usr/bin/plutil" "-convert" "xml1" "-o" pending "--" "-" :in (json/generate-string job))]
            (p/require! (zero? (:exit xml)) "launch-plan-unconfirmed")
            (when (fs/exists? (str root "/switch-intent.json"))
              (p/require! (= history-sha (:historySha256 (json/parse-string (slurp (str root "/switch-intent.json")) true)))
                          "preserved-history-digest-changed"))
            (when-not (fs/exists? (str root "/switch-intent.json"))
              (recovery/private-write! (str root "/switch-intent.json")
              (json/generate-string {:node node :historySha256 history-sha :imageSha256 image-sha
                                     :drainPlanSha256 drain-sha :oldDiskReadOnly true})))
            (java.nio.file.Files/move (fs/path pending) (fs/path plist)
              (into-array java.nio.file.CopyOption [StandardCopyOption/ATOMIC_MOVE StandardCopyOption/REPLACE_EXISTING]))
            (run! "/bin/launchctl" "bootstrap" (str "user/" uid) plist)
            (println (json/generate-string {:node node :switched true :imageSha256 image-sha
                                           :oldDiskReadOnly true :historySha256 history-sha}))))))))
