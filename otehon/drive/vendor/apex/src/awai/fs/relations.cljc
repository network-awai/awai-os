(ns awai.fs.relations
  "File relations, metadata, and permission enforcement for Awai FS:
  dead-property meta map, typed external refs (Linear/GitHub/mail),
  per-file ACLs evaluated against volume-token principals, and
  chunk-identity refcounts. Pure data-model helpers only; HTTP and
  manifest wiring stay in awaivol.cljc.

  Meta shape on a file record: :meta is {qname {:ns uri :value text}}
  where qname is \"prefix:name\". Well-known prefixes own fixed
  namespaces: awaimeta -> urn:awai:meta, awairef -> urn:awai:ref.
  External refs live under awairef:<kind> props (kind = linear,
  github, mail) and resolve to URLs via ref-url.

  ACL shape: [{:principal name-or-\"*\" :ops [\"read\" \"write\"]}].
  allowed? is allow-only (absence denies); the volume owner token
  bypasses ACLs at the call site, not here."
  (:refer-clojure :exclude []))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(def well-known-namespaces
  {"awaimeta" "urn:awai:meta"
   "awairef" "urn:awai:ref"})

(defn valid-prop-key?
  "qname looks like prefix:name with a sane prefix."
  [qname]
  (and (string? qname)
       (boolean (re-matches #"[A-Za-z][\w.\-]*:[\w.\-]+" qname))))

(defn prop-prefix
  "Prefix of a qname, or nil."
  [qname]
  (when (valid-prop-key? qname)
    (subs qname 0 (.indexOf ^String qname ":"))))

(defn- normalize-meta-value
  "One meta value to {:ns :value} (strings; JSON string-keyed maps)."
  [q v]
  (cond
    (and (map? v) (string? (:ns v)) (string? (:value v)))
    {:ns (:ns v) :value (:value v)}
    (and (map? v) (string? (get v "ns")) (string? (get v "value")))
    {:ns (get v "ns") :value (get v "value")}
    (string? v)
    {:ns "" :value v}
    :else
    (fail! :awai.fs/bad-meta "awai fs: meta values are text" {:key q})))

(defn- normalize-one-meta
  "One meta entry [k v] to [qname {:ns :value}]."
  [[k v]]
  (let [q (str k)]
    (when-not (valid-prop-key? q)
      (fail! :awai.fs/bad-meta "awai fs: bad prop key" {:key q}))
    [q (normalize-meta-value q v)]))

(defn normalize-meta
  "Manifest-loaded :meta into {qname {:ns :value}} (strings only).
  Legacy bare-string values become {:ns \"\" :value v}; anything else
  fails closed."
  [raw]
  (if (nil? raw)
    {}
    (do
      (when-not (map? raw)
        (fail! :awai.fs/bad-meta "awai fs: meta must be a map" {}))
      (into {} (map normalize-one-meta raw)))))

(defn normalize-acl
  "Manifest-loaded :acl into [{:principal :ops}] (ops a string vec).
  Nil becomes []. Anything else fails closed."
  [raw]
  (if (nil? raw)
    []
    (do (when-not (sequential? raw)
          (fail! :awai.fs/bad-acl "awai fs: acl must be a vector" {}))
        (mapv (fn [e]
                (let [p (or (get e :principal) (get e "principal"))
                      o (or (get e :ops) (get e "ops"))]
                  (when-not (and (string? p) (not (empty? p)))
                    (fail! :awai.fs/bad-acl "awai fs: acl needs a principal" {}))
                  (when-not (and (sequential? o)
                                 (seq o)
                                 (every? string? o))
                    (fail! :awai.fs/bad-acl "awai fs: acl needs string ops" {}))
                  {:principal p :ops (vec o)}))
              raw))))

;; External refs: awairef:<kind> props.

(def ref-kinds
  #{:linear :github :mail})

(defn parse-ref
  "Validate an external ref [kind id]. Kinds: :linear (issue id like
  AWAI-161), :github (org/repo#n), :mail (addr or <message-id>).
  Returns {:kind :id}; fails closed."
  [kind id]
  (let [k (keyword kind)]
    (when-not (contains? ref-kinds k)
      (fail! :awai.fs/bad-ref "awai fs: unknown ref kind" {:kind kind}))
    (when-not (and (string? id) (not (empty? id)))
      (fail! :awai.fs/bad-ref "awai fs: ref id must be non-blank text" {}))
    (when (and (= k :github)
               (not (boolean (re-matches #"[^/\s]+/[^/\s]+#\d+" id))))
      (fail! :awai.fs/bad-ref "awai fs: github ref looks like org/repo#n"
             {:id id}))
    {:kind k :id id}))

(defn ref-url
  "Resolvable URL for a parsed ref. Linear issues point at the
  Kotoba Labs workspace; GitHub refs at the issue page; mail addrs at
  mailto:, other mail ids at mid:."
  [{:keys [kind id]}]
  (case kind
    :linear (str "https://linear.app/kotobalabs/issue/" id)
    :github (let [m (re-matches #"([^/\s]+/[^/\s]+)#(\d+)" id)]
              (when (nil? m)
                (fail! :awai.fs/bad-ref "awai fs: github ref looks like org/repo#n"
                       {:id id}))
              (str "https://github.com/" (nth m 1) "/issues/" (nth m 2)))
    :mail (if (boolean (re-matches #".*@.*" id))
            (str "mailto:" id)
            (str "mid:" id))))

(defn file-refs
  "Typed external refs from a normalized meta map: [{:kind :id :url
  :qname}]. Unparsable awairef: props are skipped (view, not gate)."
  [meta]
  (into []
        (keep (fn [[qname {:keys [value]}]]
                (when (and (valid-prop-key? qname)
                           (= "awairef" (prop-prefix qname)))
                  (let [kind (subs qname (inc (.indexOf ^String qname ":")))]
                    (try
                      (let [r (parse-ref kind value)]
                        (assoc r :url (ref-url r) :qname qname))
                      (catch #?(:clj clojure.lang.ExceptionInfo
                                :cljs js/Error) _ nil)))))
        meta)))

;; ACL evaluation (pure; owner bypass lives at the call site).

(defn acl-allowed?
  "True when `acl` grants `principal` (string or nil) `op`
  (\"read\"/\"write\"). A \"*\" principal rule covers anonymous
  callers. Allow-only: no rule means deny."
  [acl principal op]
  (boolean (some (fn [{rp :principal ops :ops}]
                   (and (or (= "*" rp)
                            (and (some? principal) (= rp principal)))
                        (or (= ops "*")
                            (and (sequential? ops)
                                 (boolean (some #(= % op) ops))))))
                 acl)))

(defn- chunk-identity [entry]
  (let [id (or (:cid entry) (:sha entry))]
    (when-not (and (string? id) (seq id))
      (fail! :awai.fs/missing-chunk-identity "content identity required; local ordinals are not IDs" {}))
    [id (:length entry)]))

(defn refcounts
  "Content identity [CID-or-legacy-SHA length] to occurrence count and names.
  Per-file ordinals and physical locations never identify shared content."
  [manifest]
  (let [tagged (mapcat (fn [[name fm]] (map #(assoc % :file (str name)) (:entries fm))) (:files manifest))]
    (into {} (map (fn [[id entries]] [id {:count (count entries) :files (vec (distinct (map :file entries)))}]))
          (group-by chunk-identity tagged))))

(defn file-identity
  "Persisted logical profile and ordered chunk content identities, independent
  of physical locations. Legacy records use their explicit SHA values."
  [fm]
  [(:chunk-profile fm) (:file-size fm) (mapv chunk-identity (:entries fm))])

(defn same-identity? [a b] (= (file-identity a) (file-identity b)))
