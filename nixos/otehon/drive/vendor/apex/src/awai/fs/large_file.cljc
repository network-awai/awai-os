(ns awai.fs.large-file
  "Large-file layout planning for Awai FS: fixed-size chunking, sealed-pack
  grouping, file manifests, and range-scan planning over CARv2-style packs.

  Pure data in, pure data out. No bytes are allocated here and no network is
  touched: callers hash, encrypt, store, and fetch; this namespace only
  decides where every byte lives and which ranges a read needs.

  Limits are parameters, not constants. There is no 4 MiB ceiling anywhere:
  :leaf-size, :pack-target, and :transfer-target are caller-chosen. The
  defaults (1 MiB leaves, 128 MiB packs, 32 MiB fetches) come from the
  awai-fs sizing survey on the parent issue."
  (:refer-clojure :exclude []))

(def ^:const default-leaf-size
  "Default leaf chunk: 1 MiB. Matches the IPFS unixfs-v1-2025 profile."
  1048576)

(def ^:const compat-leaf-size
  "Interop leaf chunk: 256 KiB. Same CIDs as `ipfs add` defaults."
  262144)

(def ^:const default-pack-target
  "Default sealed-pack target: 128 MiB of leaf bytes per pack."
  (* 128 1024 1024))

(def ^:const default-transfer-target
  "Default fetch-group ceiling: 32 MiB per contiguous range read."
  (* 32 1024 1024))

(def ^:const index-bytes-per-entry
  "Measured CARv2 MultihashIndexSorted cost: about 40 bytes per entry."
  40)

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn- check-size!
  [n what type]
  (when (or (not (integer? n)) (neg? n))
    (fail! type (str "awai fs: " what " must be a non-negative integer")
           {what n})))

(defn- check-positive!
  [n what type]
  (when (or (not (integer? n)) (<= n 0))
    (fail! type (str "awai fs: " what " must be a positive integer")
           {what n})))

(defn chunk-plan
  "Split a file of `total-size` bytes into fixed-size leaf chunks.

  Returns {:file-size :leaf-size :chunk-count :chunks}, where each chunk is
  {:index :offset :length}. The last chunk carries the remainder. An empty
  file yields zero chunks. Refuses negative sizes and non-positive leaves
  instead of guessing."
  ([total-size]
   (chunk-plan total-size nil))
  ([total-size {:keys [leaf-size] :or {leaf-size default-leaf-size}}]
   (check-size! total-size "total-size" :awai.fs/negative-size)
   (check-positive! leaf-size "leaf-size" :awai.fs/invalid-leaf-size)
   (let [full (quot total-size leaf-size)
         rest-bytes (rem total-size leaf-size)
         full-chunks (mapv (fn [i]
                             {:index i
                              :offset (* i leaf-size)
                              :length leaf-size})
                           (range full))
         chunks (if (pos? rest-bytes)
                  (conj full-chunks {:index full
                                     :offset (* full leaf-size)
                                     :length rest-bytes})
                  full-chunks)]
     {:file-size total-size
      :leaf-size leaf-size
      :chunk-count (count chunks)
      :chunks chunks})))

(defn pack-plan
  "Group `chunks` (each with :offset and :length) into sealed packs whose
  leaf bytes stay at or under :pack-target.

  Returns {:pack-target :pack-count :packs}, where each pack is
  {:pack-index :bytes :entries} and each entry keeps its chunk keys plus
  :pack and :pack-offset. A chunk larger than the target rides alone and is
  marked :oversized — reported, never silently split."
  ([chunks]
   (pack-plan chunks nil))
  ([chunks {:keys [pack-target] :or {pack-target default-pack-target}}]
   (check-positive! pack-target "pack-target" :awai.fs/invalid-pack-target)
   (let [ordered (vec (sort-by :offset chunks))]
     (doseq [c ordered]
       (check-size! (:offset c) "chunk offset" :awai.fs/invalid-chunk)
       (check-size! (:length c) "chunk length" :awai.fs/invalid-chunk))
     (loop [remaining ordered
            pack-index 0
            pack-offset 0
            bytes 0
            entries []
            packs []]
       (if (empty? remaining)
         (let [packs (if (seq entries)
                       (conj packs {:pack-index pack-index
                                    :bytes bytes
                                    :entries entries})
                       packs)]
           {:pack-target pack-target
            :pack-count (count packs)
            :packs packs})
         (let [c (first remaining)
               len (:length c)]
           (if (and (seq entries) (> (+ bytes len) pack-target))
             (recur remaining (inc pack-index) 0 0 []
                    (conj packs {:pack-index pack-index
                                 :bytes bytes
                                 :entries entries}))
             (recur (rest remaining) pack-index (+ pack-offset len) (+ bytes len)
                    (conj entries (assoc c
                                         :pack pack-index
                                         :pack-offset pack-offset
                                         :oversized (> len pack-target)))
                    packs))))))))

(defn file-manifest
  "Join a `chunk-plan` result with its `pack-plan` result into one file
  manifest: {:file-size :leaf-size :pack-target :chunk-count :pack-count
  :entries}. Each entry is {:index :offset :length :pack :pack-offset
  :oversized} — :offset is file-absolute, :pack-offset is pack-absolute,
  :oversized marks a lone chunk larger than the pack target. :packs keeps the
  per-pack grouping the entries were placed into. The manifest is the
  POSIX/query lookup structure; packs never move under it."
  [chunk-result pack-result]
  (let [entries (into []
                      (comp (mapcat :entries)
                            (map #(select-keys % [:index :offset :length
                                                  :pack :pack-offset
                                                  :oversized])))
                      (:packs pack-result))]
    {:file-size (:file-size chunk-result)
     :leaf-size (:leaf-size chunk-result)
     :pack-target (:pack-target pack-result)
     :chunk-count (:chunk-count chunk-result)
     :pack-count (:pack-count pack-result)
     :packs (:packs pack-result)
     :entries entries}))

(defn layout-plan
  "One call for the common path: chunk, pack, and manifest together.
  Options are :leaf-size and :pack-target."
  ([total-size]
   (layout-plan total-size nil))
  ([total-size opts]
   (let [chunk-result (chunk-plan total-size opts)
         pack-result (pack-plan (:chunks chunk-result) opts)]
     (file-manifest chunk-result pack-result))))

(defn range-chunks
  "Entries of `manifest` overlapped by the file byte range
  [offset, offset+length). Each result keeps its entry keys plus
  :read-offset and :read-length — the intersection in file space.

  Reads past the end are refused, never shortened: a truncated read that
  reports success is the one outcome ruled out. Zero-length reads return []."
  [manifest offset length]
  (let [file-size (:file-size manifest)]
    (check-size! file-size "file-size" :awai.fs/invalid-manifest)
    (check-size! offset "offset" :awai.fs/negative-offset)
    (check-size! length "length" :awai.fs/negative-length)
    (let [end (+ offset length)]
      (when (> offset file-size)
        (fail! :awai.fs/range-past-end "awai fs: read starts past the end"
               {:offset offset :file-size file-size}))
      (when (> end file-size)
        (fail! :awai.fs/range-past-end "awai fs: read extends past the end"
               {:offset offset :length length :file-size file-size}))
      (if (zero? length)
        []
        (into []
              (comp (filter (fn [e]
                              (and (< (:offset e) end)
                                   (> (+ (:offset e) (:length e)) offset))))
                    (map (fn [e]
                           (let [read-offset (max offset (:offset e))
                                 read-end (min end (+ (:offset e) (:length e)))]
                             (assoc e
                                    :read-offset read-offset
                                    :read-length (- read-end read-offset))))))
              (:entries manifest))))))

(defn coalesce-fetches
  "Merge `entries` (with :pack, :pack-offset, :length) into contiguous
  per-pack fetch groups capped at :transfer-target bytes.

  Returns [{:pack :pack-offset :length :chunks}]. Groups never cross packs
  and never exceed the target: a surviving group is one range read."
  ([entries]
   (coalesce-fetches entries nil))
  ([entries {:keys [transfer-target] :or {transfer-target default-transfer-target}}]
   (check-positive! transfer-target "transfer-target"
                    :awai.fs/invalid-transfer-target)
   (let [ordered (sort-by (juxt :pack :pack-offset) entries)]
     (loop [remaining ordered
            groups []]
       (if (empty? remaining)
         groups
         (let [e (first remaining)
               last-group (peek groups)]
           (if (and last-group
                    (= (:pack last-group) (:pack e))
                    (= (+ (:pack-offset last-group) (:length last-group))
                       (:pack-offset e))
                    (<= (+ (:length last-group) (:length e)) transfer-target))
             (recur (rest remaining)
                    (conj (pop groups)
                          (-> last-group
                              (update :length + (:length e))
                              (update :chunks conj e))))
             (recur (rest remaining)
                    (conj groups {:pack (:pack e)
                                  :pack-offset (:pack-offset e)
                                  :length (:length e)
                                  :chunks [e]})))))))))

(defn offset-index
  "Hot-path lookup structure over manifest entries: sorted offset and entry
  vectors plus the file size. Build once from a manifest, reuse across reads.
  Lookup is a binary search plus a forward walk over overlapped entries —
  logarithmic in file size instead of linear."
  [manifest]
  (let [entries (vec (sort-by :offset (:entries manifest)))]
    {:file-size (:file-size manifest)
     :count (count entries)
     :offsets (mapv :offset entries)
     :entries entries}))

(defn- first-after
  "First index i with offsets[i] > x, or (count offsets) when none."
  [offsets x]
  (loop [lo 0 hi (count offsets)]
    (if (>= lo hi)
      lo
      (let [mid (quot (+ lo hi) 2)]
        (if (> (nth offsets mid) x)
          (recur lo mid)
          (recur (inc mid) hi))))))

(defn range-chunks-indexed
  "Same contract as `range-chunks` — overlapping entries with :read-offset
  and :read-length, past-the-end reads refused — over an `offset-index`.
  The result for the same inputs is identical; only the search differs."
  [index offset length]
  (let [file-size (:file-size index)
        entries (:entries index)
        offsets (:offsets index)]
    (check-size! file-size "file-size" :awai.fs/invalid-manifest)
    (check-size! offset "offset" :awai.fs/negative-offset)
    (check-size! length "length" :awai.fs/negative-length)
    (let [end (+ offset length)]
      (when (> offset file-size)
        (fail! :awai.fs/range-past-end "awai fs: read starts past the end"
               {:offset offset :file-size file-size}))
      (when (> end file-size)
        (fail! :awai.fs/range-past-end "awai fs: read extends past the end"
               {:offset offset :length length :file-size file-size}))
      (if (or (zero? length) (empty? entries))
        []
        (let [start (max 0 (dec (first-after offsets offset)))]
          (loop [j start
                 out []]
            (if (>= j (count entries))
              out
              (let [e (nth entries j)]
                (if (>= (:offset e) end)
                  out
                  (recur (inc j)
                         (if (and (< (:offset e) end)
                                  (> (+ (:offset e) (:length e)) offset))
                           (conj out
                                 (let [read-offset (max offset (:offset e))
                                       read-end (min end (+ (:offset e)
                                                            (:length e)))]
                                   (assoc e
                                          :read-offset read-offset
                                          :read-length (- read-end
                                                          read-offset))))
                           out)))))))))))

(defn range-header
  "An HTTP `Range` value for [`offset`, `offset`+`length`)."
  [offset length]
  (check-size! offset "offset" :awai.fs/negative-offset)
  (check-positive! length "length" :awai.fs/non-positive-length)
  (str "bytes=" offset "-" (+ offset length -1)))

(defn index-estimate
  "Pack-index cost for `chunk-count` entries at the measured per-entry rate."
  [chunk-count]
  (check-size! chunk-count "chunk-count" :awai.fs/negative-count)
  {:entries chunk-count
   :bytes-est (* chunk-count index-bytes-per-entry)})

(defn tree-levels
  "DAG depth for `chunk-count` leaves over `fanout` links per node.
  One chunk is a bare leaf (1 level). An empty file has no tree (0)."
  ([chunk-count]
   (tree-levels chunk-count 174))
  ([chunk-count fanout]
   (check-size! chunk-count "chunk-count" :awai.fs/negative-count)
   (when (or (not (integer? fanout)) (< fanout 2))
     (fail! :awai.fs/invalid-fanout "awai fs: fanout must be at least 2"
            {:fanout fanout}))
   (if (zero? chunk-count)
     {:fanout fanout :levels 0 :chunks chunk-count}
     (loop [n chunk-count
            levels 1]
       (if (<= n 1)
         {:fanout fanout :levels levels :chunks chunk-count}
         (recur (quot (+ n (dec fanout)) fanout) (inc levels)))))))
