(ns otehon.kotobase-ref
  "Hosted local Kotobase ref port; block persistence is supplied separately."
  (:require [awai.fs.car :as car] [otehon.storage :as store]
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
