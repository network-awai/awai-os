(ns device-readback
  (:require [awai.wnfs.blocks :as b] [awai.wnfs.wire :as w]
            [awai.wnfs.private-node :as pn] [awai.wnfs.model :as m]
            [awai.wnfs.otehon :as host] ["node:fs" :as fs]
            ["node:crypto" :as crypto] ["multiformats/cid" :refer [CID]]))
(let [[store-root] *command-line-args*
      corpus (js->clj (js/JSON.parse (fs/readFileSync "test/corpus/private-tree-rust.json" "utf8")) :keywordize-keys true)
      cap (get (:access corpus) (keyword "wnfs/share/temporal"))
      ref {:label (:label cap) :content-cid (.decode CID (b/u8 (:contentCid cap)))
           :temporal-key (:temporalKey cap) :snapshot-key (m/snapshot-key host/provider (:temporalKey cap))}
      store (b/disk-store store-root)
      forest (w/load-forest store (.parse CID (:forest corpus)))
      node (pn/resolve-node store forest ref ["資料" "hello.txt"])
      data (pn/read-file store forest node)
      expected (vec (js/Buffer.from "WNFS upstream interoperability\u0000\u00ff" "latin1"))]
  (when-not (= data expected) (m/reject :device-roundtrip-mismatch))
  (println (js/JSON.stringify #js {:verified true :bytes (count data)
    :sha256 (.digest (.update (crypto/createHash "sha256") (b/u8 data)) "hex")})))
