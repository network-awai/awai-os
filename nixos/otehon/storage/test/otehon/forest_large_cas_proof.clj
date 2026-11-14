;; Hosted Forest large writer conditional-generation proof; not distributed fencing.
(require '[otehon.storage :as s] '[otehon.forest-writer :as w] '[otehon.pack-store :as p])
(import '[java.nio.file Files Paths OpenOption StandardOpenOption] '[java.security MessageDigest] '[java.util HexFormat])
(def mode (first *command-line-args*))
(def base (second *command-line-args*))
(def tool (nth *command-line-args* 2))
(def store (str base "/store"))
(defn check! [v m] (when-not v (throw (ex-info m {}))))
(defn kind [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(defn source! [path marker]
  (with-open [out (Files/newOutputStream (Paths/get path (make-array String 0))
                                        (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
    (let [b (byte-array 1048576)]
      (aset-byte b 0 (unchecked-byte marker))
      (dotimes [_ 17] (.write out b)))))
(defn content-sha [h]
  (let [md (MessageDigest/getInstance "SHA-256")]
    (dotimes [i 17] (.update md ^bytes (p/read-group-range h "file" (* i 1048576) 1048576)))
    (.formatHex (HexFormat/of) (.digest md))))
(defn files [] (set (seq (.list (java.io.File. store)))))
(case mode
 "write"
 (do (check! (.mkdir (java.io.File. base)) "output exists")
     (let [old (str base "/old") new (str base "/new")]
       (source! old 65) (source! new 66) (s/init! store)
       (check! (= :invalid-generation (kind #(w/put-file-large! store "file" old (str base "/bad") tool {:expected-generation nil}))) "nil generation accepted")
       (check! (not (.exists (java.io.File. (str base "/bad")))) "invalid generation staged work")
       (let [first-generation (get-in (s/read-store store) [:root :generation])
             first (w/put-file-large! store "file" old (str base "/stage-old") tool {:expected-generation first-generation})
             stale (get-in (s/read-store store) [:root :generation])]
         (check! (= 2 (:pack-count first)) "expected two old packs")
         (check! (= (:sha (s/forest-source-digest old)) (content-sha (p/recover store))) "initial full hash differs")
         (s/transact! store :put {:key "other-writer" :value "advanced"})
         (let [before (s/read-store store) prior-files (files)]
           (check! (= :stale-generation (kind #(w/put-file-large! store "file" new (str base "/stage-stale") tool {:expected-generation stale}))) "stale writer accepted")
           (check! (= before (s/read-store store)) "stale write changed root/state")
           (check! (= prior-files (files)) "stale write published store objects")
           (check! (= (:sha (s/forest-source-digest old)) (content-sha (p/recover store))) "stale write changed file")
           (let [current (get-in before [:root :generation])
                 result (w/put-file-large! store "file" new (str base "/stage-new") tool {:expected-generation current})]
             (check! (= 2 (:pack-count result)) "expected two new packs")
             (check! (= (:sha (s/forest-source-digest new)) (content-sha (p/recover store))) "current write differs")
             (prn {:stale :refused :stale-store-unchanged true :old-and-new-full-hash :matched :packs 2 :pass true}))))))
 "read"
 (let [new (str base "/new") h (p/recover store)]
   (check! (= (:sha (s/forest-source-digest new)) (content-sha h)) "reopened file hash differs")
   (check! (= 2 (count (get-in (p/summary h) [:groups "file" :packs]))) "reopened pack count differs")
   (prn {:fresh-process true :full-hash :matched :packs 2 :pass true}))
 (throw (ex-info "expected write or read" {})))
(shutdown-agents)
