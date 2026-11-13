;; Guest reboot probe for the actual bounded Pack group API.
(require '[otehon.pack-store :as pack] '[otehon.storage :as store]
         '[otehon.segmented :as segmented])
(import '[java.nio.file Files Paths])
(defn ensure! [v] (when-not v (throw (ex-info "reboot probe failed" {}))))
(def fixtures (or (System/getenv "CROSSPACK_FIXTURES") "nixos/otehon/storage/test/fixtures/crosspack"))
(defn files [] (mapv #(Files/readAllBytes (Paths/get (str fixtures "/part-" % ".forest.car.zst") (make-array String 0))) (range 4)))
(let [[mode dir] *command-line-args*]
  (case mode
    "create" (do (store/init! dir) (pack/import-forest-group! dir "reboot" (files)) (println "created"))
    "read" (let [h (pack/recover dir)
                 refs (get-in (pack/summary h) [:groups "reboot" :packs])
                 offset (- (* 8 65536) 20)
                 expected (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256))
                                           (range offset (+ offset 40))))]
             (ensure! (= (mapv segmented/sha (files)) (mapv :stored-sha refs)))
             (ensure! (= 0 (get-in (pack/summary h) [:stats :cache-entries-before])))
             (ensure! (java.util.Arrays/equals expected (pack/read-group-range h "reboot" offset 40)))
             (println "recovered-four-packs-and-cross-boundary-range"))
    (throw (ex-info "use create or read" {}))))
