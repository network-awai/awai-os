(require '[otehon.storage :as s] '[otehon.pack-store :as p])
(import '[java.nio.file Files Paths OpenOption LinkOption] '[java.security MessageDigest] '[java.util HexFormat])
(def base (or (System/getenv "FOREST_GIB_FIXTURE") (throw (ex-info "FOREST_GIB_FIXTURE required" {}))))
(defn hex [md] (.formatHex (HexFormat/of) (.digest md)))
(defn source-sha [path]
  (let [md (MessageDigest/getInstance "SHA-256") buf (byte-array 65536)]
    (with-open [in (Files/newInputStream (Paths/get path (make-array String 0)) (into-array OpenOption [LinkOption/NOFOLLOW_LINKS]))]
      (loop [] (let [n (.read in buf)] (when (pos? n) (.update md buf 0 n) (recur)))))
    (hex md)))
(let [source (str base "/input.sparse")
      _ (when-not (= 1073741824 (Files/size (Paths/get source (make-array String 0))))
          (throw (ex-info "fixture is not 1 GiB" {})))
      expected (source-sha source)
      h (p/recover (str base "/store")) refs (get-in (p/summary h) [:groups "gib" :packs])
      md (MessageDigest/getInstance "SHA-256")]
  (when-not (and (= 64 (count refs)) (= 64 (count (set (map :stored-sha refs)))))
    (throw (ex-info "wrong recovered Pack count" {})))
  (dotimes [i 1024]
    (.update md ^bytes (p/read-group-range h "gib" (* i 1048576) 1048576))
    (when (zero? (mod (inc i) 64)) (prn {:verified-mib (inc i)}) (flush)))
  (let [actual (hex md)]
    (when-not (= expected actual) (throw (ex-info "full file digest mismatch" {:expected expected :actual actual})))
    (prn {:file-size 1073741824 :packs (count refs) :distinct-packs (count (set (map :stored-sha refs)))
          :sha256 actual :full-file-verified true :stats (:stats (p/summary h))})))
