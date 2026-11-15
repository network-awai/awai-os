(ns awai.fs.path
  "IPLD Paths (ipld.io/docs/data-model/path): parse `/a/b/0` into
  segments and resolve them across decoded nodes, loading through CID
  links (`{:tag 42 :bytes cid}` as produced by awai.fs.car/cbor-decode).

  Maps resolve string segments, sequential nodes resolve decimal
  index segments. Every step fails closed: missing keys, bad indexes,
  traversal into scalars or bytes, unresolvable links, and malformed
  path text all throw with the segment attached."
  (:refer-clojure :exclude [])
  (:require [clojure.string :as str]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn link?
  "True when `v` is a decoded CID link (`{:tag 42 :bytes cid}`)."
  [v]
  (and (map? v) (= 42 (:tag v)) (some? (:bytes v))))

(defn parse-path
  "Parse path text `\"a/b/0\"` or `\"/a/b/0\"` into `[\"a\" \"b\" \"0\"]`.
  Fails closed on blank text, empty segments, and `.` / `..`."
  [s]
  (when (or (not (string? s)) (str/blank? s))
    (fail! :awai.fs/bad-path "awai fs: path must be non-blank text" {:path s}))
  (let [t (if (str/starts-with? s "/") (subs s 1) s)
        segs (str/split t #"/" -1)]
    (when (or (empty? segs) (some str/blank? segs))
      (fail! :awai.fs/bad-path "awai fs: path has empty segments" {:path s}))
    (when (some #{".." "."} segs)
      (fail! :awai.fs/bad-path "awai fs: path cannot climb" {:path s}))
    (vec segs)))

(defn join-path
  "Render `segments` back to `/a/b` text."
  [segments]
  (str "/" (str/join "/" segments)))

(defn- step
  "Resolve one `segment` against `node`. `[node kind]` where kind is
  :value, or throws."
  [node segment]
  (cond
    (link? node)
    (fail! :awai.fs/link-not-loaded "awai fs: path crosses an unloaded link"
           {:segment segment})

    (map? node)
    (if (contains? node segment)
      (get node segment)
      (fail! :awai.fs/no-such-field "awai fs: map has no such field"
             {:segment segment}))

    (sequential? node)
    (let [n (count node)]
      (if-not (and (<= (count segment) 9) (re-matches #"0|[1-9][0-9]*" segment))
        (fail! :awai.fs/bad-index "awai fs: list needs a decimal index"
               {:segment segment})
        (let [i #?(:clj (Integer/parseInt segment)
                   :cljs (js/parseInt segment 10))]
          (if (or (neg? i) (>= i n))
            (fail! :awai.fs/index-out-of-range "awai fs: list index out of range"
                   {:segment segment :size n})
            (nth node i)))))

    :else
    (fail! :awai.fs/not-traversable "awai fs: cannot traverse into scalar"
           {:segment segment})))

(defn resolve-path
  "Resolve `segments` (or path text) from `root`. `load-fn` maps link
  `{:tag 42 :bytes cid}` byte-vecs to decoded nodes (nil when absent).
  Links resolve transparently; the walk returns the final node.
  Throws on the first unresolvable step."
  [root path-or-text load-fn]
  (let [segments (if (string? path-or-text)
                   (parse-path path-or-text)
                   (vec path-or-text))]
    (loop [node root segs segments]
      (if (empty? segs)
        node
        (let [nxt (if (link? node)
                    (let [loaded (load-fn (:bytes node))]
                      (when (nil? loaded)
                        (fail! :awai.fs/link-not-loaded
                               "awai fs: linked block is absent"
                               {:segment (first segs)}))
                      loaded)
                    node)]
          (recur (step nxt (first segs)) (rest segs)))))))
