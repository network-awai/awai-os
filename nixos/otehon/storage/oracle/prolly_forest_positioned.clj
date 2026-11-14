;; Hosted test bridge: one verified recovery, then CID frame reads.
(require '[clojure.string :as str] '[otehon.ipld-forest :as catalog]
         '[otehon.storage :as store])
(import '[java.nio.file Files Paths] '[java.util Base64])
(def directory (or (System/getenv "PROLLY_FOREST_STORE")
                   (throw (ex-info "PROLLY_FOREST_STORE required" {}))))
(def fixture "nixos/otehon/storage/test/fixtures/prolly-forest/prolly.forest")
(def root "bafyreiakmttcp6otxvnyqmdjpzlschlskibp7enadlvkguw3nnp47f5wqm")
(defn answer [s] (println (str "ok:" (.encodeToString (Base64/getEncoder) (.getBytes (str s) "UTF-8")))) (flush))
(let [[action] *command-line-args*]
  (case action
    "publish" (do (store/init! directory)
                  (prn (catalog/publish! directory "prolly" root
                         (Files/readAllBytes (Paths/get fixture (make-array String 0))))))
    "serve" (let [h (catalog/recover directory "prolly")
                  stats (atom {:frame-reads 0 :frame-bytes 0})
                  original store/read-payload-segments]
              (loop []
                (when-let [line (read-line)]
                  (try
                    (cond
                      (= line "ref") (answer (get-in h [:ref :root-cid]))
                      (= line "stats") (answer (pr-str @stats))
                      (str/starts-with? line "get ")
                      (let [b (with-redefs [store/read-payload-segments
                                           (fn [dir sha ext size spans]
                                             (swap! stats #(-> % (update :frame-reads + (count spans))
                                                                   (update :frame-bytes + (reduce + (map :length spans)))))
                                             (original dir sha ext size spans))]
                                (catalog/get-block h (subs line 4)))]
                        (when-not b (throw (ex-info "CID absent" {})))
                        (println (str "ok:" (.encodeToString (Base64/getEncoder) ^bytes b))) (flush))
                      :else (throw (ex-info "unknown command" {})))
                    (catch Exception e (println (str "err:" (or (:type (ex-data e)) :failure))) (flush)))
                  (recur))))
    (throw (ex-info "expected publish or serve" {}))))
