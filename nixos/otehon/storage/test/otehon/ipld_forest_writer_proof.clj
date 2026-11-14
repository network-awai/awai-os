;; Hosted Otehon proof: real pinned compressor; write/read in separate processes.
(require '[awai.fs.car :as car] '[otehon.forest :as forest] '[otehon.forest-writer :as writer]
         '[otehon.ipld-forest :as catalog] '[otehon.storage :as store])
(import '[java.nio.file Files Paths] '[java.security MessageDigest] '[java.util Random])
(def basis "bafyreic73cz5ww6pbthvvyz62szwjs25afgaqr2a6va4xwl344bmfw4iri")
(def fixture (or (System/getenv "IPLD_POLICY_FIXTURE") "nixos/otehon/storage/test/fixtures/prolly-forest/policy.forest"))
(defn check! [v msg] (when-not v (throw (ex-info msg {}))))
(defn blocks []
  (let [archive (Files/readAllBytes (Paths/get fixture (make-array String 0)))
        src (:blocks (car/carv1-decode (:carv1 (forest/open archive))))
        rng (Random. 532174)
        extras (mapv (fn [_]
                       (let [b (byte-array (* 600 1024)) _ (.nextBytes rng b)
                             hash (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") b))]
                         {:cid (car/cid-str (car/cid-bytes car/codec-raw hash)) :bytes b})) (range 2))]
    (let [prolly (mapv (fn [{:keys [cid bytes]}] {:cid (car/cid-str cid) :bytes (byte-array (map unchecked-byte bytes))}) src)]
      (vec (concat (take 9 prolly) extras (drop 9 prolly))))))
(defn kind [f] (try (f) nil (catch Exception e (:type (ex-data e)))))
(let [[mode base tool] *command-line-args* dir (str base "/store")]
  (case mode
    "write" (do
              (check! (.mkdir (java.io.File. base)) "output must not exist")
              (store/init! dir)
              (let [before (:root (store/read-store dir)) bs (blocks)
                    bad (assoc (first bs) :bytes (.getBytes "tampered" "UTF-8"))]
                (check! (= :cid-mismatch (kind #(writer/put-ipld-blocks! dir "test" basis (assoc bs 0 bad) (str base "/bad-stage") tool))) "bad CID was accepted")
                (check! (= :duplicate-cid (kind #(writer/put-ipld-blocks! dir "test" basis (conj bs (first bs)) (str base "/duplicate-stage") tool))) "duplicate accepted")
                (check! (= :untrusted-forest-tool (kind #(writer/put-ipld-blocks! dir "test" basis bs (str base "/untrusted-stage") "/bin/echo"))) "untrusted tool accepted")
                (check! (= before (:root (store/read-store dir))) "failed inputs changed root")
                (let [r (writer/put-ipld-blocks! dir "test" basis bs (str base "/stage") tool)]
                  (check! (= 2 (:archive-count r)) "expected two generated archives")
                  (check! (= 20 (:block-count r)) "expected 20 blocks")
                  (prn {:archives (:archive-count r) :blocks (:block-count r) :invalid-inputs-refused true}))))
    "read" (let [h (catalog/recover-group dir "test") bs (blocks)
                 touched (atom #{}) original store/read-payload-segments]
             (check! (= basis (get-in h [:group :basis-cid])) "basis changed")
             (with-redefs [store/read-payload-segments (fn [d sha ext size spans]
                                                       (swap! touched conj sha) (original d sha ext size spans))]
               (doseq [{:keys [cid bytes]} bs]
                 (check! (java.util.Arrays/equals ^bytes bytes ^bytes (catalog/get-group-block h cid)) "block changed")))
             (check! (= 2 (count @touched)) "both archives not accessed")
             (prn {:recovered true :archives (count @touched) :blocks (count bs) :byte-cid-match true}))
    (throw (ex-info "expected write/read" {:mode mode}))))
