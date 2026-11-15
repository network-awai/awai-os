(ns awai.fs.query-plan
  "P3 query plans over file metadata (AWAI-236).

  A projection binds file names to indexed manifests built with
  large_file planning: layout-plan for chunk/pack placement, offset-index
  for logarithmic range lookup. plan-range answers a byte range with the
  overlapped chunks plus coalesced per-pack fetch groups; plan-pack answers
  one pack the same way. All inputs are validated and refused, never
  guessed: unknown files and packs fail here, range violations fail in
  large_file with their own reasons.

  Pure data in, pure data out. No bytes are allocated and no network is
  touched: callers hash, encrypt, store, and fetch; this namespace only
  decides which ranges a read needs."
  (:refer-clojure :exclude [])
  (:require [awai.fs.large-file :as lf]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn project
  "Build a projection from file specs, each {:name :file-size} with
  optional :leaf-size and :pack-target. Returns {name {:manifest :index}}."
  [files]
  (into {}
        (map (fn [{:keys [name file-size leaf-size pack-target]}]
               (when (or (not (string? name)) (empty? name))
                 (fail! :awai.fs.query/bad-spec "awai fs query: file needs a non-empty string name"
                        {:name name}))
               (let [opts (cond-> {}
                            leaf-size (assoc :leaf-size leaf-size)
                            pack-target (assoc :pack-target pack-target))
                     manifest (lf/layout-plan file-size opts)]
                 [name {:manifest manifest :index (lf/offset-index manifest)}])))
        files))

(defn- lookup
  [projection fname]
  (let [entry (get projection fname)]
    (when-not entry
      (fail! :awai.fs.query/unknown-file "awai fs query: unknown file" {:file fname}))
    entry))

(defn plan-range
  "Plan a byte-range read [offset, offset+length) on file fname.
  Returns {:chunks [...] :groups [...]}; chunks carry :read-offset and
  :read-length, groups are coalesced per-pack fetch ranges."
  [projection fname offset length]
  (let [{:keys [index]} (lookup projection fname)
        chunks (lf/range-chunks-indexed index offset length)]
    {:chunks chunks :groups (lf/coalesce-fetches chunks)}))

(defn plan-pack
  "Plan a whole-pack fetch of pack-index on file fname.
  Returns {:chunks [...] :groups [...]} over that pack's entries."
  [projection fname pack-index]
  (let [{:keys [manifest]} (lookup projection fname)
        entries (filterv #(= pack-index (:pack %)) (:entries manifest))]
    (when (empty? entries)
      (fail! :awai.fs.query/unknown-pack "awai fs query: unknown pack"
             {:file fname :pack pack-index}))
    {:chunks entries :groups (lf/coalesce-fetches entries)}))
