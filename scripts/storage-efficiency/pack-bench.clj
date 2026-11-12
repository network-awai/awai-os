(ns storage-efficiency.pack-bench
  (:require [otehon.storage :as store] [otehon.pack-store :as pack]
            [cheshire.core :as json] [clojure.java.io :as io])
  (:import [java.nio.file Files Paths] [java.security MessageDigest] [java.util Arrays Random]))
(defn sha [^bytes b] (apply str (map #(format "%02x" (bit-and 255 %)) (.digest (MessageDigest/getInstance "SHA-256") b))))
(defn now [] (System/nanoTime))
(defn timed [f] (let [t (now) result (f)] [(/ (- (now) t) 1e6) result]))
(defn distribution [values]
  (let [v (vec (sort values)) n (count v) q #(nth v (dec (int (Math/ceil (* n %)))))]
    {:n n :rawMs (vec values) :min (first v) :p50 (q 0.5) :p95 (q 0.95) :p99 (q 0.99) :max (last v)}))
(defn sample [n f] (f) (distribution (mapv (fn [_] (first (timed f))) (range n))))
(def size 131109)
(defn data [kind size]
  (let [b (byte-array size)]
    (case kind
      ("entropy" "large-entropy") (.nextBytes (Random. 53120261112) b)
      "pattern" (dotimes [i size] (aset-byte b i (unchecked-byte (mod (+ (* i 19) (quot i 8191)) 256))))
      "json-like" (let [text (.getBytes "{\"kind\":\"bot-status\",\"state\":\"pending\",\"count\":12}\n" "UTF-8")]
                    (dotimes [i size] (aset-byte b i (aget text (mod i (alength text))))))) b))
(defn bench [root kind]
  (let [directory (str root "/" kind) size (if (= kind "large-entropy") 524288 size) payload (data kind size)
        _ (store/init! directory)
        puts (mapv (fn [_] (first (timed #(pack/put-data! directory "public" payload)))) (range 7))
        checkpoint (first (timed #(pack/checkpoint! directory)))
        recovery (sample 7 #(pack/recover directory))
        h (pack/recover directory)
        car (pack/export-car h "public")
        ref (get-in h [:files "public"])
        _ (when-not (Arrays/equals payload (pack/read-data h "public")) (throw (ex-info "roundtrip" {})))
        range-offset 65000 range-size 4096
        range-expected (Arrays/copyOfRange payload range-offset (+ range-offset range-size))
        _ (when-not (Arrays/equals range-expected (pack/read-range h "public" range-offset range-size)) (throw (ex-info "range mismatch" {})))
        _ (pack/read-range h "public" range-offset range-size)
        before @(:stats h)
        ranges (distribution (mapv (fn [_] (first (timed #(pack/read-range h "public" range-offset range-size)))) (range 30)))
        after @(:stats h)
        read-bytes (- (:bytes-read after) (:bytes-read before))
        full (sample 30 #(pack/read-data h "public"))
        all (filter #(.isFile %) (file-seq (io/file directory)))
        physical (reduce + (map #(.length %) all))]
    {:corpus kind :payloadBytes size :payloadSha256 (sha payload)
     :rootCid (:root-cid ref) :carSha256 (sha car) :carBytes (alength car)
     :framingBytes (- (alength car) size) :framingPercent (* 100.0 (/ (- (alength car) size) size))
     :leafCount (:leaf-count ref) :retainedStoreBytes physical :retainedStoreFiles (count all)
     :retainedMetadataBytes (- physical (alength car))
     :firstPutMs (first puts) :repeatPutMs (distribution (rest puts)) :putMs (distribution puts) :checkpointMs checkpoint :recoverMs recovery
     :range4KiBMs ranges :fullReadMs full
     :rangeReadBytesPerRequest (/ read-bytes 30) :rangeReadAmplification (/ read-bytes (* 30.0 range-size))
     :recoverStats (:stats (pack/summary (pack/recover directory)))
     :fullAndRangeBytesVerified true :cacheScope "warm OS page cache; recovery resets process-local derived index; no disk cache flush"
     :percentileCaution "nearest-rank; n7 p95/p99 are max, not stable tail estimates"}))
(let [[directory output] *command-line-args*]
  (when-not output (throw (ex-info "usage: pack-bench.clj NEW_SCRATCH_DIR NEW_REPORT" {})))
  (when (.exists (io/file directory)) (throw (ex-info "existing output directory refused" {})))
  (.mkdirs (io/file directory))
  (let [result {:schema "awai.fs-efficiency.pack.v1" :observedAt (str (java.time.Instant/now))
                :runtime (System/getProperty "babashka.version") :sourceRevision "8181b8f29d68b490a8bdd1518bdd58f76113126c"
                :scope "bounded-isolated-Otehon-hosted-CARv2-indexless-public-fixtures"
                :unit "ms unless bytes/percent declared" :results (mapv #(bench directory %) ["pattern" "json-like" "entropy" "large-entropy"])}]
    (with-open [w (io/writer output)] (.write w (json/generate-string result {:pretty true})))
    (println (json/generate-string {:completed true :corpora 4 :output output}))))
