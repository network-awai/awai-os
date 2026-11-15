;; Hosted generic file verifier: incompressible 1 MiB block and corruption.
(require '[awai.fs.car :as car] '[otehon.forest :as forest]
         '[otehon.ipld-forest :as ipld] '[otehon.storage :as store])
(import '[java.nio.file Files Paths OpenOption StandardOpenOption] '[java.security MessageDigest] '[java.util Arrays Random])
(defn ensure! [x message] (when-not x (throw (ex-info message {}))))
(defn refused? [f] (try (f) false (catch Exception _ true)))
(defn read-range [path offset length]
  (with-open [f (java.io.RandomAccessFile. path "r")]
    (.seek f offset) (let [b (byte-array length)] (.readFully f b) b)))
(let [[base tool] *command-line-args*]
  (ensure! (.mkdir (java.io.File. base)) "fresh output directory required")
  (let [payload (byte-array (* 1024 1024)) _ (.nextBytes (Random. 1457) payload)
        digest (mapv #(bit-and 255 %) (.digest (MessageDigest/getInstance "SHA-256") payload))
        cid (car/cid-bytes car/codec-raw digest)
        bytes (byte-array (map unchecked-byte (car/carv1-encode {:roots [cid] :blocks [{:cid cid :bytes (mapv #(bit-and 255 %) payload)}]})))
        carpath (str base "/data.car") out (str base "/data.forest")]
    (Files/write (Paths/get carpath (make-array String 0)) bytes (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))
    (let [p (.start (doto (ProcessBuilder. ^java.util.List [tool "snapshot" "compress" carpath "--output-path" out "--frame-size" "1"])
                      (.redirectErrorStream true) (.redirectOutput (java.io.File. (str base "/forest.log")))))]
      (ensure! (.waitFor p 120 java.util.concurrent.TimeUnit/SECONDS) "compress timeout")
      (ensure! (zero? (.exitValue p)) "compress failed"))
    (let [h (forest/verify-generic-file out) frame (first (keys (:frame-sha h)))
          read! #(read-range out %1 %2)]
      (ensure! (> (:size h) (* 1024 1024)) "fixture compressed below old archive bound")
      (ensure! (= [cid] (:roots h)) "root mismatch")
      (ensure! (Arrays/equals payload (forest/get-block-from h cid read!)) "block mismatch")
      (ensure! (refused? #(forest/get-block-from h cid (fn [offset length]
                 (let [b (read! offset length)] (aset-byte b 0 (unchecked-byte (bit-xor 1 (aget b 0)))) b)))) "changed frame accepted")
      (let [bad (str base "/bad.forest") copy (Files/readAllBytes (Paths/get out (make-array String 0)))]
        (aset-byte copy (int (+ frame 3)) (unchecked-byte (bit-xor 1 (aget copy (int (+ frame 3))))))
        (Files/write (Paths/get bad (make-array String 0)) copy (into-array OpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))
        (ensure! (refused? #(forest/verify-generic-file bad)) "corrupt archive accepted"))
      (let [dir (str base "/store") other "nixos/otehon/storage/test/fixtures/prolly-forest/prolly.forest"
            other-root (car/cid-str (first (:roots (forest/verify-generic-file other))))
            root-cid (car/cid-str cid) entries [{:path out :root-cid root-cid} {:path other :root-cid other-root}]]
        (store/init! dir)
        (let [old (:root (store/read-store dir)) generation (:generation old)]
          (ensure! (refused? #(ipld/publish-file-group! dir "g" root-cid entries (inc generation))) "stale generation accepted")
          (ensure! (= old (:root (store/read-store dir))) "stale write changed root")
          (let [original store/write-forest-file! calls (atom 0)]
            (with-redefs [store/write-forest-file! (fn [& args]
                                                   (if (= 2 (swap! calls inc))
                                                     (throw (ex-info "injected second-object failure" {}))
                                                     (apply original args)))]
              (ensure! (refused? #(ipld/publish-file-group! dir "g" root-cid entries generation)) "interrupted publication accepted"))
            (ensure! (= old (:root (store/read-store dir))) "interrupted publication changed root"))
          (ipld/publish-file-group! dir "g" root-cid entries generation)
          (let [handle (ipld/recover-group dir "g") ref (first (get-in handle [:group :archives]))]
            (ensure! (= 2 (count (get-in handle [:group :archives]))) "two archives not published")
            (ensure! (Arrays/equals payload (ipld/get-group-block handle root-cid)) "recovered block mismatch")
            (ensure! (some? (ipld/get-group-block handle other-root)) "second archive root missing")
            (let [path (store/forest-file-path dir (:archive-sha ref))]
              (with-open [f (java.io.RandomAccessFile. path "rw")]
                (.seek f (+ frame 3)) (let [v (.read f)] (.seek f (+ frame 3)) (.write f (bit-xor 1 v))))
              (ensure! (refused? #(ipld/get-group-block handle root-cid)) "selected corruption accepted")
              (ensure! (refused? #(ipld/recover-group dir "g")) "committed corruption accepted")
              (Files/move (Paths/get path (make-array String 0)) (Paths/get (str path ".withheld") (make-array String 0)) (make-array java.nio.file.CopyOption 0))
              (ensure! (refused? #(ipld/recover-group dir "g")) "missing archive accepted")))))
      (prn {:block-bytes (alength payload) :forest-bytes (:size h) :cid (car/cid-str cid) :changed-frame :refused :corrupt-archive :refused :pass true}))))
(shutdown-agents)
