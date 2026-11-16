(ns awai-oracle.provider-forest
  (:require [kotobase.storage.core :as storage]
            [datom.source :as source]
            [datalog.core :as datalog]
            [kotobase.engine.contract :as engine]
            [kotobase.engine.prolly.provider :as provider]))
(def child (js/require "child_process"))
(def cp "nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src")
(def script "nixos/otehon/storage/oracle/prolly_forest_store.clj")
(defn call [action cid]
  (.execFileSync child "bb" (clj->js (cond-> ["--classpath" cp script action] cid (conj cid))) #js {:maxBuffer 1048576}))
(def root "bafyreiakmttcp6otxvnyqmdjpzlschlskibp7enadlvkguw3nnp47f5wqm")
(defn backend [reads]
  (reify
    storage/IBlockStore
    (-put-blocks! [_ _] (throw (js/Error. "read-only oracle")))
    (-get-blocks [_ cids]
      (swap! reads into cids)
      (js/Promise.resolve (into {} (map (fn [cid] [cid (js/Uint8Array. (call "get" cid))]) cids))))
    storage/IRefStore
    (-read-ref [_ _] (js/Promise.resolve {:cid (.toString (call "ref" nil) "utf8") :version 1}))
    (-compare-and-set-ref! [_ _ _ _] (throw (js/Error. "read-only oracle")))
    storage/IBackendCapabilities
    (-capabilities [_] #{:immutable-blocks :cid-addressed-read :conditional-ref :linearizable-ref})))
(def query '{:find [?root ?cid] :where [["file" :file/root ?root] ["file" :file/chunk ?c] [?c :chunk/index 8] [?c :chunk/cid ?cid]]})
(def expected #{["bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny" "bafkreidxq3azg4pwxcuurzkrmjha3uuzhstmefbzx6dw6z5bjaqya64mra"]})
(defn -main []
  (let [reads (atom []) b (backend reads)
        e (provider/engine-from-backend b {:blind-fn #(js/Promise.resolve (str "blind-fixture:" %))
                                           :encrypt-fn #(js/Promise.resolve %) :decrypt-fn #(js/Promise.resolve %) :digest-fn identity})]
    (-> (provider/restore-head e b "main")
        (.then (fn [state]
                 (when-not (= root (:physical-root state)) (throw (js/Error. "wrong root")))
                 (-> (js/Promise.all #js [(js/Promise.resolve (engine/open-snapshot e state))
                                          (js/Promise.resolve (engine/open-snapshot e state {:as-of 1}))])
                     (.then (fn [snaps]
                              (let [snap (aget snaps 0) old (aget snaps 1)
                                    src (reify source/IAsyncPatternSource
                                          (-scan-async [_ pattern]
                                            (.then (engine/scan e snap pattern)
                                                   (fn [rows] (mapv (fn [{:keys [e a v]}] {:s e :p a :o v}) rows)))))]
                                (js/Promise.all #js [(engine/scan e snap ["file" :file/name nil])
                                                     (engine/scan e old ["file" :file/name nil])
                                                     (datalog/q-async src query (constantly true))
                                                     (datalog/q-async src query #(not= (:p %) :chunk/cid))])))))))
        (.then (fn [r]
                 (when-not (and (= ["after"] (mapv :v (aget r 0))) (= ["before"] (mapv :v (aget r 1)))
                                (= expected (aget r 2)) (empty? (aget r 3)))
                   (throw (js/Error. (str "unexpected results " (pr-str (vec r))))))
                 (println "Forest-backed async Datalog join, visibility filtering and as-of scans passed; block reads" (count @reads))))
        (.catch (fn [e] (.error js/console e) (set! (.-exitCode js/process) 1))))))
(set! *main-cli-fn* -main)
