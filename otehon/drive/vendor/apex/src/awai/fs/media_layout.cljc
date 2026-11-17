(ns awai.fs.media-layout
  "Media-class layout policy: which leaf and pack sizes a file plan uses
  on NVMe, SATA SSD, and HDD (AWAI-236, AWAI-532 scope).

  Pure planning only: this namespace maps a media class to layout opts
  for `large-file/layout-plan`. It opens no devices and moves no bytes;
  `io-schedule` already routes requests by the same classes, and tier
  repack already re-seals packs at a caller-chosen target.

  Values are provisional (H45 proposal on AWAI-535, owner approval
  pending): NVMe takes small leaves so parallel random reads stay
  fine-grained, HDD takes large leaves and large packs so reads stay
  sequential, SATA sits between them."
  (:require [awai.fs.large-file :as lf]
            [awai.fs.chunk-profile :as cp]))

(def ^:private mib (* 1024 1024))

(def layout-table
  "Media class to `layout-plan` opts. Keys match the media classes
  `io-schedule` routes (:nvme/:sata/:hdd)."
  {:nvme {:leaf-size lf/compat-leaf-size :pack-target (* 2 mib)}
   :sata {:leaf-size lf/default-leaf-size :pack-target (* 8 mib)}
   :hdd {:leaf-size (* 4 mib) :pack-target (* 64 mib)}})

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn layout-for-class
  "Legacy sizing profile, retained for explicit compatibility measurements.
  New writes/repack must use physical-layout-for-class and a fixed logical
  chunk profile. Never reinterpret an existing file through this table."
  [class]
  (let [opts (get layout-table class)]
    (when-not opts
      (fail! :awai.fs/unknown-media-class
             "awai fs: unknown media class for layout"
             {:class class}))
    opts))

(defn physical-layout-for-class
  "Versioned physical policy. Leaf bytes and logical IDs are not inputs.
  The values remain provisional, record-only planning parameters."
  [class]
  (let [legacy (layout-for-class class)]
    {:version 1 :kind :physical-layout :media-class class
     :pack-target (:pack-target legacy)
     :transfer-target lf/default-transfer-target
     :queue-depth ({:hdd 1 :sata 4 :nvme 8} class)}))

(defn layout-for-profiles [file-size logical physical]
  (cp/admit! logical)
  (when-not (and (= #{:version :kind :media-class :pack-target :transfer-target :queue-depth}
                       (set (keys physical)))
                 (= 1 (:version physical)) (= :physical-layout (:kind physical))
                 (contains? layout-table (:media-class physical))
                 (every? #(and (integer? %) (<= 1 % 1073741824))
                         [(:pack-target physical) (:transfer-target physical)])
                 (integer? (:queue-depth physical)) (<= 1 (:queue-depth physical) 1024))
    (fail! :awai.fs/invalid-physical-profile "unsupported physical profile or logical field mixed into layout" {}))
  (assoc (lf/layout-plan file-size {:leaf-size (:leaf-size logical)
                                     :pack-target (:pack-target physical)})
         :chunk-profile logical :physical-profile physical))
