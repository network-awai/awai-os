(ns otehon.kotobase-ref
  "Hosted local Kotobase ref port; block persistence is supplied separately."
  (:require [awai.fs.car :as car] [otehon.storage :as store] [otehon.root-witness :as witness]
            [kotobase.storage.core :as contract]))

(defn- key-for [name]
  (when-not (and (string? name) (<= 1 (count name) 1024))
    (throw (ex-info "invalid ref name" {:type :invalid-ref-name})))
  (str "awai.kotobase-ref/" name))

(defn- cid! [cid]
  (when-not (and (string? cid) (<= 1 (count cid) 256))
    (throw (ex-info "invalid CID" {:type :invalid-ref-cid})))
  (car/parse-cid-str cid)
  (let [raw (car/base32-decode (subs cid 1))
        {:keys [codec digest next-offset]} (car/parse-cid raw)]
    (when-not (and (= cid (car/cid-str raw)) (= next-offset (count raw))
                   (= raw (car/cid-bytes codec digest)))
      (throw (ex-info "noncanonical CID" {:type :invalid-ref-cid}))))
  cid)

(defn- read-ref [dir name]
  (let [{:keys [state root degraded?]} (store/read-store dir)
        value (get state (key-for name))]
    (when degraded?
      (throw (ex-info "degraded store ref unavailable" {:type :degraded-store})))
    (when value {:cid (cid! value) :version (:generation root)})))

(defn open-ref-store
  "Return the canonical IRefStore port for an existing Otehon directory.
  Ref values do not establish that blocks are present, signed or durable;
  compose with a separately qualified IBlockStore before using as a backend.
  An optional verifier throws on rejection under the writer lock, after the
  expected ref matches and before publication. Failures during a write may be
  ambiguous and require ref readback."
  ([dir] (open-ref-store dir nil))
  ([dir verify-target!]
  (when-not (or (nil? verify-target!) (fn? verify-target!))
    (throw (ex-info "invalid target verifier" {:type :invalid-target-verifier})))
  (reify
    contract/IRefStore
    (-read-ref [_ name] (read-ref dir name))
    (-compare-and-set-ref! [_ name expected next]
      (when (some? expected) (cid! expected))
      (cid! next)
      (let [result (store/compare-and-set-value! dir (key-for name) expected next
                     (when verify-target! (fn [_ _] (verify-target! next))))]
        (when-let [current (:current result)] (cid! current))
        result))
    contract/IBackendCapabilities
    (-capabilities [_] #{:conditional-ref :single-writer-ref}))))

(defn- witnessed-snapshot [dir witness-port verify-root!]
  (:snapshot (witness/open-verified! dir witness-port
               #(let [s (store/read-store dir)]
                  (when (:degraded? s) (throw (ex-info "degraded ref store" {:type :degraded-store})))
                  (when-not (true? (verify-root! dir (:state s)))
                    (throw (ex-info "root verification refused" {:type :closure-rejected})))
                  {:basis (:root s) :snapshot s}))))

(defn open-witnessed-ref-store
  "Explicit prepared-witness ref port. VERIFY-ROOT! must fully verify every
  referenced block and closure in the selected state, returning literal true.
  Caller supplies authenticated authority and separately qualified storage."
  [dir witness-port verify-root!]
  (store/validate-write-witness! witness-port)
  (when-not (and (:status! witness-port) (fn? verify-root!))
    (throw (ex-info "prepared witness and verifier required" {:type :invalid-witness})))
  (reify
    contract/IRefStore
    (-read-ref [_ name]
      (let [k (key-for name) {:keys [state root]} (witnessed-snapshot dir witness-port verify-root!)
            value (get state k)]
        (when value {:cid (cid! value) :version (:generation root)})))
    (-compare-and-set-ref! [_ name expected next]
      (let [k (key-for name)]
        (when (some? expected) (cid! expected)) (cid! next)
        (loop [attempt 0]
          (let [{:keys [state root]} (witnessed-snapshot dir witness-port verify-root!) old (get state k)]
            (if (not= expected old)
              {:published? false :current old :version (:generation root)}
              (let [result (try
                             (store/transact-if-generation-witnessed!
                               dir (:generation root) :put {:key k :value next}
                               (fn [d s]
                                 (when-not (true? (verify-root! d (assoc s k next)))
                                   (throw (ex-info "candidate ref refused" {:type :closure-rejected}))))
                               witness-port (fn [d s]
                                              (when-not (true? (verify-root! d s))
                                                (throw (ex-info "published ref refused" {:type :closure-rejected})))
                                              true))
                             (catch Exception e
                               (if (contains? #{:writer-busy :stale-generation} (:type (ex-data e))) :retry (throw e))))]
                (if (= :retry result)
                  (if (< attempt 15) (do (Thread/sleep 10) (recur (inc attempt)))
                      (throw (ex-info "conditional ref did not converge" {:type :writer-busy})))
                  {:published? true :current next :version (:generation result)})))))))
    contract/IBackendCapabilities
    (-capabilities [_] #{:conditional-ref :single-writer-ref})))
