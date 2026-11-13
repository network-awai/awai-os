;; Optional hosted integration proof: requires an explicitly pinned Forest tool.
(require '[otehon.storage :as store] '[otehon.pack-store :as pack]
         '[otehon.forest-writer :as writer])
(import '[java.nio.file Files Paths OpenOption LinkOption] '[java.nio.file.attribute FileAttribute]
        '[java.io ByteArrayOutputStream] '[java.util Arrays])
(defn ensure! [v message] (when-not v (throw (ex-info message {}))))
(let [[dir tool] *command-line-args*
      _ (Files/createDirectory (Paths/get dir (make-array String 0)) (make-array FileAttribute 0))
      src (str dir "/source.bin") stage (str dir "/stage") target (str dir "/store")
      data (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256)) (range (* 2 1024 1024))))]
  (Files/write (Paths/get src (make-array String 0)) data (make-array OpenOption 0))
  (store/init! target)
  (let [root (:root (store/read-store target))]
    (ensure! (try (writer/put-file! target "file" src (str dir "/bad-tool-stage") src) false
                  (catch Exception e (= :untrusted-forest-tool (:type (ex-data e))))) "untrusted tool accepted")
    (ensure! (= root (:root (store/read-store target))) "invalid tool changed root"))
  (let [result (writer/put-file! target "file" src stage tool)]
    (ensure! (= "bafyreidqkmghsd65dwq22umpkrqecyamfhevsbq7xemjfe7tb6wnhvxsny" (:manifest-cid result)) "logical CID mismatch")
    (ensure! (= 3 (:pack-count result)) "unexpected Pack count"))
  (let [h (pack/recover target) out (ByteArrayOutputStream.)]
    (doseq [offset (range 0 (alength data) 524288)]
      (.write out ^bytes (pack/read-group-range h "file" offset (min 524288 (- (alength data) offset)))))
    (ensure! (Arrays/equals data (.toByteArray out)) "restored bytes differ"))
  (let [failed (str dir "/failure-store") _ (store/init! failed)
        before (:root (store/read-store failed)) triggered (atom false)]
    (binding [store/*write-observer* (fn [event role]
                                     (when (and (= [event role] [:renamed :forest])
                                                (compare-and-set! triggered false true))
                                       (throw (ex-info "injected interruption" {:type :injected}))))]
      (ensure! (try (writer/put-file! failed "file" src (str dir "/failure-stage") tool) false
                    (catch Exception e (= :injected (:type (ex-data e))))) "failure not propagated"))
    (ensure! @triggered "failure boundary not reached")
    (ensure! (= before (:root (store/read-store failed))) "interrupted import published root"))
  (prn {:bytes (alength data) :packs 3 :logical-cid-match true :untrusted-tool-rejected true
        :interrupted-root-unchanged true :roundtrip true :pass true}))
