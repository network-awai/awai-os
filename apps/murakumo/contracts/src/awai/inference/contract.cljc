(ns awai.inference.contract)
(def contract {:schema "awai.inference.request.v1" :engine "llama.cpp" :modalities ["text"] :max-prompt-bytes 8192 :max-tokens 256 :models-loaded 1 :remote false})
(defn admit [modality prompt-bytes tokens]
 (cond (not= modality "text") "unsupported-modality"
       (not (<= 1 prompt-bytes (:max-prompt-bytes contract))) "prompt-limit"
       (not (and (integer? tokens) (<= 1 tokens (:max-tokens contract)))) "token-limit"
       :else "accepted"))
