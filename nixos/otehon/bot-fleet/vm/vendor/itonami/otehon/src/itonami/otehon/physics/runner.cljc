(ns itonami.otehon.physics.runner
 "Bounded Otehon simulation only. No source test/growth/land or actuation."
 (:require [clojure.edn :as edn] [itonami.otehon.io :as io]
  [itonami.otehon.physics.process :as p] [itonami.otehon.physics.process.transport :as transport]
  [itonami.otehon.physics.process.thermal :as thermal] [itonami.otehon.physics.process.fluid :as fluid]
  [itonami.otehon.physics.process.manipulator :as manipulator]
  [itonami.otehon.recurring-host :as durable]))
(defn finite? [n] (and (number? n) (Double/isFinite (double n)) (<= (Math/abs (double n)) 1.0e12)))
(defn data? [v]
 (cond (number? v) (finite? v) (or (nil? v) (boolean? v) (keyword? v)) true
       (string? v) (<= (count v) 8192)
       (map? v) (and (<= (count v) 100) (every? keyword? (keys v)) (every? data? (vals v)))
       (vector? v) (and (<= (count v) 128) (every? data? v)) :else false))
(defn cost [kind params]
 (case kind
  :transport (let [v (merge transport/defaults params)] (/ (:max-time-s v) (:dt-s v)))
  :manipulator (let [v (merge manipulator/defaults params)]
                 (when-not (and (pos? (:duration-s v)) (<= 1 (:steps v) 10000)
                                (every? #(and (vector? %) (= 2 (count %))) [(:from v) (:to v)]))
                   (throw (ex-info "arm budget invalid" {}))) (:steps v))
  :tank-drain (let [v (merge fluid/tank-defaults params)] (/ (:max-time-s v) (:dt-s v)))
  :pipe-flow 40
  :thermal (let [{:keys [nodes thickness-m density-kg-m3 specific-heat-j-kgk conductivity-w-mk duration-s
                        front-fixed? back-fixed? h-front-w-m2k h-back-w-m2k]}
                  (merge thermal/defaults params)
                 _ (when-not (and (integer? nodes) (<= 3 nodes 129) (<= 0 duration-s 86400)
                                  (every? pos? [thickness-m density-kg-m3 specific-heat-j-kgk conductivity-w-mk]))
                      (throw (ex-info "thermal budget invalid" {})))
                 dx (/ thickness-m (dec nodes)) alpha (/ conductivity-w-mk (* density-kg-m3 specific-heat-j-kgk))
                 dt (min (/ (* 0.35 dx dx) alpha)
                         (if (and (not front-fixed?) (pos? h-front-w-m2k)) (/ (* 0.1 density-kg-m3 specific-heat-j-kgk dx) h-front-w-m2k) 1e30)
                         (if (and (not back-fixed?) (pos? h-back-w-m2k)) (/ (* 0.1 density-kg-m3 specific-heat-j-kgk dx) h-back-w-m2k) 1e30))]
             (* nodes (/ duration-s dt)))
  (throw (ex-info "unsupported Otehon physics kind" {}))))
(defn validate! [spec repository]
 (when-not (and (data? spec) (= repository (:repo spec)) (empty? (p/spec-problems spec))
                (vector? (:cases spec)) (<= 1 (count (:cases spec)) 8)
                (<= (reduce + (map #(count (get-in % [:sweep :values])) (:cases spec))) 128))
  (throw (ex-info "pinned bounded physics spec required" {})))
 (let [work
       (reduce +
        (for [c (:cases spec)
              :let [xs (get-in c [:sweep :values]) boundary (:boundary c) n (or (:iterations boundary) 20)
                    _ (when-not (and (<= 1 (count xs) 32) (integer? n) (<= 0 n 20))
                        (throw (ex-info "sweep budget invalid" {})))
                    params #(merge (:params c) {(get-in c [:sweep :param]) %})
                    estimates (map #(cost (:kind c) (params %))
                                   (concat xs (when boundary [(:lo boundary) (:hi boundary)])))]]
         (do (when-not (every? #(and (finite? %) (<= 0 % 50000000)) estimates)
               (throw (ex-info "solver budget invalid" {})))
             (* (reduce max estimates) (+ (count xs) (if boundary (+ 2 n) 0))))))]
  (when-not (<= 0 work 100000000) (throw (ex-info "total simulation budget exceeded" {})))) spec)
(defn finite-output? [v]
 (cond (number? v) (Double/isFinite (double v)) (map? v) (every? finite-output? (vals v))
       (sequential? v) (every? finite-output? v) :else true))
(defn simulate [spec repository]
 (validate! spec repository)
 (let [raw (p/probe spec) r (if (finite-output? raw) raw
                            {:physics-probe/schema p/probe-schema :repo repository :count nil :expected (:expected raw)
                             :problems ["nonfinite-solver-output"] :runs []})
       measured (and (number? (:count r)) (pos? (:expected r)) (= (:count r) (:expected r)))]
  {:schema "itonami.otehon.physics-measurement.v1" :scope "pinned-otehon-simulation-only"
   :status (if measured "measured" "unobserved") :probe r :native-tests "unmeasured"
   :growth "held" :actuation "disabled"}))
(defn -main [& [input digest repository output request-sha]]
 (when-not (re-matches #"[a-f0-9]{64}" (str request-sha)) (throw (ex-info "request fingerprint required" {})))
 (let [text (slurp input)]
  (when-not (and (<= (count (.getBytes text "UTF-8")) 65536) (= digest (io/sha256-utf8 text)))
   (throw (ex-info "spec digest/size mismatch" {})))
  (let [spec (edn/read-string {:readers {} :default (fn [_ _] (throw (ex-info "tagged input forbidden" {})))} text)
        r (assoc (simulate spec repository) :request-sha request-sha :spec-sha digest)]
   (durable/durable! output (pr-str r))
   (println (pr-str (dissoc r :probe))))))
