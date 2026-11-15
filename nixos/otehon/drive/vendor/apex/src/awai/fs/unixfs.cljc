(ns awai.fs.unixfs
  "UnixFS over dag-pb (ipld.io/docs/data-model/... and
  github.com/ipfs/specs UNIXFS): MerkleDAG protobuf framing
  (PBMerkleNode/PBLink), the UnixFS Data envelope, and balanced file
  DAG + directory builders over caller-hashed chunks.

  Wire scope is deliberately the subset Awai FS needs: varint fields
  (wire 0) and length-delimited fields (wire 2); fixed32/64 never
  occur and fail closed on decode. Tsize counts serialized DAG bytes,
  independently of logical file sizes used for range planning.
  This prototype subset is outside the admitted Pack profile. Full UnixFS
  interoperability and canonical owning-source migration remain unqualified.

  CIDs use the dag-pb codec (0x70, see awai.fs.car). Hashing stays
  with the caller: every builder takes `hash-fn` (byte-vec -> 32-byte
  digest vec), mirroring awai.fs.car/assemble-pack."
  (:refer-clojure :exclude [])
  (:require [awai.fs.car :as car]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(def ^:const default-fanout
  "Max links per intermediate file node (go-ipfs importer default)."
  174)

(def file-types
  "UnixFS Data Type enum."
  {:raw 0 :directory 1 :file 2 :metadata 3 :symlink 4 :hamt-shard 5})

;; Minimal protobuf: tag varints, wire 0 (varint) and wire 2 (bytes).

(defn- pb-field
  "Encode one field: `tag` varint then the value."
  [field-num wire value-bytes]
  (vec (concat (car/encode-uvarint (bit-or (bit-shift-left field-num 3) wire))
               value-bytes)))

(defn pb-varint-field
  "Length-delimited-free varint field."
  [field-num n]
  (pb-field field-num 0 (car/encode-uvarint n)))

(defn pb-bytes-field
  "Length-delimited field for `bytes` (byte-vec, possibly empty)."
  [field-num bytes]
  (let [v (vec bytes)]
    (pb-field field-num 2 (concat (car/encode-uvarint (count v)) v))))

(defn pb-decode-fields
  "Decode protobuf fields into [{:field :wire :int :bytes}]: :int for
  wire 0, :bytes (vec) for wire 2. Fails closed on truncation,
  fixed32/64, and groups."
  [bytes]
  (let [v (vec bytes)
        n (count v)]
    (loop [o 0 out []]
      (if (>= o n)
        out
        (let [[tag no] (car/decode-uvarint v o)
              field (bit-shift-right tag 3)
              wire (bit-and tag 0x07)]
          (cond
            (= wire 0)
            (let [[i nn] (car/decode-uvarint v no)]
              (recur nn (conj out {:field field :wire wire :int i})))

            (= wire 2)
            (let [[len lo] (car/decode-uvarint v no)
                  end (+ lo len)]
              (when (or (neg? len) (> end n))
                (fail! :awai.fs/bad-protobuf "awai fs: bad length-delimited field"
                       {:offset o}))
              (recur end (conj out {:field field :wire wire
                                    :bytes (subvec v lo end)})))

            :else
            (fail! :awai.fs/bad-protobuf "awai fs: unsupported wire type"
                   {:wire wire :offset o})))))))

;; dag-pb: PBLink{Hash=1,Name=2,Tsize=3}, PBNode{Data=1,Links=2}.

(defn pb-link-encode
  "Encode `{:hash cid-bytes :name string :tsize uint}`."
  [{:keys [hash name tsize]}]
  (when (or (empty? hash) (not (string? name)) (not (and (integer? tsize) (<= 0 tsize 9007199254740991))))
    (fail! :awai.fs/bad-link "awai fs: link needs hash, name and tsize" {}))
  (vec (concat (pb-bytes-field 1 hash)
               (pb-bytes-field 2 (car/utf8-encode name))
               (pb-varint-field 3 tsize))))

(defn pb-link-decode
  "Decode one PBLink into {:hash :name :tsize}."
  [bytes]
  (let [fs (pb-decode-fields bytes)
        one (fn [f] (some #(when (= f (:field %)) %) fs))
        h (one 1) nm (one 2) ts (one 3)]
    (when-not (and (= (count fs) (count (distinct (map :field fs))))
                   (every? #{1 2 3} (map :field fs))
                   (= (map :field fs) (sort (map :field fs))))
      (fail! :awai.fs/bad-link "duplicate, unknown or unordered link field" {}))
    (when (or (nil? h) (nil? ts) (not= 2 (:wire h)) (not= 0 (:wire ts)))
      (fail! :awai.fs/bad-link "awai fs: PBLink needs Hash(1) and Tsize(3)" {}))
    (when (and (some? nm) (not= 2 (:wire nm)))
      (fail! :awai.fs/bad-link "awai fs: PBLink Name(2) must be bytes" {}))
    {:hash (:bytes h)
     :name (if (nil? nm) "" (car/utf8-decode (:bytes nm)))
     :tsize (:int ts)}))

(defn pb-node-encode
  "Encode `{:data bytes-or-nil :links [link-maps]}`."
  [{:keys [data links]}]
  (vec (concat (if (some? data) (pb-bytes-field 1 data) [])
               (mapcat (fn [l] (pb-bytes-field 2 (pb-link-encode l)))
                       (or links [])))))

(defn pb-node-decode
  "Decode one PBMerkleNode into {:data bytes-or-nil :links [maps]}."
  [bytes]
  (let [fs (pb-decode-fields bytes)
        ds (filterv #(and (= 1 (:field %)) (= 2 (:wire %))) fs)
        ls (filterv #(and (= 2 (:field %)) (= 2 (:wire %))) fs)]
    (when-not (every? #(and (#{1 2} (:field %)) (= 2 (:wire %))) fs)
      (fail! :awai.fs/bad-pbnode "unknown node field or wire type" {}))
    (when (> (count ds) 1)
      (fail! :awai.fs/bad-pbnode "awai fs: PBNode has two Data fields" {}))
    {:data (when (seq ds) (:bytes (first ds)))
     :links (mapv pb-link-decode (mapv :bytes ls))}))

;; UnixFS Data envelope: Type=1, Data=2, filesize=3, blocksizes=4.

(defn data-encode
  "Encode `{:type keyword :data bytes-or-nil :filesize uint-or-nil
  :blocksizes [uint]}`."
  [{:keys [type data filesize blocksizes]}]
  (let [t (get file-types type ::missing)]
    (when (= t ::missing)
      (fail! :awai.fs/bad-unixfs-type "awai fs: unknown unixfs type" {:type type}))
    (vec (concat (pb-varint-field 1 t)
                 (if (some? data) (pb-bytes-field 2 data) [])
                 (if (some? filesize) (pb-varint-field 3 filesize) [])
                 (mapcat (fn [b] (pb-varint-field 4 b)) (or blocksizes []))))))

(defn data-decode
  "Decode a UnixFS Data envelope into {:type :data :filesize
  :blocksizes}. Unknown trailing fields are ignored (protobuf
  forward-compatibility); unknown type codes fail closed."
  [bytes]
  (let [fs (pb-decode-fields bytes)
        one (fn [f w] (some #(when (and (= f (:field %)) (= w (:wire %))) %) fs))
        t (one 1 0) d (one 2 2) sz (one 3 0)
        sizes (mapv :int (filterv #(and (= 4 (:field %)) (= 0 (:wire %))) fs))]
    (when (nil? t)
      (fail! :awai.fs/bad-unixfs-data "awai fs: Data needs Type(1)" {}))
    (let [kw (some (fn [[k v]] (when (= v (:int t)) k)) file-types)]
      (when (nil? kw)
        (fail! :awai.fs/bad-unixfs-type "awai fs: unknown unixfs type code"
               {:code (:int t)}))
      {:type kw
       :data (when (some? d) (:bytes d))
       :filesize (when (some? sz) (:int sz))
       :blocksizes sizes})))

;; Builders: chunks in, balanced DAG out.

(defn- node-cid
  "dag-pb CID for block `bytes`."
  [hash-fn bytes]
  (car/cid-bytes car/codec-dag-pb (hash-fn bytes)))

(defn- leaf-node
  "File leaf block for one `chunk` (byte-vec)."
  [hash-fn chunk]
  (let [data (data-encode {:type :file :data chunk :filesize (count chunk)})
        node (pb-node-encode {:data data})]
    {:cid (node-cid hash-fn node) :bytes node :size (count chunk) :dag-size (count node)}))

(defn- parent-node
  "Intermediate file node over `kids` [{:cid :size}]: links named \"\"
  with cumulative Tsizes, blocksizes per kid."
  [hash-fn kids]
  (let [total (reduce + 0 (map :size kids))
        data (data-encode {:type :file :filesize total
                           :blocksizes (mapv :size kids)})
        links (mapv (fn [{:keys [cid dag-size]}]
                      {:hash cid :name "" :tsize dag-size})
                    kids)
        node (pb-node-encode {:data data :links links})]
    {:cid (node-cid hash-fn node) :bytes node :size total :dag-size (+ (count node) (reduce + 0 (map :dag-size kids)))}))

(defn build-file-dag
  "Balanced UnixFS file DAG over `chunks` (byte-vec seq, one chunk per
  leaf). Groups leaves `fanout` wide (default 174) into intermediate
  nodes until one root remains. Returns {:root-cid :nodes [{:cid
  :bytes}] :size} with nodes post-order (leaves first, root last).
  Empty chunks fail closed."
  ([chunks hash-fn] (build-file-dag chunks hash-fn default-fanout))
  ([chunks hash-fn fanout]
   (when (or (empty? chunks) (not (and (integer? fanout) (<= 2 fanout 1024))))
     (fail! :awai.fs/bad-file-dag "awai fs: file needs chunks and fanout" {}))
   (loop [level (mapv (fn [c] (leaf-node hash-fn (vec c))) chunks)
          nodes []]
     (let [nodes (into nodes (mapv #(select-keys % [:cid :bytes]) level))]
       (if (= 1 (count level))
         {:root-cid (:cid (first level))
          :nodes nodes
          :dag-size (:dag-size (first level))
          :size (:size (first level))}
         (recur (mapv (fn [g] (parent-node hash-fn g))
                      (partition-all fanout level))
                nodes))))))

(defn build-dir
  "Flat UnixFS directory over `entries` [{:name :cid :size}].
  Returns {:root-cid :bytes}."
  [entries hash-fn]
  (doseq [{:keys [name cid size]} entries]
    (when (or (not (string? name)) (empty? cid) (not (and (integer? size) (<= 0 size 9007199254740991))))
      (fail! :awai.fs/bad-dir-entry "awai fs: dir entry needs name/cid/size" {})))
  (when-not (= (count entries) (count (distinct (map :name entries))))
    (fail! :awai.fs/bad-dir-entry "duplicate directory names" {}))
  (let [entries (sort (fn [a b]
                        (loop [x (seq (car/utf8-encode (:name a))) y (seq (car/utf8-encode (:name b)))]
                          (cond (nil? x) (if (nil? y) 0 -1) (nil? y) 1
                                (= (first x) (first y)) (recur (next x) (next y))
                                :else (compare (first x) (first y))))) entries)
        data (data-encode {:type :directory})
        links (mapv (fn [{:keys [name cid size]}]
                      {:hash cid :name name :tsize size})
                    entries)
        node (pb-node-encode {:data data :links links})]
    {:root-cid (node-cid hash-fn node) :bytes node}))

(defn locate-range
  "Map file [offset, offset+length) onto ordered `leaves` [{:cid
  :length}] (file order). Returns [{:cid :offset :length}] with
  per-leaf offsets, covering exactly the in-range bytes. Empty when
  out of range (mirrors awai.fs.car/car-range-segments over CIDs)."
  [leaves offset length]
  (let [end (+ offset length)]
    (if (<= length 0)
      []
      (loop [ls leaves pos 0 out []]
        (if (or (empty? ls) (>= pos end))
          out
          (let [{cid :cid ll :length} (first ls)
                lend (+ pos ll)]
            (recur (rest ls) lend
                   (if (and (< pos end) (> lend offset))
                     (let [s (max pos offset)
                           e (min lend end)]
                       (conj out {:cid cid :offset (- s pos) :length (- e s)}))
                     out))))))))
