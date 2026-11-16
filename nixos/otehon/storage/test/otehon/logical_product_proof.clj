;; Real Otehon group publication against the Kotoba v1 logical-file corpus.
(require '[awai.fs.car :as car] '[cheshire.core :as json] '[otehon.pack-store :as pack]
         '[otehon.storage :as store])
(import '[java.nio.file Files Paths] '[java.security MessageDigest])
(def fixtures (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack"))
(defn ensure! [x message] (when-not x (throw (ex-info message {}))))
(defn arr [v] (byte-array (map unchecked-byte v)))
(defn digest [v] (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") (arr v))))
(defn part [] (mapv #(Files/readAllBytes (Paths/get (str fixtures "/part-" % ".forest.car.zst") (make-array String 0))) (range 4)))
(defn manifest []
  (let [leaf-size 65536 size (* 32 leaf-size)
        chunks (mapv (fn [offset]
                       (let [v (mapv #(mod (+ (* % 19) (quot % 8191)) 256)
                                     (range offset (+ offset leaf-size)))]
                         {"cid" {:tag 42 :bytes (car/cid-bytes car/codec-raw (digest v))}
                          "offset" offset "length" leaf-size}))
                     (range 0 size leaf-size))
        value {"format" "awai.logical-file" "version" 1 "fileSize" size
               "chunkProfile" {"kind" "fixed" "version" 1 "leafSize" leaf-size}
               "chunks" chunks}
        bytes (car/cbor-encode value)]
    {:value value :bytes (arr bytes)
     :cid (car/cid-str (car/cid-bytes car/codec-dag-cbor (digest bytes)))}))
(defn refuses? [f] (try (f) false (catch Exception _ true)))
(defn check-common-corpus []
  (let [case (json/parse-string (slurp (str fixtures "/logical-file-corpus.json")) true)
        bytes (arr (car/hex-decode (:wireHex case)))
        leaves (mapv (fn [{:keys [cid length]}]
                       {:cid (car/base32-decode (subs cid 1)) :length length})
                     (get-in case [:input :chunks]))]
    (#'pack/verify-logical-manifest bytes (:cid case) [leaves])
    (ensure! (refuses? #(#'pack/verify-logical-manifest bytes "wrong" [leaves])) "corpus CID refusal failed")))
(let [[directory] *command-line-args* m (manifest) packs (part)
      expected "bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny"]
  (check-common-corpus)
  (ensure! (= expected (:cid m)) "shared Native logical manifest CID differs")
  (store/init! directory)
  (let [before (store/read-store directory)]
    (ensure! (refuses? #(pack/import-logical-forest! directory "file" packs (:bytes m) "wrong")) "wrong CID accepted")
    (doseq [bad [(assoc (:value m) "version" 2)
                 (assoc-in (:value m) ["chunks" 1 "offset"] 1)
                 (assoc-in (:value m) ["chunks" 0 "cid" :bytes] (vec (repeat 36 0)))]]
      (let [v (car/cbor-encode bad) cid (car/cid-str (car/cid-bytes car/codec-dag-cbor (digest v)))]
        (ensure! (refuses? #(pack/import-logical-forest! directory "file" packs (arr v) cid)) "invalid manifest accepted")))
    (ensure! (= before (store/read-store directory)) "rejected manifest changed published state"))
  (pack/import-logical-forest! directory "file" packs (:bytes m) (:cid m))
  (let [h (pack/recover directory) group (get-in (pack/summary h) [:groups "file"])
        offset (- (* 8 65536) 20)
        expected-bytes (arr (map #(mod (+ (* % 19) (quot % 8191)) 256) (range offset (+ offset 40))))]
    (ensure! (= (:cid m) (:manifest-cid group)) "recovered manifest CID differs")
    (ensure! (java.util.Arrays/equals expected-bytes (pack/read-group-range h "file" offset 40)) "cross-Pack read differs")
    ;; Tamper the committed manifest while preserving a syntactically valid root.
    (let [root (:root (store/read-store directory))]
      (store/transact! directory :put {:key "awai.pack-group/file" :value (pr-str (assoc group :manifest-cid "wrong"))})
      (ensure! (refuses? #(pack/recover directory)) "corrupt published manifest accepted")
      (ensure! (not= root (:root (store/read-store directory))) "control did not publish a tampered root")))
  (prn {:manifest-cid (:cid m) :bytes 2097152 :packs 4 :chunks 32 :negative-cases true :pass true}))
