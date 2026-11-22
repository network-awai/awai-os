(ns awai.inference.manager
  "Murakumo model manager domain (AWAI-3203 stage 3, AWAI-3240): the pinned catalog, device usage
  snapshots, the memory estimate, fit and the recommendation. See
  docs/otehon/murakumo-model-manager-20261118.md sections 3-5 and the Figma proposal in section 7.

  Pure and integer-only, so Babashka, Basilisp and the compiled ClojureScript give the same answer:
  no I/O, regex, floats, dates or platform numbers. The caller supplies the time. Unknown stays
  unknown (nil, never 0). Every check returns problems as strings in a fixed order.")

;; ---------------------------------------------------------------------------
;; Units

(def gib 1073741824)
(def overhead-bytes 322122547) ; about 0.3 GiB of compute buffers
(def hex-digits #{\0 \1 \2 \3 \4 \5 \6 \7 \8 \9 \a \b \c \d \e \f})

(defn- nat-n? [x] (and (integer? x) (not (boolean? x)) (>= x 0)))
(defn- pos-n? [x] (and (nat-n? x) (> x 0)))
(defn- text? [x] (and (string? x) (> (count x) 0)))
(defn- hex? [x n] (and (string? x) (= n (count x)) (every? hex-digits (seq x))))
(defn- ends-with? [s suffix] (and (string? s) (>= (count s) (count suffix))
                                  (= suffix (subs s (- (count s) (count suffix))))))

;; ---------------------------------------------------------------------------
;; Catalog: every entry pins one file

(def model-keys [:id :label :repo :revision :file :quant :bytes :sha256 :layers :kv-heads :head-dim :license])

(defn model-problems
  "Problems with one catalog entry, in field order. Empty when it is pinned and complete."
  [m]
  (cond-> []
    (not (map? m)) (conj "model/not-a-map")
    (not (text? (:id m))) (conj "model/id")
    (not (text? (:label m))) (conj "model/label")
    (not (text? (:repo m))) (conj "model/repo")
    (not (hex? (:revision m) 40)) (conj "model/revision")
    (not (ends-with? (:file m) ".gguf")) (conj "model/file")
    (not (text? (:quant m))) (conj "model/quant")
    (not (pos-n? (:bytes m))) (conj "model/bytes")
    (not (hex? (:sha256 m) 64)) (conj "model/sha256")
    (not (pos-n? (:layers m))) (conj "model/layers")
    (not (pos-n? (:kv-heads m))) (conj "model/kv-heads")
    (not (pos-n? (:head-dim m))) (conj "model/head-dim")
    (not (text? (:license m))) (conj "model/license")))

(defn catalog-problems
  "Problems with a catalog document. Each entry's problems are prefixed with its index."
  [catalog]
  (let [models (:models catalog)
        ids (map :id models)]
    (vec
     (concat
      (when-not (= "awai.murakumo.catalog.v1" (:schema catalog)) ["catalog/schema"])
      (when-not (and (sequential? models) (seq models)) ["catalog/models"])
      (when (and (sequential? models) (not= (count ids) (count (distinct ids)))) ["catalog/duplicate-id"])
      (when (sequential? models)
        (mapcat (fn [i m] (map #(str i ":" %) (model-problems m))) (range) models))))))

;; ---------------------------------------------------------------------------
;; Estimate and fit

(defn kv-bytes-per-token
  "K and V for every layer and KV head, f16."
  [m]
  (* 2 (:layers m) (:kv-heads m) (:head-dim m) 2))

(defn estimate-bytes
  "Estimated memory to load the model with this context: file + KV cache + buffers."
  [m context]
  (+ (:bytes m) (* (kv-bytes-per-token m) context) overhead-bytes))

(defn budget-bytes
  "Memory budget for one model. android: 40 % of RAM (the OS and other apps share it). mac: two
  thirds of unified memory rounded down to a whole GiB (Metal's recommended working set). nil when
  the device's RAM is unknown or its kind is not one of these."
  [kind ram-bytes]
  (when (pos-n? ram-bytes)
    (case kind
      "android" (quot (* ram-bytes 40) 100)
      "mac" (* gib (quot (quot (* ram-bytes 2) 3) gib))
      nil)))

(defn fit
  "comfortable: estimate <= 80 % of budget. tight: <= budget. no-fit: above. unknown: no budget."
  [estimate budget]
  (cond
    (not (pos-n? budget)) "unknown"
    (<= (* estimate 5) (* budget 4)) "comfortable"
    (<= estimate budget) "tight"
    :else "no-fit"))

(defn assess
  "Every catalog model on one device, in catalog order: id, estimate bytes and fit."
  [models kind ram-bytes context]
  (let [budget (budget-bytes kind ram-bytes)]
    {:budget budget
     :models (mapv (fn [m] (let [e (estimate-bytes m context)]
                             {:id (:id m) :estimate e :fit (fit e budget)}))
                   models)}))

(defn- largest [rows] (when (seq rows) (:id (last (sort-by :estimate rows)))))

(defn recommend
  "The recommendation for one device: the largest comfortable model, else the largest tight one,
  else none. :quality is the largest tight model when it is larger than the recommendation (worth
  loading only when the device is otherwise idle). Unknown RAM gives no recommendation."
  [models kind ram-bytes context]
  (let [{:keys [budget models]} (assess models kind ram-bytes context)
        comfortable (filter #(= "comfortable" (:fit %)) models)
        tight (filter #(= "tight" (:fit %)) models)
        pick (or (largest comfortable) (largest tight))
        quality (largest tight)]
    {:budget budget
     :recommended pick
     :quality (when (and quality (not= quality pick)) quality)
     :fits (mapv (fn [r] [(:id r) (:fit r)]) models)}))

;; ---------------------------------------------------------------------------
;; Device usage snapshot: awai.murakumo.device-usage.v1

(def kinds #{"android" "mac"})
;; "unknown": the copy another app reads has no live job state (Murakumo Models.usage forOtherApp).
(def load-states #{"idle" "busy" "loading" "unknown"})

(defn- nil-or [pred x] (or (nil? x) (pred x)))
(defn- percent? [x] (and (nat-n? x) (<= x 100)))

(defn usage-problems
  "Problems with one usage snapshot. Unknown values are nil and are not problems; a 0 is a measured
  zero. Used memory cannot exceed total, and free disk cannot exceed total disk."
  [u]
  (let [{:keys [ram disk loaded]} u]
    (cond-> []
      (not= "awai.murakumo.device-usage.v1" (:schema u)) (conj "usage/schema")
      (not (text? (:device u))) (conj "usage/device")
      (not (contains? kinds (:kind u))) (conj "usage/kind")
      (not (pos-n? (:observed-at-ms u))) (conj "usage/observed-at")
      (not (and (map? ram) (nil-or pos-n? (:total ram)) (nil-or nat-n? (:used ram)))) (conj "usage/ram")
      (and (map? ram) (pos-n? (:total ram)) (nat-n? (:used ram)) (> (:used ram) (:total ram))) (conj "usage/ram-used-above-total")
      (not (nil-or percent? (:cpu-percent u))) (conj "usage/cpu")
      (not (nil-or percent? (:gpu-percent u))) (conj "usage/gpu")
      (not (and (map? disk) (nil-or nat-n? (:free disk)) (nil-or pos-n? (:total disk)))) (conj "usage/disk")
      (and (map? disk) (nat-n? (:free disk)) (pos-n? (:total disk)) (> (:free disk) (:total disk))) (conj "usage/disk-free-above-total")
      (not (or (nil? loaded)
               (and (map? loaded) (text? (:model loaded)) (pos-n? (:context loaded))
                    (contains? load-states (:state loaded)) (pos-n? (:since-ms loaded)))))
      (conj "usage/loaded"))))

(defn freshness
  "fresh when observed within max-age-ms of now, stale when older, unknown when there is no
  observation or it claims to come from the future."
  [now-ms observed-at-ms max-age-ms]
  (cond
    (not (and (pos-n? now-ms) (pos-n? observed-at-ms) (pos-n? max-age-ms))) "unknown"
    (> observed-at-ms now-ms) "unknown"
    (<= (- now-ms observed-at-ms) max-age-ms) "fresh"
    :else "stale"))

(defn device-view
  "What the all-devices list shows for one device. A stale or invalid report shows its age and no
  values; nothing is invented. The recommendation comes from the reported RAM."
  [models usage now-ms max-age-ms context]
  (let [problems (usage-problems usage)
        state (if (seq problems) "invalid" (freshness now-ms (:observed-at-ms usage) max-age-ms))
        show? (= "fresh" state)
        ram (when show? (get-in usage [:ram :total]))
        rec (recommend models (:kind usage) ram context)]
    {:device (:device usage)
     :state state
     :age-ms (when (and (pos-n? now-ms) (pos-n? (:observed-at-ms usage)) (<= (:observed-at-ms usage) now-ms))
               (- now-ms (:observed-at-ms usage)))
     :problems problems
     :loaded (when show? (:loaded usage))
     :ram-used (when show? (get-in usage [:ram :used]))
     :ram-total ram
     :cpu-percent (when show? (:cpu-percent usage))
     :gpu-percent (when show? (:gpu-percent usage))
     :disk-free (when show? (get-in usage [:disk :free]))
     :recommended (:recommended rec)}))
