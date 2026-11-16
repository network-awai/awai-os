(require '[cheshire.core :as json] '[clojure.edn :as edn]
         '[awai.fs.car :as car] '[otehon.storage :as store] '[otehon.pack-store :as pack])
(import '[java.security MessageDigest] '[java.util Arrays])
(defn cid [b] (car/cid-str (car/cid-bytes car/codec-raw (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b)))))
(let [q (json/parse-string (slurp ".agent-output/datalog-oracle/result.json") true)
      dirs [".agent-output/crosspack-proof-2/zpack" ".agent-output/crosspack-proof-2/forest"]
      handles (mapv pack/recover dirs)
      ms (mapv #(edn/read-string (get-in (store/read-store %) [:state "proof/logical-file"])) dirs)
      a (pack/read-range-verified-leaves (first handles) "part-1" 0 65536)
      b (pack/read-forest-block (second handles) "part-1" (car/base32-decode (subs (:cid q) 1)))]
  (when-not (and (every? #(= (:root q) (:cid %)) ms) (Arrays/equals a b) (= (cid a) (:cid q)) (= 0 (:hidden-count q)))
    (throw (ex-info "Datalog result or retrieved block mismatch" {})))
  (prn {:datalog-root (:root q) :datalog-block (:cid q) :block-size (alength a)
        :physical-paths [:zpack :forest] :bytes-equal true :hidden-rows 0 :pass true}))
