(ns storage-efficiency.compare-range
  (:require [otehon.storage :as store] [otehon.pack-store :as pack] [cheshire.core :as json] [clojure.java.io :as io])
  (:import [java.security MessageDigest] [java.util Arrays Random HexFormat]))
(defn sha [^bytes bytes] (.formatHex (HexFormat/of) (.digest (MessageDigest/getInstance "SHA-256") bytes)))
(defn timed [f] (let [t (System/nanoTime) r (f)] [(/ (- (System/nanoTime) t) 1e6) r]))
(defn stats [v] (let [s (vec (sort v)) n (count v) q #(nth s (dec (int (Math/ceil (* n %)))))]
                 {:n n :rawMs v :p50 (q 0.5) :p95 (q 0.95) :p99 (q 0.99)}))
(defn sample [n f] (f) (stats (mapv (fn [_] (first (timed f))) (range n))))
(defn data [kind]
  (let [n (if (= kind "large-entropy") 524288 131109) b (byte-array n)]
    (case kind
      ("entropy" "large-entropy") (.nextBytes (Random. 53120261112) b)
      "pattern" (dotimes [i n] (aset-byte b i (unchecked-byte (mod (+ (* i 19) (quot i 8191)) 256))))
      "json-like" (let [s (.getBytes "{\"kind\":\"bot-status\",\"state\":\"pending\",\"count\":12}\n" "UTF-8")]
                    (dotimes [i n] (aset-byte b i (aget s (mod i (alength s))))))) b))
(defn range-sample [h reader payload offset clear-cache?]
  (let [f (fn []
            (when clear-cache?
              (doseq [[_ entry] @(:index-cache h)]
                (when-let [cache (:decoded-cache entry)] (reset! cache {:order [] :values {}}))))
            (reader h "file" offset 4096))
        expected (Arrays/copyOfRange ^bytes payload offset (+ offset 4096))
        _ (when-not (Arrays/equals expected ^bytes (f)) (throw (ex-info "range mismatch" {})))
        before @(:stats h)
        n (if clear-cache? 7 30)
        elapsed (stats (mapv (fn [_] (first (timed f))) (range n)))
        after @(:stats h)]
    (assoc elapsed :offset offset :length 4096 :verified true
           :bytesReadPerRequest (/ (- (:bytes-read after) (:bytes-read before)) n)
           :applicationAmplification (/ (- (:bytes-read after) (:bytes-read before)) (* 4096.0 n))
           :frameDecodes (- (get after :frame-decodes 0) (get before :frame-decodes 0))
           :decoderProcesses (- (get after :decoder-processes 0) (get before :decoder-processes 0))
           :decodedCache (if clear-cache? "cleared per call; OS cache still warm" "warm after one verified request"))))
(defn bench [root kind representation]
  (let [d (str root "/" kind "-" representation) payload (data kind)
        writer (if (= representation "zstd3") (ns-resolve 'otehon.pack-store 'put-data-zstd3!) pack/put-data!)
        _ (store/init! d)
        [put-ms result] (timed #(writer d "file" payload))
        [checkpoint-ms _] (timed #(pack/checkpoint! d))
        recover-ms (sample 7 #(pack/recover d)) h (pack/recover d)
        canonical (pack/export-car h "file") ref (get-in h [:files "file"])
        _ (when-not (Arrays/equals payload (pack/read-data h "file")) (throw (ex-info "full mismatch" {})))
        fast (ns-resolve 'otehon.pack-store 'read-range-verified-leaves)
        reader (if (= representation "baseline") pack/read-range fast)]
    {:corpus kind :mode representation :payloadBytes (alength payload) :payloadSha256 (sha payload)
     :rootCid (:root-cid ref) :carSha256 (sha canonical) :canonicalCarBytes (alength canonical)
     :storageFormat (:format ref) :storedPayloadBytes (or (:stored-size ref) (alength canonical))
     :compressionDecision (:compression result) :firstPutMs put-ms :checkpointMs checkpoint-ms :recoverMs recover-ms
     :strictControl (range-sample h pack/read-range payload 65000 false)
     :aligned4KiB (range-sample h reader payload 0 false)
     :crossLeaf4KiB (range-sample h reader payload 65000 false)
     :coldDecodedCrossLeaf4KiB (when (= representation "zstd3") (range-sample h reader payload 65000 true))
     :retainedStoreBytes (reduce + (map #(.length %) (filter #(.isFile %) (file-seq (io/file d))))) }))
(let [[mode directory output] *command-line-args*]
  (when-not (and (contains? #{"baseline" "candidate"} mode) output
                 (not (.exists (io/file directory))) (not (.exists (io/file output))))
    (throw (ex-info "usage: compare-range.clj baseline|candidate NEW_DIR NEW_REPORT" {})))
  (.mkdirs (io/file directory))
  (let [start (str (java.time.Instant/now))
        result (vec (for [kind ["pattern" "json-like" "entropy" "large-entropy"]
                          representation (if (= mode "baseline") ["baseline"] ["raw-fast" "zstd3"])]
                      (bench directory kind representation)))]
    (spit output (json/generate-string {:schema "awai.range-zstd3-comparison.v1" :startedAt start
      :endedAt (str (java.time.Instant/now)) :mode mode :runtime (System/getProperty "babashka.version")
      :cache "warm OS cache; isolated new stores; no page-cache flush; shared host load, nice15"
      :tailWarning "n7 and n30 p99 are max; indicative only" :results result} {:pretty true}))
    (println (json/generate-string {:complete true :mode mode :cases (count result)}))))
