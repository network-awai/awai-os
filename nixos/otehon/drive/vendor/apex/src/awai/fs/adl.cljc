(ns awai.fs.adl
  "IPLD Advanced Data Layouts (ipld.io/docs/advanced-data-layouts/):
  a registry of named reified computations over stored data. An ADL
  entry is {:name string :reify (fn [data loader] node)} where `data`
  is the decoded stored block and `loader` maps link CID byte-vecs to
  decoded nodes (or nil when the caller wants shape-only reification).

  The built-in \"awai-pack/v1\" ADL reifies a pack-root block
  ({\"leaves\" [link ...]}, as produced by awai.fs.car/assemble-pack)
  into {:cids [...] :count n} after schema validation, and reads byte
  ranges across the addressed leaves with `pack-at`. Loaders stay with
  the caller: this namespace never hashes, stores, or fetches."
  (:refer-clojure :exclude [])
  (:require [awai.fs.schema :as sch]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(def ^:private registry
  (atom {}))

(defn register!
  "Register ADL entry `{:name :reify}`. `:reify` is (fn [data loader]
  node). Returns the name."
  [{:keys [name reify] :as adl}]
  (when (or (not (string? name)) (empty? name) (not (fn? reify)))
    (fail! :awai.fs/bad-adl "awai fs: adl needs a name and reify fn" {}))
  (swap! registry assoc name (dissoc adl :name))
  name)

(defn lookup
  "ADL entry for `name`, or nil."
  [name]
  (get @registry name))

(defn registered
  "Sorted ADL names."
  []
  (sort (keys @registry)))

(defn reify-adl
  "Run ADL `name` over decoded `data` with `loader`. Fails closed on
  unknown names; loader errors propagate."
  [name data loader]
  (let [adl (lookup name)]
    (when (nil? adl)
      (fail! :awai.fs/unknown-adl "awai fs: unknown adl" {:name name}))
    ((:reify adl) data loader)))

(def pack-root-schema
  "Schema for awai-pack/v1 root data."
  {:kind :struct
   :fields {"leaves" {:kind :list :value {:kind :link}}}})

(defn pack-reify
  "Reify pack-root `data` into {:cids [...] :count n} after schema
  validation. `loader` is accepted for uniform arity and ignored."
  [data _loader]
  (let [v (sch/validate pack-root-schema data)]
    {:cids (mapv :bytes (get v "leaves")) :count (count (get v "leaves"))}))

(defn pack-at
  "Read [offset, offset+length) across `cids` (pack order), loading
  leaf byte-vecs through `loader`. Returns a byte-vec. Missing
  leaves and out-of-range reads fail closed."
  [loader cids offset length]
  (when (or (neg? offset) (neg? length))
    (fail! :awai.fs/bad-range "awai fs: pack-at needs non-negative range" {}))
  (let [bufs (mapv (fn [cid]
                     (let [b (loader cid)]
                       (when (nil? b)
                         (fail! :awai.fs/missing-leaf
                                "awai fs: pack leaf is absent" {}))
                       (vec b)))
                   cids)
        total (reduce + 0 (map count bufs))]
    (when (> (+ offset length) total)
      (fail! :awai.fs/range-out-of-bounds "awai fs: pack read past end"
             {:offset offset :length length :size total}))
    (loop [bs bufs pos 0 out [] need [offset (+ offset length)]]
      (let [[from to] need]
        (if (or (empty? bs) (>= pos to))
          (vec out)
          (let [b (first bs)
                lend (+ pos (count b))]
            (recur (rest bs) lend
                   (if (and (< pos to) (> lend from))
                     (into out (subvec b (max 0 (- from pos))
                                         (min (count b) (- to pos))))
                     out)
                   need)))))))

(register! {:name "awai-pack/v1" :reify pack-reify})
