(ns awai.fs.graphsync
  "Versioned local traversal reference envelope. This is not GraphSync wire
  framing or the IPLD selector representation. No sockets or peer guarantees.
  The namespace name is retained for prototype callers; network integration
  remains with AWAI-534 and the owning canonical protocol implementation."
  (:refer-clojure :exclude [])
  (:require [awai.fs.car :as car]
            [awai.fs.selector :as sel]
            [awai.fs.remote :as rm]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

;; Selector data-model conversion (local field names <-> keyword forms).

(defn selector->data
  "Keyword selector to local-AST-shaped data (string keys, cbor-safe)."
  [s]
  (sel/admit! s)
  (cond
    (:edge s) {"ExploreRecursiveEdge" {}}
    (:match s) {"Matcher" {}}
    (:all s) {"ExploreAll" {"Next" (selector->data (:all s))}}
    (:fields s) {"ExploreFields"
                 {"Fields" (into {} (map (fn [[k v]] [k (selector->data v)])
                                         (:fields s)))}}
    (contains? s :index) {"ExploreIndex" {"Index" (:index s)
                                          "Next" (selector->data (:next s))}}
    (:range s) {"ExploreRange" {"Start" (get-in s [:range :start] 0)
                                "End" (get-in s [:range :end])
                                "Next" (selector->data (:next s))}}
    (:union s) {"ExploreUnion" (mapv selector->data (:union s))}
    (:recursive s) {"ExploreRecursive"
                    {"Sequence" (selector->data (get-in s [:recursive :sequence]))
                     "Limit" (let [d (get-in s [:recursive :limit :depth])]
                               (if (integer? d) {"Depth" d} {"None" {}}))
                     "Next" (selector->data (get-in s [:recursive :next]))}}
    :else
    (fail! :awai.fs/bad-selector "awai fs: unknown selector" {:selector s})))

(declare data->selector)
(defn- data->selector*
  "Local-AST-shaped selector data back to the keyword form `select` runs."
  [d]
  (cond
    (contains? d "ExploreRecursiveEdge") {:edge true}
    (contains? d "Matcher") {:match true}
    (contains? d "ExploreAll") {:all (data->selector (get-in d ["ExploreAll" "Next"]))}
    (contains? d "ExploreFields")
    {:fields (into {} (map (fn [[k v]] [k (data->selector v)])
                           (get-in d ["ExploreFields" "Fields"] {})))}
    (contains? d "ExploreIndex")
    {:index (get-in d ["ExploreIndex" "Index"])
     :next (data->selector (get-in d ["ExploreIndex" "Next"]))}
    (contains? d "ExploreRange")
    {:range {:start (get-in d ["ExploreRange" "Start"])
             :end (get-in d ["ExploreRange" "End"])}
     :next (data->selector (get-in d ["ExploreRange" "Next"]))}
    (contains? d "ExploreUnion")
    {:union (mapv data->selector (get d "ExploreUnion"))}
    (contains? d "ExploreRecursive")
    {:recursive {:sequence (data->selector (get-in d ["ExploreRecursive" "Sequence"]))
               :limit (let [lim (get-in d ["ExploreRecursive" "Limit"] {})]
                        (if (contains? lim "Depth")
                          {:depth (get lim "Depth")}
                          {:none true}))
               :next (data->selector (get-in d ["ExploreRecursive" "Next"]))}}
    :else
    (fail! :awai.fs/bad-selector "awai fs: unknown selector data" {:data d})))

(defn data->selector [data]
  (let [s (sel/admit! (data->selector* data))]
    (when-not (= data (selector->data s))
      (fail! :awai.fs/bad-selector "unknown or non-canonical local AST fields" {})) s))

;; Request/response envelopes (DAG-CBOR maps).

(defn request-encode
  "`{:id any :root link-or-cid-bytes :selector kw-selector
  :extensions [...]}` to DAG-CBOR bytes. Root may be a decoded link
  map or raw CID bytes."
  [{:keys [id root selector extensions]}]
  (when (nil? root)
    (fail! :awai.fs/bad-request "awai fs: request needs a root" {}))
  (let [link (cond (and (map? root) (= 42 (:tag root))) root
                   (sequential? root) {:tag 42 :bytes (vec root)}
                   :else (fail! :awai.fs/bad-request
                                "awai fs: root must be a link" {}))]
    (car/cbor-encode {"format" "awai.local-traversal.v1"
                      "id" (or id 0)
                      "root" link
                      "selector" (selector->data (or selector {:match true}))
                      "extensions" (vec (or extensions []))})))

(defn request-decode
  "DAG-CBOR request bytes to {:id :root-cid :selector :extensions}."
  [bytes]
  (when (> (count bytes) 65536) (fail! :awai.fs/bad-request "local request exceeds bound" {}))
  (let [[m consumed] (car/cbor-decode (vec bytes) 0)
        link (get m "root")]
    (when (or (not= consumed (count bytes)) (not= "awai.local-traversal.v1" (get m "format"))
              (not= #{"format" "id" "root" "selector" "extensions"} (set (keys m)))
              (not (map? m)) (not (map? link)) (not= 42 (:tag link)))
      (fail! :awai.fs/bad-request "awai fs: request needs a link root" {}))
    {:id (get m "id" 0)
     :root-cid (vec (:bytes link))
     :selector (sel/admit! (data->selector (get m "selector")))
     :extensions (vec (get m "extensions" []))}))

(defn respond
  "Bounded local reference walk. Every visited block must match its dag-cbor
  SHA-256 CID. No blocks are returned on missing dependencies."
  [request store]
  (sel/admit! (:selector request))
  (let [visited (atom []) seen (atom #{}) total (atom 0)
        load (fn [cid]
               (let [c (vec cid) b (get store c)]
                 (when-not b (fail! :awai.fs/link-not-loaded "linked block absent" {}))
                 (when (or (> (count b) (* 1024 1024)) (> (count @seen) 1024))
                   (fail! :awai.fs/traversal-limit "block limit exceeded" {}))
                 (let [parsed (car/parse-cid c)]
                   (when-not (and (= car/codec-dag-cbor (:codec parsed))
                                  (= c (car/cid-bytes car/codec-dag-cbor (car/hex-decode (rm/bytes-sha256 b)))))
                     (fail! :awai.fs/cid-mismatch "local traversal block CID differs" {})))
                 (when-not (contains? @seen c)
                   (when (> (swap! total + (count b)) (* 8 1024 1024))
                     (fail! :awai.fs/traversal-limit "total block limit exceeded" {}))
                   (swap! seen conj c) (swap! visited conj {:cid c :data b}))
                 (let [[node n] (car/cbor-decode (vec b) 0)]
                   (when-not (= n (count b)) (fail! :awai.fs/bad-request "trailing block data" {})) node)))]
    (try
      (let [root (load (:root-cid request))
            matches (sel/select (:selector request) root load)]
        {:status :ok :matches matches :blocks @visited})
      (catch #?(:clj clojure.lang.ExceptionInfo :cljs js/Error) e
        (if (= :awai.fs/link-not-loaded (:type (ex-data e)))
          {:status :not-found :blocks []} (throw e))))))
