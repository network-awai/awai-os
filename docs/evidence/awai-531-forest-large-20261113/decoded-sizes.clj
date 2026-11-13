(require '[clojure.edn :as edn])
(import '[java.io RandomAccessFile])
(with-open [r (java.io.PushbackReader. (clojure.java.io/reader ".agent-output/large-study/frames.edn"))]
 (loop [] (when-let [x (edn/read {:eof nil} r)]
  (when-not (.contains (:file x) "random")
   (with-open [f (RandomAccessFile. (:file x) "r")]
    (let [sizes (mapv (fn [offset length]
      (let [b (byte-array length) _ (.seek f offset) _ (.readFully f b)
            p (.start (ProcessBuilder. ^java.util.List ["zstd" "-q" "-d" "-c"]))
            writer (future (with-open [out (.getOutputStream p)] (.write out b)))
            total (with-open [in (.getInputStream p)]
                    (let [buffer (byte-array 8192)] (loop [n 0] (let [k (.read in buffer)] (if (neg? k) n (recur (+ n k)))))))]
       @writer (.waitFor p) (when-not (zero? (.exitValue p)) (throw (ex-info "zstd failed" {}))) total))
      (:frame-offsets x) (:frame-stored-bytes x))]
     (prn {:file (:file x) :decoded-frame-bytes sizes :min (apply min sizes) :max (apply max sizes)}))))
  (recur))))
(shutdown-agents)
