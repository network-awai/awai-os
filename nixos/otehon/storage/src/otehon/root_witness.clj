(ns otehon.root-witness
  "Fail-closed read admission against a host-owned, store-bound witness.

  The witness must be independent of the rollback domain and trustworthy. A
  callback, local file, or same-volume copy does not by itself provide that
  property. This checks a snapshot on open, not subsequent revocation."
  (:require [otehon.storage :as store]))

(defn- fail! [type message] (throw (ex-info message {:type type})))
(defn- witness-root! [witness]
  (let [status (when (map? witness) ((:status! witness)))
        _ (when (and (map? witness) (not (and (map? status) (= #{:root :pending} (set (keys status))))))
            (fail! :invalid-witness "invalid prepared witness status"))
        _ (when (and status (some? (:pending status))) (fail! :witness-pending "prepared root requires reconciliation"))
        root (if (map? witness) (:root status) (witness))]
    (when-not (and (map? root)
                   (= #{:format :generation :checkpoint :tail :snapshot :log} (set (keys root)))
                   (= :awai.otehon-store/root-v1 (:format root))
                   (integer? (:generation root)) (pos? (:generation root)))
      (fail! :invalid-witness "trusted witness did not return a root identity"))
    root))

(defn open-verified!
  "Read a store-bound witness, compare a local root, open and verify the
  snapshot, then re-read the witness. No handle is returned on mismatch.
  The host owns witness authentication, durability, binding and freshness."
  [directory witness open!]
  (when-not (and (or (fn? witness) (and (map? witness) (fn? (:status! witness)))) (fn? open!))
    (fail! :invalid-witness "witness and opener functions are required"))
  (let [expected (witness-root! witness)
        local (store/read-store directory)]
    (when (:degraded? local) (fail! :degraded-store "invalid root slot"))
    (when-not (= expected (:root local))
      (fail! :witness-mismatch "local root does not match trusted witness"))
    (let [handle (open!)
          _ (when-not (= expected (:basis handle))
              (fail! :witness-mismatch "opened snapshot differs from trusted witness"))
          current (witness-root! witness)]
      (when-not (= expected current)
        (fail! :witness-changed "trusted witness changed while opening snapshot"))
      handle)))
