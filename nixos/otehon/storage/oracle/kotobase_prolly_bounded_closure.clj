;; Hosted fixture oracle using the Kotoba-owned IPLD codec/link primitives.
(require '[clojure.edn :as edn] '[ipld.core :as ipld]
         '[kotobase.storage.core :as storage] '[otehon.kotobase-forest-blocks :as forest] '[otehon.storage :as disk])
(def base (or (System/getenv "KOTOBASE_TX_OUTPUT") (throw (ex-info "KOTOBASE_TX_OUTPUT required" {}))))
(def backend (forest/open-backend (str base "/store") (str base "/staging") "unused-for-read"))
(def head (:cid (storage/-read-ref backend "db")))
(defn fail! [type data] (throw (ex-info "closure refused" (assoc data :type type))))
(defn walk [get-fn root {:keys [max-blocks max-bytes max-depth max-edges]}]
  (loop [pending [[root 0]] seen #{} order [] total 0 edges 0]
    (if-let [[cid depth] (first pending)]
      (if (contains? seen cid)
        (recur (subvec pending 1) seen order total edges)
        (let [_ (when (> (inc (count seen)) max-blocks)
                  (fail! :resource-limit {:limit :blocks}))
              read-bytes (atom nil)
              node (ipld/get-node-bounded
                     (fn [requested]
                       (when-let [bytes (get-fn requested)]
                         (let [n (alength ^bytes bytes)]
                           (when (> (+ total n) max-bytes)
                             (fail! :resource-limit {:limit :bytes}))
                           (reset! read-bytes n)
                           bytes)))
                     cid {:max-bytes (* 850 1024) :max-depth 32 :max-items 100000})
              _ (when (nil? @read-bytes) (fail! :missing-block {:cid cid}))
              total (+ total @read-bytes)
              links (ipld/links node)
              new-edges (+ edges (count links))]
          (when (> new-edges max-edges) (fail! :resource-limit {:limit :edges}))
          (when (and (seq links) (>= depth max-depth)) (fail! :resource-limit {:limit :depth}))
          (recur (into (subvec pending 1) (map #(vector % (inc depth)) links))
                   (conj seen cid) (conj order cid) total new-edges)))
      {:blocks (count seen) :bytes total :edges edges :order order})))
(def get-block #(storage/get-block backend %))
(def limits {:max-blocks 256 :max-bytes (* 32 1024 1024) :max-depth 64 :max-edges 4096})
(def result (walk get-block head limits))
(when-not (> (:blocks result) 1) (throw (ex-info "fixture has no linked child" result)))
(def child (second (:order result)))
(defn kind [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(assert (= :missing-block (kind #(walk (fn [cid] (when-not (= cid child) (get-block cid))) head limits))))
(assert (= :ipld/cid-mismatch (kind #(walk (fn [cid] (if (= cid child) (get-block head) (get-block cid))) head limits))))
(assert (= :resource-limit (kind #(walk get-block head (assoc limits :max-blocks 1)))))
(assert (= :resource-limit (kind #(walk get-block head (assoc limits :max-depth 0)))))
(assert (= :resource-limit (kind #(walk get-block head (assoc limits :max-bytes 1)))))
(assert (= :resource-limit (kind #(walk get-block head (assoc limits :max-edges 1)))))
(def malicious (byte-array (concat (repeat 10000 (unchecked-byte 0x81)) [(unchecked-byte 0xf6)])))
(def malicious-cid (ipld/cid malicious))
(assert (= :cbor/resource-limit
           (kind #(walk {malicious-cid malicious} malicious-cid limits))))
(def directory (str base "/store"))
(def staging (str base "/staging"))
(def before (disk/read-store directory))
(assert (= :invalid-closure-verifier (kind #(forest/open-backend directory staging "unused-for-read" nil))))
(def denied (forest/open-backend directory staging "unused-for-read" (fn [_ _] false)))
(assert (= :closure-rejected (kind #(storage/-compare-and-set-ref! denied "db" head head))))
(assert (= before (disk/read-store directory)))
(def missing-verifier
  (forest/open-backend directory staging "unused-for-read"
    (fn [get-fn root] (walk (fn [cid] (when-not (= cid child) (get-fn cid))) root limits) true)))
(assert (= :missing-block (kind #(storage/-compare-and-set-ref! missing-verifier "db" head head))))
(assert (= before (disk/read-store directory)))
(def deep-verifier
  (forest/open-backend directory staging "unused-for-read"
    (fn [_ _] (walk {malicious-cid malicious} malicious-cid limits) true)))
(assert (= :cbor/resource-limit (kind #(storage/-compare-and-set-ref! deep-verifier "db" head head))))
(assert (= before (disk/read-store directory)))
(def accepted (forest/open-backend directory staging "unused-for-read"
  (fn [get-fn root] (= (dissoc result :order) (dissoc (walk get-fn root limits) :order)))))
(assert (:published? (storage/-compare-and-set-ref! accepted "db" head head)))
(assert (= head (:cid (storage/-read-ref accepted "db"))))
(prn (assoc (dissoc result :order) :root head :missing :refused :wrong-bytes :refused :limits :refused
            :bounded-decoder :passed :deep-cbor :refused :ref-guard :passed :failed-guard-root-unchanged true :pass true))
(shutdown-agents)
