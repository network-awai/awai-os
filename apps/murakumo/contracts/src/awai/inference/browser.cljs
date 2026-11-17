(ns awai.inference.browser (:require [awai.inference.contract :as c]))
(aset js/window "AwaiInference"
 (js-obj "admit" (fn [modality prompt tokens]
                    (c/admit modality (.-length (.encode (js/TextEncoder.) prompt)) tokens))))
