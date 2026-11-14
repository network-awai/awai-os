(require '[cheshire.core :as json] '[clojure.string :as str])
(let [m (json/parse-string (slurp ".agent-output/datalog-oracle/input.json") true)
      rows (reduce (fn [acc x] (str "(w/append " acc " (f/chunk-row " (:offset x) " " (:length x) " " (pr-str (:cid x)) "))")) "(vector-i64)" (:chunks m))
      program (str "(ns awai.fs.native-2m-test (:require [awai.fs.logical-file :as f] [ipld.dag-cbor-write :as w]) (:export [main]))\n"
                   "(defn main [] :i64 (let [p (f/profile-new 1 \"fixed\" 65536) rows " rows
                   " file (f/file-new 1 2097152 p rows) c (f/file-cid file)] "
                   "(cond (not (result-ok?-of [:result :string :keyword] c)) 1 "
                   "(not (string=? (result-value-of [:result :string :keyword] c \"\") " (pr-str (:cid m)) ")) 2 :else 0)))\n")]
  (spit ".agent-output/native-2m/src/corpus.kotoba" program))
