;; One-off: actual datalog.core over an in-memory projection of the proof manifest.
(ns query-oracle (:require [datalog.core :as d] [datalog.index :as idx]))
(def fs (js/require "fs"))
(def input (js->clj (js/JSON.parse (.readFileSync fs ".agent-output/datalog-oracle/input.json" "utf8")) :keywordize-keys true))
(def facts (concat [{:s "file" :p :file/root :o (:cid input)}]
                   (mapcat (fn [i chunk] (let [id (str "chunk-" i)]
                     [{:s "file" :p :file/chunk :o id} {:s id :p :chunk/index :o i} {:s id :p :chunk/cid :o (:cid chunk)}]))
                     (range) (:chunks input))))
(def db (reduce (fn [db fact] (idx/assert-quad db fact (constantly false))) (idx/empty-db) facts))
(def query '{:find [?root ?cid] :where [["file" :file/root ?root] ["file" :file/chunk ?c] [?c :chunk/index 8] [?c :chunk/cid ?cid]]})
(def rows (d/q db query (constantly true)))
(def hidden (d/q db query (fn [fact] (not= (:p fact) :chunk/cid))))
(when-not (and (= 1 (count rows)) (empty? hidden)) (throw (js/Error. "unexpected Datalog result")))
(def value (first rows))
(.writeFileSync fs ".agent-output/datalog-oracle/result.json" (js/JSON.stringify (clj->js {:root (first value) :cid (second value) :hidden-count (count hidden)})))
(println (pr-str {:query :datalog.core/q :facts (count facts) :rows rows :hidden hidden :pass true}))
