(ns awai-oracle.provider-forest-positioned
  (:require [kotobase.storage.core :as storage]
            [datom.source :as source]
            [datalog.core :as datalog]
            [kotobase.engine.contract :as engine]
            [kotobase.engine.prolly.provider :as provider]))
(def child (js/require "child_process"))
(def cp "nixos/otehon/storage/src:nixos/otehon/storage/vendor/apex/src:nixos/otehon/storage/vendor/apex-car/src")
(def script "nixos/otehon/storage/oracle/prolly_forest_positioned.clj")
(def readline (js/require "readline"))
(defn service []
  (let [proc (.spawn child "bb" #js ["--classpath" cp script "serve"] #js {:stdio #js ["pipe" "pipe" "inherit"]})
        line-reader (.createInterface readline #js {:input (.-stdout proc)})
        queue (atom [])]
    (.on line-reader "line" (fn [line]
      (when-let [{:keys [resolve reject]} (first @queue)]
        (swap! queue #(vec (rest %)))
        (if (.startsWith line "ok:")
          (resolve (.from js/Buffer (.slice line 3) "base64"))
          (reject (js/Error. line))))))
    (.on proc "exit" (fn [code]
      (doseq [{:keys [reject]} @queue] (reject (js/Error. (str "bridge exit " code))))
      (reset! queue [])))
    {:process proc :request (fn [line]
       (js/Promise. (fn [resolve reject]
         (swap! queue conj {:resolve resolve :reject reject})
         (.write (.-stdin proc) (str line "\n")))))}))
(def root "bafyreiakmttcp6otxvnyqmdjpzlschlskibp7enadlvkguw3nnp47f5wqm")
(defn backend [reads request]
  (reify
    storage/IBlockStore
    (-put-blocks! [_ _] (throw (js/Error. "read-only oracle")))
    (-get-blocks [_ cids]
      (swap! reads into cids)
      (.then (js/Promise.all
              (clj->js (mapv (fn [cid] (.then (request (str "get " cid))
                                                (fn [bytes] [cid (js/Uint8Array. bytes)]))) cids)))
             (fn [pairs] (into {} (array-seq pairs)))))
    storage/IRefStore
    (-read-ref [_ _] (.then (request "ref") (fn [b] {:cid (.toString b "utf8") :version 1})))
    (-compare-and-set-ref! [_ _ _ _] (throw (js/Error. "read-only oracle")))
    storage/IBackendCapabilities
    (-capabilities [_] #{:immutable-blocks :cid-addressed-read :conditional-ref :linearizable-ref})))
(def query '{:find [?root ?cid] :where [["file" :file/root ?root] ["file" :file/chunk ?c] [?c :chunk/index 8] [?c :chunk/cid ?cid]]})
(def expected #{["bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny" "bafkreidxq3azg4pwxcuurzkrmjha3uuzhstmefbzx6dw6z5bjaqya64mra"]})
(defn -main []
  (let [{:keys [request] :as svc} (service) reads (atom []) b (backend reads request)
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
                 (-> (request "stats")
                     (.then (fn [stats]
                              (println "Positioned Forest Datalog join, visibility and as-of passed; requests" (count @reads) "frames" (.toString stats "utf8")))))))
        (.catch (fn [e] (.error js/console e) (set! (.-exitCode js/process) 1)))
        (.finally (fn [] (.kill (:process svc)))))))
(set! *main-cli-fn* -main)
