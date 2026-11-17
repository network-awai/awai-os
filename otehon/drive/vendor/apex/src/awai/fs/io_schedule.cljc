(ns awai.fs.io-schedule
  "Media-aware I/O schedule planning: least-loaded assignment across
  device queues with explicit backlog spill (AWAI-236, AWAI-532 scope).

  Pure planning only: no queues are opened, no bytes move. Each request
  names a media class (:nvme/:sata/:hdd); `schedule` assigns it to the
  least-loaded device of that class. A device past its :max-depth stops
  admitting — overflow lands in an explicit :backlog, never in silent
  growth. Unknown classes, class-less devices, and bad sizes are
  refused. Queue-depth numbers mirror the hardware roles (deep NVMe,
  shallow SATA, serial HDD) without touching any driver."
  )

(def ^:private known-classes #{:nvme :sata :hdd})

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn- check-devices!
  [devices]
  (doseq [{:keys [device class max-depth]} devices]
    (when-not (and (string? device) (not (empty? device)))
      (fail! :awai.fs/invalid-device "awai fs: device needs a non-empty name" {:device device}))
    (when-not (contains? known-classes class)
      (fail! :awai.fs/unknown-media-class "awai fs: unknown device media class" {:class class}))
    (when-not (and (integer? max-depth) (pos? max-depth))
      (fail! :awai.fs/invalid-device "awai fs: device max-depth must be positive"
             {:device device :max-depth max-depth}))))

(defn- check-request!
  [{:keys [id bytes class] :as req}]
  (when-not (and (integer? bytes) (pos? bytes))
    (fail! :awai.fs/invalid-request "awai fs: request bytes must be positive" {:id id}))
  (when-not (contains? known-classes class)
    (fail! :awai.fs/unknown-media-class "awai fs: unknown request media class"
           {:id id :class class}))
  req)

(defn schedule
  "Assign `requests` to `devices` by media class, least-loaded first.
  Returns {:queues {device [request-ids]} :backlog [request-ids]}:
  queues keep admission order per device, and any request past its
  device's :max-depth waits in :backlog."
  [requests devices]
  (check-devices! devices)
  (let [by-class (group-by :class devices)]
    (doseq [req requests]
      (check-request! req)
      (when (empty? (get by-class (:class req)))
        (fail! :awai.fs/no-device-for-class "awai fs: no device serves this media class"
               {:id (:id req) :class (:class req)})))
    (let [load (atom (into {} (map (fn [d] [(:device d) 0]) devices)))
          depth (atom (into {} (map (fn [d] [(:device d) 0]) devices)))]
      (reduce (fn [acc req]
                (let [cands (get by-class (:class req))
                      pick (first (sort-by (juxt #(get @load (:device %)) :device)
                                           cands))
                      dev (:device pick)]
                  (if (< (get @depth dev) (:max-depth pick))
                    (do (swap! load update dev + (:bytes req))
                        (swap! depth update dev inc)
                        (update acc :queues update dev (fnil conj []) (:id req)))
                    (update acc :backlog conj (:id req)))))
              {:queues {} :backlog []}
              requests))))
