(ns awai.fs.schema
  "IPLD Schema validation subset (ipld.io/docs/schemas/): kind system,
  structs, keyed unions, enums, lists, maps, links, and named-type
  registries — enough to pin Awai FS shapes (pack roots, manifests,
  UnixFS envelopes) in one place.

  Schema shape (edn):
  - {:kind :bool|:int|:float|:string|:bytes|:link|:any}
  - {:kind :list :value T}
  - {:kind :map :key T :value T}
  - {:kind :struct :fields {name T} :open? bool}
  - {:kind :enum :values [...]}
  - {:kind :union :branches {key T}}            (keyed representation)
  - {:kind :optional :type T}                  (nil passes)
  - {:ref name} with registry {:types {name T} :root T-or-ref}

  `validate` returns the value on success and throws with
  {:path [...] :expected ...} on the first mismatch. Out of scope:
  inline/kind unions, value restrictions (int ranges, string regexps),
  struct representations other than maps."
  (:refer-clojure :exclude [])
  (:require [awai.fs.path :as ipath]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn- mismatch
  [path expected value]
  (throw (ex-info "awai fs: schema mismatch"
                  {:type :awai.fs/schema-mismatch
                   :path path :expected expected :value value})))

(declare check)
(def ^:dynamic *budget* nil)

(defn- check-seq
  [types t vs path kinds]
  (if (not (sequential? vs))
    (mismatch path kinds vs)
    (do (doall (map-indexed (fn [i v] (check types (:value t) v (conj path i))) vs))
        vs)))

(defn- check
  "Validate `v` against type `t` (refs resolved via `types`). Returns
  `v` or throws."
  [types t v path]
  (when (and *budget* (or (> (count path) 64) (neg? (swap! *budget* dec))))
    (fail! :awai.fs/schema-limit "schema evaluation exceeds bounded local scope" {}))
  (let [t (if (and (map? t) (contains? t :ref))
            (let [r (get types (:ref t))]
              (if (nil? r)
                (fail! :awai.fs/unknown-type "awai fs: unknown type ref"
                       {:ref (:ref t)})
                r))
            t)
        k (if (map? t) (:kind t) ::invalid)]
    (case k
      :any v
      :bool (if (boolean? v) v (mismatch path :bool v))
      :int (if (integer? v) v (mismatch path :int v))
      :float (if (number? v) v (mismatch path :float v))
      :string (if (string? v) v (mismatch path :string v))
      :bytes (if (and (sequential? v)
                      (every? #(and (integer? %) (<= 0 % 255)) v))
               v (mismatch path :bytes v))
      :link (if (ipath/link? v) v (mismatch path :link v))
      :list (check-seq types t v path :list)
      :map (if (not (map? v))
             (mismatch path :map v)
             (do (doseq [[mk mv] v]
                   (check types (:key t) mk (conj path (str "key:" mk)))
                   (check types (:value t) mv (conj path mk)))
                 v))
      :struct (if (not (map? v))
                (mismatch path :struct v)
                (let [fields (or (:fields t) {})]
                  (when-not (:open? t)
                    (doseq [k (keys v)]
                      (when-not (contains? fields k)
                        (mismatch path [:unexpected-field k] v))))
                  (doseq [[fk ft] fields]
                    (if (contains? v fk)
                      (check types ft (get v fk) (conj path fk))
                      (mismatch path [:missing-field fk] v)))
                  v))
      :enum (if (boolean (some #(= % v) (:values t)))
              v (mismatch path [:enum (:values t)] v))
      :union (if (not (and (map? v) (= 1 (count v))))
               (mismatch path :union v)
               (let [[bk bv] (first v)
                     bt (get (:branches t) bk)]
                 (if (nil? bt)
                   (mismatch path [:unknown-branch bk] v)
                   (do (check types bt bv (conj path bk)) v))))
      :optional (if (nil? v) v (check types (:type t) v path))
      (mismatch path [:unknown-kind k] v))))

(defn validate
  "Validate `value` against `schema` ({:types {...} :root type} or a
  bare type). Returns the value; throws path-tagged mismatch."
  [schema value]
  (let [{types :types root :root} (if (and (map? schema)
                                           (or (contains? schema :types)
                                               (contains? schema :root)))
                                    schema
                                    {:types {} :root schema})]
    (binding [*budget* (atom 4096)] (check (or types {}) (or root schema) value []))))
