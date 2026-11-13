(require '[awai.fs.car :as car] '[otehon.forest :as forest])
(import '[java.nio.file Files Paths])
(def archive (Files/readAllBytes (Paths/get "nixos/otehon/storage/test/fixtures/prolly-forest/policy.forest" (make-array String 0))))
(def blocks (:blocks (car/carv1-decode (:carv1 (forest/open archive)))))
(doseq [[i batch] (map-indexed vector (partition-all 9 blocks))]
  (let [root (:cid (first batch)) car (car/carv1-encode {:roots [root] :blocks batch})]
    (Files/write (Paths/get (str ".agent-output/policy-split/" i ".car") (make-array String 0)) (byte-array (map unchecked-byte car)) (make-array java.nio.file.OpenOption 0))
    (prn {:pack i :root (car/cid-str root) :blocks (count batch)})))
