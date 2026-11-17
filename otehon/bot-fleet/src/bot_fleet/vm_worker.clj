(ns bot-fleet.vm-worker
  "Fixed-command Otehon VM worker. Shared etcd owns admission; Awai Pack owns
  durable public results. No model, shell, caller paths or implicit takeover."
  (:require [clojure.edn :as edn] [clojure.java.io :as io]
            [itonami.otehon.occurrence :as o] [itonami.otehon.etcd :as e]
            [itonami.otehon.io :as hash] [itonami.otehon.recurring-host :as d]
            [itonami.otehon.physics.runner :as physics] [otehon.pack-store :as pack]))
(def max-packet (* 1500 1024))
(defn read-data [text]
  (with-open [r (java.io.PushbackReader. (java.io.StringReader. text))]
    (let [opts {:eof ::end :readers {} :default (fn [& _] (throw (ex-info "tag refused" {})))}
          value (edn/read opts r)]
      (when-not (= ::end (edn/read opts r)) (throw (ex-info "one value required" {}))) value)))
(defn input-sha [en]
  (o/digest (select-keys en [:vm-spec-sha :vm-repository :vm-runtime-revision])))
(defn checked-enrollment [cfg client request]
  (let [ks (o/keys-for (:bot-id request) (:job-id request) (:slot request))
        en ((:read client) (:enrollment ks))]
    (when-not (and (o/enrollment-valid? en)
                  (= "physical-simulation" (get-in en [:grant :job-kind]))
                  (= "awai-vm-physics-v1" (:vm-executor en))
                  (= (:runtime-revision cfg) (:vm-runtime-revision en))
                  (= (:input-sha request) (input-sha en))
                  (re-matches #"[a-f0-9]{64}" (str (:vm-spec-sha en)))
                  (some #{(:authenticated-node client)} (:nodes en)))
      (throw (ex-info "VM work binding refused" {}))) en))
(defn paths [cfg request]
  (let [name (o/digest request) root (:state-root cfg)]
    {:name name :dir (str root "/runs/" name) :store (str root "/packs")}))
(defn persist-result! [cfg en request measurement]
  (let [{:keys [name dir store]} (paths cfg request)
        payload (pr-str {:schema "awai.vm-physics-result.v1" :request request
                         :node (:node cfg) :runtime (:runtime-revision cfg)
                         :spec-sha (:vm-spec-sha en) :measurement measurement})
        data (.getBytes payload "UTF-8")
        previous (get-in (pack/summary (pack/recover store)) [:files name])]
    (when (and previous (not= payload (String. (pack/read-data (pack/recover store) name) "UTF-8")))
      (throw (ex-info "original Pack result changed" {})))
    (when-not previous (pack/put-data! store name data))
    (pack/checkpoint! store)
    (let [handle (pack/recover store) ref (get-in (pack/summary handle) [:files name])
          _ (assert (= payload (String. (pack/read-data handle name) "UTF-8")))
          result {:state "completed" :provider "none" :model "deterministic" :binding request
                  :text (pr-str {:node (:node cfg) :pack ref :name name
                                 :status (:status measurement) :scope (:scope measurement)
                                 :probe-summary (select-keys (:probe measurement) [:count :expected])})}]
      (d/durable! (str dir "/result.edn") (pr-str result)) result)))
(defn run! [cfg client packet]
  (let [request (:request packet) en (checked-enrollment cfg client request)
        text (:spec-text packet)
        _ (when-not (and (string? text) (<= (count (.getBytes text "UTF-8")) 65536)
                         (= (:vm-spec-sha en) (hash/sha256-utf8 text)))
            (throw (ex-info "pinned spec required" {})))
        spec (read-data text) _ (physics/validate! spec (:vm-repository en))
        {:keys [dir]} (paths cfg request)]
    (o/dispatch!
      (assoc client :invoke-once
        (fn []
          (d/private-dir! dir)
          (when (.exists (io/file (str dir "/intent.edn")))
            (throw (ex-info "original outcome requires recovery" {})))
          (d/durable! (str dir "/request.edn") (pr-str request))
          (d/durable! (str dir "/intent.edn") (pr-str {:single-start true :request-sha (o/digest request)}))
          (let [measurement (physics/simulate spec (:vm-repository en))]
            (d/durable! (str dir "/measurement.edn") (pr-str measurement))
            (persist-result! cfg en request measurement))))
      request (:authenticated-node client) (System/currentTimeMillis))))
(defn recover! [cfg client request]
  (let [en (checked-enrollment cfg client request)
        ks (o/keys-for (:bot-id request) (:job-id request) (:slot request))
        claim ((:read client) (:occurrence ks)) {:keys [dir]} (paths cfg request)]
    (when-not (and claim (= request (:request claim)) (= (:authenticated-node client) (:node claim)))
      (throw (ex-info "original VM owner required" {})))
    (if (= "completed" (:state claim)) {:state "already-completed" :record claim :invoked false}
      (let [_ (when-not (= request (d/saved (str dir "/request.edn")))
                (throw (ex-info "original request missing" {})))
            result (or (d/saved (str dir "/result.edn"))
                       (when-let [m (d/saved (str dir "/measurement.edn"))]
                         (persist-result! cfg en request m)))]
        (when-not (= request (:binding result)) (throw (ex-info "original result missing" {})))
        (o/reconcile! client request claim result)))))
(defn completed! [cfg client request]
  (checked-enrollment cfg client request)
  (let [r ((:read client) (:occurrence (o/keys-for (:bot-id request) (:job-id request) (:slot request))))]
    (when-not (and (= "completed" (:state r)) (= request (:request r)))
      (throw (ex-info "completed occurrence required" {}))) r))
(defn export! [cfg client request]
  (let [claim (completed! cfg client request) {:keys [name store]} (paths cfg request)
        handle (pack/recover store) bytes (pack/export-car handle name)]
    {:state "exported" :node (:node cfg) :owner (:node claim)
     :ref (get-in (pack/summary handle) [:files name])
     :car (.encodeToString (java.util.Base64/getEncoder) bytes)}))
(defn replicate! [cfg client request encoded]
  (let [claim (completed! cfg client request) metadata (read-data (get-in claim [:result :text]))
        {:keys [name store]} (paths cfg request)
        _ (when-not (and (string? encoded) (<= (count encoded) 1400000))
            (throw (ex-info "bounded CAR required" {})))
        bytes (.decode (java.util.Base64/getDecoder) ^String encoded)
        _ (when-not (<= (alength bytes) pack/max-car-bytes) (throw (ex-info "CAR limit" {})))
        ;; Catalog reference binds every CAR byte; import verifies every CID/link.
        _ (when-not (= (get-in metadata [:pack :car-sha])
                       (let [digest (java.security.MessageDigest/getInstance "SHA-256")]
                         (apply str (map #(format "%02x" (bit-and 255 %)) (.digest digest bytes)))))
            (throw (ex-info "completed CAR digest required" {})))
        old (get-in (pack/summary (pack/recover store)) [:files name])]
    (when (and old (not= old (:pack metadata))) (throw (ex-info "replica collision" {})))
    (when-not old (pack/import-car! store name bytes))
    (pack/checkpoint! store)
    (let [h (pack/recover store) result (read-data (String. (pack/read-data h name) "UTF-8"))]
      (when-not (= request (:request result)) (throw (ex-info "replica request mismatch" {})))
      {:state "replicated" :node (:node cfg) :owner (:node claim)
       :ref (get-in (pack/summary h) [:files name]) :readback true})))
(defn handle! [cfg client packet]
  (when-not (and (map? packet) (map? (:request packet))
                (every? #{:op :request :spec-text :car} (keys packet)))
    (throw (ex-info "fixed packet required" {})))
  (case (:op packet)
    "run" (run! cfg client packet)
    "recover" (recover! cfg client (:request packet))
    "export" (export! cfg client (:request packet))
    "replicate" (replicate! cfg client (:request packet) (:car packet))
    (throw (ex-info "fixed operation required" {}))))
(defn -main [& [config-path]]
  (try
    (let [cfg (read-data (slurp config-path)) client (e/client (:etcd cfg))
          input (.readNBytes System/in (inc max-packet))]
      (when (> (alength input) max-packet) (throw (ex-info "packet too large" {})))
      (when-not (= (:node cfg) (:authenticated-node client)) (throw (ex-info "node mismatch" {})))
      (prn (handle! cfg client (read-data (String. input "UTF-8")))))
    (catch Exception _ (prn {:state "refused" :reason "vm-binding-or-original-result-unconfirmed"}))))
