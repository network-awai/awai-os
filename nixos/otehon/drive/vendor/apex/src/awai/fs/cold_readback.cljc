(ns awai.fs.cold-readback
  "AWAI-534 cold-readback evidence (record-only): offline verifier for one
  independent cold readback.

  A cold readback starts with an empty cache and performs a single remote
  range fetch (the caller injects `get-range`, e.g. a memory backend's
  `:get-range` standing in for the HTTP range GET). Fetched bytes are
  verified BEFORE any success is reported: a short read (wrong byte count
  or nil) is refused with :awai.fs/short-read, and a length-correct but
  content-wrong payload is refused with :awai.fs/cid-mismatch. Only
  verified bytes produce the evidence receipt.

  Checksums reuse `awai.fs.remote/bytes-sha256` (hosted SHA-256 hex, not a
  new CID encoding). No network, no cache mutation, no production
  qualification is claimed: this is the offline unit beneath the live
  cold-readback drill, which stays out of scope until it is executed."
  (:require [awai.fs.remote :as remote]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn verify-bytes!
  "Verify raw `bytes` against `expected-length` and `expected-sha`.
  Returns the byte count on success. Refuses short/corrupt input before
  any success receipt can be built."
  [bytes expected-length expected-sha]
  (when (or (nil? bytes) (not= expected-length (count bytes)))
    (fail! :awai.fs/short-read "awai fs: incomplete cold-readback fetch" {}))
  (when (not= expected-sha (remote/bytes-sha256 (vec bytes)))
    (fail! :awai.fs/cid-mismatch "awai fs: cold-readback chunk checksum differs" {}))
  (count bytes))

(defn cold-readback
  "Perform one cold range read through `get-range` and verify it before
  accepting it. `fetch` is {:object _ :offset _ :length _ :sha _};
  `get-range` is [object offset length] -> bytes (as on the backend
  contract). Returns the evidence receipt
  {:status :pass :object :bytes :sha :from :remote}. Refusals throw
  :awai.fs/short-read or :awai.fs/cid-mismatch and produce no receipt."
  [get-range {:keys [object offset length sha] :as fetch}]
  (when-not (map? fetch)
    (fail! :awai.fs/invalid-fetch "awai fs: cold-readback fetch must be a map" {}))
  (doseq [k [:object :offset :length :sha]]
    (when (nil? (get fetch k))
      (fail! :awai.fs/invalid-fetch "awai fs: cold-readback fetch is missing a field" {:field k})))
  (let [bytes (get-range object offset length)
        n (verify-bytes! bytes length sha)]
    {:status :pass
     :object object
     :bytes n
     :sha sha
     :from :remote}))
