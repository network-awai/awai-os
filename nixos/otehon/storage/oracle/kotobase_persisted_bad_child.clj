;; Real hosted Forest persistence with a deliberately invalid linked child.
(require '[clojure.edn :as edn] '[ipld.core :as ipld]
         '[kotobase.storage.core :as storage] '[otehon.kotobase-forest-blocks :as forest]
         '[otehon.storage :as disk] '[clojure.string :as str])
(import '[java.util Arrays])
(def base (or (System/getenv "KOTOBASE_TX_OUTPUT") (throw (ex-info "KOTOBASE_TX_OUTPUT required" {}))))
(def tool (or (System/getenv "FOREST_TOOL") (throw (ex-info "FOREST_TOOL required" {}))))
(def directory (str base "/store"))
(def staging (str base "/staging"))
(def limits {:max-bytes (* 850 1024) :max-depth 32 :max-items 100000})
(defn check! [condition message] (when-not condition (throw (ex-info message {}))))
(defn kind [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn guard [get-fn root]
  (let [node (ipld/get-node-bounded get-fn root limits)
        links (ipld/links node)]
    (check! (= 1 (count links)) "expected one child")
    (ipld/get-node-bounded get-fn (first links) limits)
    true))
(defn backend [] (forest/open-backend directory staging tool guard))
(defn group-count []
  (count (filter #(str/starts-with? % "awai.ipld-forest-group/kotobase-blocks/")
                 (keys (:state (disk/read-store directory))))))
(defn ref-cid [db] (:cid (storage/-read-ref db "db")))
(defn check-rejected! [db head root child bytes]
  (let [stored (storage/get-block db child)
        node (ipld/get-node-bounded #(storage/get-block db %) root limits)]
    (check! (and stored (Arrays/equals ^bytes bytes ^bytes stored)) "child bytes missing or changed")
    (check! (= [child] (ipld/links node)) "root link changed")
    (check! (= :cbor/resource-limit
               (kind #(storage/-compare-and-set-ref! db "db" head root)))
            "guard did not reject deep child")
    (check! (= head (ref-cid db)) "ref changed after rejection")))
(let [db (backend)
      malformed (byte-array (concat (repeat 10000 (unchecked-byte 0x81)) [(unchecked-byte 0xf6)]))
      child (ipld/cid malformed)
      block (ipld/node->block {"child" (ipld/link child)})
      root (:cid block)]
  (case (first *command-line-args*)
    "write"
    (let [head (ref-cid db) before-groups (group-count)]
      (check! (some? head) "fixture ref missing")
      ;; Separate calls produce separate immutable Forest groups before CAS.
      (check! (= [child] (storage/-put-blocks! db [{:cid child :bytes malformed}])) "child batch failed")
      (check! (= [root] (storage/-put-blocks! db [block])) "root batch failed")
      (check! (= (+ before-groups 2) (group-count)) "expected two new groups")
      (check-rejected! db head root child malformed)
      (spit (str base "/bad-child.edn") (pr-str {:head head :root root :child child}))
      (prn {:phase :write :batches 2 :ref-unchanged true :child-stored true :rejected true :pass true}))
    "read"
    (let [expected (edn/read-string (slurp (str base "/bad-child.edn")))]
      (check! (= [root child] ((juxt :root :child) expected)) "fixture CID changed")
      (check! (= (:head expected) (ref-cid db)) "ref differs after process restart")
      (check-rejected! db (:head expected) root child malformed)
      (prn {:phase :fresh-process-read :ref-unchanged true :child-stored true :rejected true :pass true}))
    (throw (ex-info "expected write or read" {}))))
(shutdown-agents)
