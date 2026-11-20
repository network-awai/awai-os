(ns awai.fs.wal
  "Single-node write-ahead journal with superblock A/B root publication
  (AWAI-236, AWAI-532 scope).

  Pure planning only: no bytes, no fsync, no file handles. The journal is
  an ordered frame vector with a checkpoint marker; truncation drops only
  frames at or below the checkpoint. The superblock holds two root slots;
  `publish-root` commits to the inactive slot and `active-root` reads the
  newest committed one, so a torn write (staged but never committed) can
  never become the active root. Durable I/O, barriers, and the node
  adapter stay out of this namespace."
  )

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn empty-log
  "Journal with no frames and no checkpoint."
  []
  {:seq 0 :frames [] :checkpoint 0})

(defn append
  "Append one frame {:seq :op :payload} with the next monotonic seq.
  Refuses non-keyword ops."
  [log op payload]
  (when-not (keyword? op)
    (fail! :awai.fs/invalid-op "awai fs: journal op must be a keyword" {:op op}))
  (let [n (inc (:seq log))]
    (-> log
        (assoc :seq n)
        (update :frames conj {:seq n :op op :payload payload}))))

(defn checkpoint
  "Mark the current tail as the snapshot point. Later frames replay after
  it; `truncate` may only drop frames at or below it."
  [log]
  (assoc log :checkpoint (:seq log)))

(defn truncate
  "Drop frames at or below the checkpoint. Refuses when no checkpoint was
  taken — a silent no-op would hide a recovery bug."
  [log]
  (let [cp (:checkpoint log)]
    (when (zero? cp)
      (fail! :awai.fs/nothing-to-truncate "awai fs: no checkpoint to truncate at" {}))
    (update log :frames (fn [frames] (into [] (filter #(> (:seq %) cp)) frames)))))

(defn replay
  "Fold every frame in seq order with (apply-fn state frame). Returns the
  final state; the journal itself is unchanged."
  [log apply-fn init]
  (reduce apply-fn init (:frames log)))

(defn empty-superblock
  "Two empty root slots, neither committed."
  []
  {:slots [nil nil] :seq 0})

(defn- inactive-index
  "Index of the slot that does not hold the newest committed root."
  [slots]
  (let [committed (keep-indexed (fn [i s] (when (:committed s) [(:seq s) i])) slots)]
    (if (empty? committed)
      0
      (let [newest (apply max-key first committed)]
        (if (= (second newest) 0) 1 0)))))

(defn stage-root
  "Write a root to the inactive slot without committing it. Models a torn
  write: present in the slot, invisible to `active-root`."
  [sb root seq]
  (when (<= seq (:seq sb))
    (fail! :awai.fs/bad-seq "awai fs: root seq must move forward" {:seq seq}))
  (-> sb
      (assoc :seq seq)
      (assoc-in [:slots (inactive-index (:slots sb))] {:seq seq :root root})))

(defn publish-root
  "Atomically publish `root`: stage to the inactive slot and commit it, so
  the next `active-root` reads exactly this slot."
  [sb root seq]
  (let [staged (stage-root sb root seq)]
    (assoc-in staged [:slots (inactive-index (:slots sb))] {:seq seq :root root
                                                            :committed true})))

(defn active-root
  "Newest committed {:seq :root}. Ignores torn slots; fails when nothing
  was ever committed instead of inventing a default root."
  [sb]
  (let [best (last (sort-by :seq (filter :committed (:slots sb))))]
    (if best
      (select-keys best [:seq :root])
      (fail! :awai.fs/no-committed-root "awai fs: no committed root in superblock" {}))))

(defn- sequence-number?
  [n]
  ;; Keep the same exact integer range on JVM and JavaScript hosts.
  (and (integer? n) (<= 0 n 9007199254740991)))

(defn recover
  "Restore a snapshot and replay only the committed post-checkpoint prefix.

  The selected superblock root must contain {:checkpoint n :tail m}; the
  separately loaded snapshot is {:seq n :state value}. The log checkpoint
  must also be n. Retained pre-checkpoint frames are allowed, as is an
  uncommitted suffix after m. Frames n+1 through m must all be present once,
  in order. All structural checks finish before apply-fn can run.

  This is a pure recovery plan, not I/O or a durability/identity verifier.
  The caller must authenticate the snapshot/root/frames and enforce durable
  write ordering before exposing them here. The superblock publication seq
  is independent of the WAL sequence."
  [log sb snapshot apply-fn]
  (when-not (and (map? sb) (sequence-number? (:seq sb))
                 (vector? (:slots sb)) (= 2 (count (:slots sb)))
                 (every? (fn [slot]
                           (or (nil? slot)
                               (and (map? slot)
                                    (sequence-number? (:seq slot))
                                    (pos? (:seq slot))
                                    (<= (:seq slot) (:seq sb))
                                    (contains? slot :root)
                                    (contains? #{nil false true} (:committed slot)))))
                         (:slots sb))
                 (let [seqs (map :seq (remove nil? (:slots sb)))]
                   (= (count seqs) (count (distinct seqs)))))
    (fail! :awai.fs/invalid-superblock "awai fs: malformed recovery superblock" {}))
  (let [{:keys [root]} (active-root sb)
        cp (:checkpoint root)
        tail (:tail root)]
    (when-not (and (map? root) (sequence-number? cp)
                   (sequence-number? tail) (<= cp tail))
      (fail! :awai.fs/invalid-recovery-root "awai fs: invalid checkpoint/tail" {}))
    (when-not (and (map? snapshot) (sequence-number? (:seq snapshot))
                   (= cp (:seq snapshot)) (contains? snapshot :state))
      (fail! :awai.fs/snapshot-mismatch "awai fs: snapshot does not match checkpoint" {}))
    (when-not (and (map? log) (sequence-number? (:seq log))
                   (sequence-number? (:checkpoint log))
                   (= cp (:checkpoint log)) (<= tail (:seq log))
                   (vector? (:frames log))
                   (every? (fn [frame]
                             (and (map? frame) (sequence-number? (:seq frame))
                                  (pos? (:seq frame)) (<= (:seq frame) (:seq log))
                                  (keyword? (:op frame)) (contains? frame :payload)))
                           (:frames log))
                   (every? true? (map (fn [a b] (< (:seq a) (:seq b)))
                                      (:frames log) (rest (:frames log)))))
      (fail! :awai.fs/invalid-recovery-log "awai fs: malformed or unordered recovery log" {}))
    (let [frames (filterv #(<= (inc cp) (:seq %) tail) (:frames log))]
      ;; Do not allocate a range based on an untrusted declared tail.
      (when-not (and (= (- tail cp) (count frames))
                     (every? true? (map-indexed (fn [i frame]
                                                 (= (+ cp 1 i) (:seq frame)))
                                               frames)))
        (fail! :awai.fs/missing-recovery-frame "awai fs: committed WAL prefix is incomplete" {}))
      (reduce apply-fn (:state snapshot) frames))))
