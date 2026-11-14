;; Exercise the hosted CLI's default and explicit local generation conditions.
(require '[clojure.edn :as edn] '[otehon.cli :as cli] '[otehon.storage :as s]
         '[otehon.forest-writer :as w] '[otehon.pack-store :as p])
(import '[java.security MessageDigest] '[java.util HexFormat])
(def mode (first *command-line-args*))
(def base (second *command-line-args*))
(def tool (nth *command-line-args* 2))
(def source-dir (nth *command-line-args* 3))
(def store (str base "/store"))
(def old (str source-dir "/old"))
(def new (str source-dir "/new"))
(defn check! [x m] (when-not x (throw (ex-info m {}))))
(defn kind [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn run-cli [& args] (edn/read-string (with-out-str (apply cli/-main args))))
(defn file-hash [h]
  (let [md (MessageDigest/getInstance "SHA-256")]
    (dotimes [i 17] (.update md ^bytes (p/read-group-range h "file" (* i 1048576) 1048576)))
    (.formatHex (HexFormat/of) (.digest md))))
(case mode
 "write"
 (do (check! (.mkdir (java.io.File. base)) "output exists") (s/init! store)
     (doseq [bad ["0" "01" "-1" "9007199254740992" "x"]]
       (check! (= :invalid-generation (kind #(run-cli "forest-file-put-large" store "file" old (str base "/invalid") tool bad))) "invalid generation accepted"))
     (check! (not (.exists (java.io.File. (str base "/invalid")))) "invalid argument staged")
     (let [first (run-cli "forest-file-put-large" store "file" old (str base "/stage-old") tool)
           saved-generation (get-in (s/read-store store) [:root :generation])
           original w/put-file-large! after-other (atom nil)]
       (check! (= 2 (:pack-count first)) "first file not two packs")
       ;; Deterministically advance after the CLI captured its implicit generation.
       (with-redefs [w/put-file-large!
                     (fn [& args]
                       (s/transact! store :put {:key "other-writer" :value "advanced"})
                       (reset! after-other (s/read-store store))
                       (apply original args))]
         (check! (= :stale-generation (kind #(run-cli "forest-file-put-large" store "file" new (str base "/stage-implicit-stale") tool))) "implicit stale accepted"))
       (check! (= @after-other (s/read-store store)) "implicit stale changed store")
       (check! (= (:sha (s/forest-source-digest old)) (file-hash (p/recover store))) "implicit stale changed file")
       (check! (= :stale-generation (kind #(run-cli "forest-file-put-large" store "file" new (str base "/stage-explicit-stale") tool (str saved-generation)))) "explicit stale accepted")
       (check! (= @after-other (s/read-store store)) "explicit stale changed store")
       (let [current (get-in @after-other [:root :generation])
             next (run-cli "forest-file-put-large" store "file" new (str base "/stage-current") tool (str current))]
         (check! (= 2 (:pack-count next)) "new file not two packs")
         (check! (= (:sha (s/forest-source-digest new)) (file-hash (p/recover store))) "new full file differs")
         (prn {:implicit-stale :refused :explicit-stale :refused :invalid :refused :packs 2 :pass true}))))
 "read"
 (let [h (p/recover store)]
   (check! (= 2 (count (get-in (p/summary h) [:groups "file" :packs]))) "reopened pack count differs")
   (check! (= (:sha (s/forest-source-digest new)) (file-hash h)) "reopened full file differs")
   (prn {:fresh-process true :packs 2 :full-hash :matched :pass true}))
 (throw (ex-info "expected write or read" {})))
(shutdown-agents)
