(ns awai.fs.reliability
  "Display facts from one public-fixture audit. Never infer production durability,
  authority, availability, RPO or RTO from a test count or a successful copy."
  )

(def schema "awai.fs-reliability-evidence.v1")
(defn- sha? [v] (and (string? v) (boolean (re-matches #"[a-f0-9]{64}" v))))
(defn timestamp-ms [v]
  (when (string? v)
    #?(:clj (try (.toEpochMilli (java.time.Instant/parse v)) (catch Exception _ nil))
       :cljs (let [n (js/Date.parse v)] (when (js/Number.isFinite n) n)))))

(defn- valid? [e]
  (let [nodes (:expectedNodes e) data (:dataset e) seen (map :node (:observations e))]
    (and (= schema (:schema e)) (= "public-fixture-host-storage" (:scope e))
         (vector? nodes) (<= 1 (count nodes) 64) (= (count nodes) (count (distinct nodes)))
         (every? #(and (string? %) (re-matches #"[A-Za-z][A-Za-z0-9-]{0,62}" %)) nodes)
         (string? (:rootCid data)) (re-matches #"bafy[a-z2-7]+" (:rootCid data))
         (sha? (:carSha data)) (sha? (:payloadSha data))
         (integer? (:bytes data)) (<= 1 (:bytes data) 921600)
         (vector? (:observations e)) (= (count seen) (count (distinct seen)))
         (every? (set nodes) seen) (timestamp-ms (:observedAt e)))))

(defn- node-state [data row]
  (cond
    (nil? row) "unknown"
    (not= "read" (:status row)) "unknown"
    (and (= false (:degraded row))
         (= (:rootCid data) (:rootCid row)) (= (:carSha data) (:carSha row))
         (= (:payloadSha data) (:payloadSha row)) (= (:bytes data) (:bytes row))) "verified"
    :else "mismatch"))

(defn- trial [id label value at now-ms]
  (let [t (timestamp-ms at) measured? (and t (<= t now-ms) (boolean? value))]
    {:id id :label label :value (when measured? (if value 1 0))
     :total (when measured? 1) :unit "回" :scope "過去の公開データ試験"
     :observed-at at}))

(defn summary [e now-ms]
  (if-not (valid? e)
    {:valid? false :error "invalid-evidence"}
    (let [at (timestamp-ms (:observedAt e)) future? (> at now-ms)
          by-node (into {} (map (juxt :node identity) (:observations e)))
          rows (mapv (fn [n] {:node n :state (if future? "unknown" (node-state (:dataset e) (by-node n)))})
                     (:expectedNodes e))
          verified (count (filter #(= "verified" (:state %)) rows))
          unknown (count (filter #(= "unknown" (:state %)) rows))
          mismatched (count (filter #(= "mismatch" (:state %)) rows))
          history (:historicalTests e)]
      {:valid? true :scope "公開テストデータ・ホスト上のストレージコア"
       :verdict (if (pos? mismatched) "試験データに不一致" "本番信頼性は未判定")
       :observed-at (:observedAt e) :age-seconds (when-not future? (quot (- now-ms at) 1000))
       :freshness (if future? "clock-inconsistent" "snapshot-not-continuous-monitoring")
       :nodes rows :dataset (:dataset e)
       :metrics [(assoc {:id "copies" :label "読取り確認済みコピー" :total (count rows) :unit "台"
                        :scope "この公開データの観測時点" :observed-at (:observedAt e)}
                       :value (when-not (or future? (= unknown (count rows))) verified)
                       :unknown unknown :mismatched mismatched)
                 (trial "corruption" "破損検出の試験実績" (:corruptCloneRefused history) (:observedAt history) now-ms)
                 (trial "restore" "退避コピーからの復元試験" (:stagedArchiveRestore history) (:observedAt history) now-ms)]
       ;; These fields cannot be supplied by this public-fixture schema.
       :production {:availability-percent nil :durability-percent nil :rpo-seconds nil :rto-seconds nil
                    :sync-lag-seconds nil :failure-tolerance-nodes nil :target-copies nil}
       :notice "コピー確認と試験成功は、本番の信頼性や稼働率の百分率ではありません。"})))
