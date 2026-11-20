(ns awai.fs.block-profile
  "Bounded Otehon admission profile over the existing owning codec.
  This declares supported inputs; it defines no new codec, hash or crypto."
  (:require [awai.fs.car :as car]))

(def profile {:version 1 :car-version 2 :index :absent
              :cid-version 1 :multihash :sha2-256
              :leaves :raw :root :awai-pack-v1})
(def max-pack-bytes (* 16 1024 1024))
(def max-leaves 1024)

(defn- fail! [type message] (throw (ex-info message {:type type})))
(defn admit-profile! [value]
  (when-not (= profile value)
    (fail! :awai.fs/unsupported-block-profile "unsupported block profile or version"))
  value)

(defn encode-pack [leaves hash-fn]
  (when (> (count leaves) max-leaves)
    (fail! :awai.fs/pack-too-large "too many Pack leaves"))
  (let [result (car/assemble-pack leaves hash-fn {:index? false})]
    (when (> (count (:car result)) max-pack-bytes)
      (fail! :awai.fs/pack-too-large "Pack exceeds the Otehon byte bound"))
    result))

(defn verify-pack
  "Verify the complete bounded profile, every block CID, root links and
  exact framing. Derived section offsets are never an identity input."
  [value bytes hash-fn]
  (admit-profile! value)
  (let [v (vec bytes) n (count v)]
    (when-not (<= 51 n max-pack-bytes)
      (fail! :awai.fs/invalid-pack "Pack byte extent is outside the supported bound"))
    (when-not (and (= 51 (first (car/decode-u64-le v 27)))
                   (= (- n 51) (first (car/decode-u64-le v 35)))
                   (zero? (first (car/decode-u64-le v 43)))
                   (every? zero? (subvec v 11 27))
                   (<= 1 (first (car/decode-uvarint v 51)) 128))
      (fail! :awai.fs/unsupported-pack "unsupported extents, index, characteristics or header"))
    (let [{:keys [roots blocks]} (car/carv2-decode v)]
      (when-not (and (= 1 (count roots)) (<= 1 (count blocks) (inc max-leaves)))
        (fail! :awai.fs/invalid-pack "Pack needs one root and bounded leaf count"))
      (doseq [{:keys [cid bytes]} blocks]
        (when-not (= (:digest (car/parse-cid cid)) (hash-fn bytes))
          (fail! :awai.fs/cid-mismatch "Pack block differs from its CID")))
      (let [leaves (mapv (fn [{:keys [cid bytes]}]
                           (when-not (= car/codec-raw (:codec (car/parse-cid cid)))
                             (fail! :awai.fs/invalid-pack "Pack leaf is not raw"))
                           {:digest (hash-fn bytes) :bytes bytes})
                         (butlast blocks))
            encoded (encode-pack leaves hash-fn)]
        (when-not (= v (:car encoded))
          (fail! :awai.fs/invalid-pack "Pack root, links, order or framing differ"))
        {:root-cid (first roots)
         :sha (car/hex-encode (hash-fn v))
         :leaves (mapv (fn [section]
                         {:sha (car/hex-encode (:digest section))
                          :offset (+ 51 (:data-offset section)) :length (:length section)})
                       (butlast (car/carv2-sections v)))}))))
