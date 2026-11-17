(ns itonami.gms.cli
  "Offline inspection only. No network, package execution or approval persistence."
  (:require [clojure.edn :as edn]
            [clojure.java.io :as io]
            [itonami.gms.core :as core])
  (:import [java.security MessageDigest]))

(def max-catalog-bytes (* 2 1024 1024))

(defn read-catalog [path]
  (let [file (io/file path)]
    (when-not (and (.isFile file) (<= (.length file) max-catalog-bytes))
      (throw (ex-info "catalog missing or larger than 2 MiB" {})))
    (with-open [reader (java.io.PushbackReader. (io/reader file))]
      (let [opts {:readers {} :default (fn [& _] (throw (ex-info "tagged EDN refused" {})))}
            value (edn/read opts reader)]
        (when-not (= ::eof (edn/read (assoc opts :eof ::eof) reader))
          (throw (ex-info "multiple catalog forms refused" {})))
        value))))

(defn verify-file
  "Compare a local file with a supplied digest. A match is not publisher authentication."
  [expected path]
  (when-not (core/digest? expected) (throw (ex-info "expected lowercase SHA-256 required" {})))
  (when-not (.isFile (io/file path)) (throw (ex-info "artifact missing" {})))
  (let [digest (MessageDigest/getInstance "SHA-256")
        buffer (byte-array 65536)]
    (with-open [in (io/input-stream path)]
      (loop [] (let [n (.read in buffer)]
                 (when (pos? n) (.update digest buffer 0 n) (recur)))))
    (let [actual (apply str (map #(format "%02x" (bit-and 255 %)) (.digest digest)))]
      {:status (if (= expected actual) :digest-match :digest-mismatch)
       :sha256 actual :publisher-authenticity :unverified
       :installation-authority :none})))

(defn run [args]
  (case (first args)
    "contract" (if (= 1 (count args)) [0 core/contract] [2 {:status :usage}])
    "plan" (if (= 6 (count args))
             (let [[_ path app platform runtime abi] args
                   target {:platform (keyword platform) :runtime (keyword runtime) :abi (keyword abi)}
                   result (core/plan (read-catalog path) app target
                                     (quot (System/currentTimeMillis) 1000))]
               [(if (= :plan-only (:status result)) 0 1) result])
             [2 {:status :usage}])
    "verify" (if (= 3 (count args))
               (let [[_ expected path] args result (verify-file expected path)]
                 [(if (= :digest-match (:status result)) 0 1) result])
               [2 {:status :usage}])
    [2 {:status :usage
        :commands ["contract" "plan CATALOG APP PLATFORM RUNTIME ABI" "verify SHA256 LOCAL_FILE"]}]))

(defn -main [& args]
  (let [[code result] (try (run args)
                          (catch Exception _ [2 {:status :invalid-input}]))]
    (prn result)
    (System/exit code)))
