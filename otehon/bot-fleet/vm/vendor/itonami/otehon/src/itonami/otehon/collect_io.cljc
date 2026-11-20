(ns itonami.otehon.collect-io
  "The pure receipt mapping of the outbox collector. Faithful port of
  itonami.agent.collect-io/receipt: an SDK append result becomes
  collect.cljc's receipt contract — a transfer id plus who signed and
  when — or nil on any doubt (collect treats nil as :no-receipt and
  keeps the row pending). The signer, the DID and the transport call
  stay host-side (S6): the node key never leaves its host."
  (:require [clojure.string :as str]))

(defn receipt
  "Map an SDK append result to the receipt contract, or nil on any
  doubt. A receipt names a transfer id; partial, unknown or errored
  results are not evidence of an append. The accessor is the legacy
  keyword read verbatim; which key convention the SDK results carry
  gets pinned when the SDK wiring lands (S6)."
  [result signed-by]
  (when (and (map? result)
             (string? (:transfer-id result))
             (seq (:transfer-id result))
             (string? signed-by)
             (seq signed-by))
    {:transfer-id (:transfer-id result)
     :signed-by signed-by
     :appended-at (:appended-at result)}))
