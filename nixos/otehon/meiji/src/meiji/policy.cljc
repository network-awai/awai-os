(ns meiji.policy)

(def version "meiji.host.v1")
(def operations #{"snapshot" "report" "start" "stop" "force-stop" "limits" "inference-check"})
(def backends {[:macos :aarch64] #{:qemu :krunkit}
               [:macos :x86_64] #{:qemu}
               [:linux :aarch64] #{:qemu} [:linux :x86_64] #{:qemu}
               [:windows :x86_64] #{:qemu}})
(def gpu-backends {:macos #{:metal :vulkan} :linux #{:cuda :rocm :vulkan}
                   :windows #{:cuda :directml :vulkan}})

(defn fail [code] (throw (ex-info code {:code code})))
(defn require! [condition code] (when-not condition (fail code)))
(defn limits! [limits ceiling]
  (require! (= #{:cpus :memory-mib} (set (keys limits))) "invalid-limits")
  (doseq [k [:cpus :memory-mib]]
    (require! (and (integer? (k limits)) (integer? (k ceiling))
                   (<= (if (= k :cpus) 1 256) (k limits) (k ceiling))) "limit-exceeded"))
  limits)

(defn vm! [host vm]
  (require! (contains? (get backends [(:os host) (:arch host)] #{}) (:backend vm)) "unsupported-backend")
  (require! (= (:arch host) (:arch vm)) "architecture-mismatch")
  (require! (and (string? (:id vm)) (re-matches #"[a-z0-9][a-z0-9-]{0,63}" (:id vm))) "invalid-id")
  (limits! (:limits vm) (:ceiling vm))
  (require! (contains? #{:qcow2 :raw} (:format vm)) "invalid-format")
  (when (= :krunkit (:backend vm))
    (require! (= :raw (:format vm)) "krunkit-requires-raw"))
  (require! (and (string? (:sha256 vm)) (re-matches #"[a-f0-9]{64}" (:sha256 vm))) "image-digest-required")
  vm)

(defn argv
  "Only owner-configured paths and typed limits enter the hypervisor argv.
   No shell, extra-args, device/PCI selection or executable supplied by UI."
  [host vm image]
  (vm! host vm)
  (let [{:keys [cpus memory-mib]} (:limits vm)
        arm? (= :aarch64 (:arch vm))
        accel (case (:os host) :macos "hvf" :linux "kvm" :windows "whpx")]
    (if (= :krunkit (:backend vm))
      [(:executable vm) "--cpus" (str cpus) "--memory" (str memory-mib)
       "--device" (str "virtio-blk,path=" image ",format=raw")
       "--device" "virtio-gpu,width=1280,height=800"]
      (vec (concat
             [(:executable vm) "-machine" (str (if arm? "virt" "q35") ",accel=" accel)
              "-cpu" (if (= :windows (:os host)) "max" "host")
              "-smp" (str cpus) "-m" (str memory-mib)
              "-drive" (str "if=virtio,format=" (name (:format vm)) ",file=" image)
              "-qmp" "stdio" "-display" "none" "-monitor" "none" "-serial" "none"
              "-nic" "user,model=virtio-net-pci"]
             (when-let [firmware (:firmware vm)] ["-bios" firmware]))))))

(defn public-vm [vm state]
  (merge (select-keys vm [:id :name :backend :arch :limits :ceiling :inference-provider])
         {:state state :guest-health "unknown"}))

(defn request! [request]
  (require! (and (map? request) (contains? operations (:op request))) "unknown-operation")
  (require! (every? #{:op :id :limits} (keys request)) "unexpected-parameter")
  (when-not (= "snapshot" (:op request))
    (require! (string? (:id request)) "id-required"))
  request)
