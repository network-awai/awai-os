(ns awai.inference.contract)
(def contract {:schema "awai.inference.request.v1" :engine "llama.cpp" :modalities ["text" "image"] :image-model-set "qwen-image-2.1-turbo-uncensored-ad-q2-k" :image-size [512 512] :max-prompt-bytes 8192 :max-tokens 256 :models-loaded 1 :remote false})
(defn admit [modality prompt-bytes tokens]
 (cond (not (contains? #{"text" "image"} modality)) "unsupported-modality"
       (not (<= 1 prompt-bytes (:max-prompt-bytes contract))) "prompt-limit"
       (not (and (integer? tokens) (<= 1 tokens (:max-tokens contract)))) "token-limit"
       :else "accepted"))
