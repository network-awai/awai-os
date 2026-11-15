(ns awai.fs.prefetch-plan
  "P4 prefetch plans: bounded read-ahead windows (AWAI-236).

  plan-prefetch answers a byte range plus a read-ahead budget as one
  verified fetch set. The window extends the requested range by the
  budget, clamped to the file end; the base range keeps its own
  validation, so past-end requests are refused, never silently clipped.
  Pure data in, pure data out. No bytes are allocated and no network is
  touched."
  (:refer-clojure :exclude [])
  (:require [awai.fs.large-file :as lf]
            [awai.fs.query-plan :as qp]))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn plan-prefetch
  "Plan [offset, offset+length) on fname with ahead extra bytes.
  Returns {:requested {...} :window {...} :chunks [...] :groups [...]
  :bytes n :prefetch-bytes n} where :window is clamped to the file end
  and :prefetch-bytes is the fetch beyond the requested length."
  [projection fname offset length ahead]
  (when-not (and (integer? ahead) (not (neg? ahead)))
    (fail! :awai.fs.prefetch/bad-ahead "awai fs prefetch: read-ahead must be a non-negative integer"
           {:ahead ahead}))
  (let [base (qp/plan-range projection fname offset length)
        file-size (get-in projection [fname :manifest :file-size])
        window-end (min file-size (+ offset length ahead))
        window-length (- window-end offset)
        index (get-in projection [fname :index])
        chunks (lf/range-chunks-indexed index offset window-length)
        groups (lf/coalesce-fetches chunks)
        bytes (reduce + 0 (map :length groups))]
    {:requested {:offset offset :length length}
     :window {:offset offset :length window-length}
     :chunks chunks
     :groups groups
     :bytes bytes
     :prefetch-bytes (- bytes length)}))
