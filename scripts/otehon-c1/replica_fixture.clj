(ns otehon-c1.replica-fixture
  "Public-data-only, host-file durability experiment. Never a distributed writer,
  storage-provider authorization, encryption layer or production repair daemon."
  (:require [cheshire.core :as json]
            [otehon.storage :as store]
            [otehon.pack-store :as pack])
  (:import [java.nio ByteBuffer]
           [java.nio.channels FileChannel]
           [java.nio.file Files Paths OpenOption StandardOpenOption LinkOption]
           [java.nio.file.attribute FileAttribute PosixFilePermissions]
           [java.security MessageDigest]
           [java.util Arrays]))

(def name "AWAI-2776-public-fixture")
(defn path [s] (Paths/get (str s) (make-array String 0)))
(defn fixture []
  (byte-array (map #(unchecked-byte (mod (+ (* % 19) (quot % 8191)) 256))
                   (range (+ (* 2 pack/leaf-size) 37)))))
(defn sha [bytes]
  (apply str (map #(format "%02x" (bit-and 255 %))
                  (.digest (MessageDigest/getInstance "SHA-256") bytes))))
(defn new-dir! [p]
  (Files/createDirectory (path p)
    (into-array FileAttribute [(PosixFilePermissions/asFileAttribute
                                (PosixFilePermissions/fromString "rwx------"))])))
(defn write-new! [p bytes]
  (with-open [f (FileChannel/open (path p)
                   #{StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE}
                   (into-array FileAttribute [(PosixFilePermissions/asFileAttribute
                                               (PosixFilePermissions/fromString "rw-------"))]))]
    (let [b (ByteBuffer/wrap bytes)]
      (while (.hasRemaining b) (.write f b)))
    (.force f true)))

(defn read! [directory]
  (let [h (pack/recover directory)
        bytes (pack/read-data h name)
        ref (get-in h [:files name])]
    (when-not (Arrays/equals ^bytes bytes ^bytes (fixture))
      (throw (ex-info "public fixture mismatch" {:type :unexpected-fixture})))
    {:root-cid (:root-cid ref) :car-sha (:car-sha ref)
     :payload-sha (sha bytes) :bytes (alength ^bytes bytes)
     :leaf-count (:leaf-count ref) :degraded? (:degraded? h)
     :scope "fresh-process-hosted-pack-recovery" :production-ready false}))

(defn seed! [directory]
  (new-dir! directory)
  (let [d (str directory "/store")]
    (store/init! d)
    (pack/put-data! d name (fixture))
    (pack/checkpoint! d)
    (write-new! (str directory "/fixture.car") (pack/export-car (pack/recover d) name))
    (read! d)))

(defn import! [directory car-file]
  ;; This helper is deliberately restricted to the deterministic PUBLIC fixture.
  ;; The owning codec validates every block, linkage and framing during import.
  (store/init! directory)
  (let [p (path car-file)]
    (when (or (Files/isSymbolicLink p) (> (Files/size p) pack/max-car-bytes))
      (throw (ex-info "unsupported fixture input" {:type :invalid-input})))
    (pack/import-car! directory name (Files/readAllBytes p)))
  (pack/checkpoint! directory)
  (read! directory))

(defn corrupt-copy! [directory destination]
  ;; Only a newly created clone is damaged. Preserve the original and all bad
  ;; evidence; staged restoration uses another new directory, never a reset.
  (let [verified (read! directory) dest (path destination)]
    ;; Re-import just this public Pack. Never copy unrelated metadata/orphans
    ;; from a directory that might contain other historical content.
    (store/init! destination)
    (pack/import-car! destination name (pack/export-car (pack/recover directory) name))
    (pack/checkpoint! destination)
    (let [car (.resolve dest (str (:car-sha verified) ".car"))]
      ;; Physical filename is a test-only dependency on this pinned host adapter.
      (when-not (Files/exists car (make-array LinkOption 0))
        (throw (ex-info "fixture CAR location changed" {:type :layout-changed})))
      (let [bytes (Files/readAllBytes car)]
        (aset-byte bytes (dec (alength bytes)) (unchecked-byte (bit-xor 1 (aget bytes (dec (alength bytes))))))
        (Files/write car bytes (into-array OpenOption [StandardOpenOption/WRITE StandardOpenOption/TRUNCATE_EXISTING]))))
    {:clone-corrupted true :source-unchanged (= verified (read! directory))}))

(defn -main [& [command directory file]]
  (println (json/generate-string
    (case command
      "seed" (seed! directory)
      "read" (read! directory)
      "import" (import! directory file)
      "corrupt-copy" (corrupt-copy! directory file)
      (throw (ex-info "usage: replica_fixture.clj seed NEW_DIR | read STORE | import NEW_STORE CAR | corrupt-copy STORE NEW_CLONE" {}))))))

(when (= *file* (System/getProperty "babashka.file"))
  (try (apply -main *command-line-args*)
       (catch Exception e
         ;; Application status is explicit: do not trust a host CLI wrapper's
         ;; exit status to classify a storage refusal. Omit private diagnostics.
         (println (json/generate-string {:result "refused" :error-type (or (:type (ex-data e)) :unknown)}))
         (System/exit 2))))
