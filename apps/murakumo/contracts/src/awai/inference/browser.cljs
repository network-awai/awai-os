(ns awai.inference.browser (:require [awai.inference.contract :as c]
                                     [awai.inference.manager :as m]))
(aset js/window "AwaiInference"
 (js-obj "admit" (fn [modality prompt tokens]
                    (c/admit modality (.-length (.encode (js/TextEncoder.) prompt)) tokens))))
;; Model manager domain (AWAI-3240). JS values in, JS values out; nil stays null, never 0.
(defn- in [x] (js->clj x :keywordize-keys true))
(defn- out [f] (fn [& args] (clj->js (apply f (map in args)))))
(aset js/window "AwaiInferenceManager"
 (js-obj "catalogProblems" (out m/catalog-problems)
         "estimateBytes" (out m/estimate-bytes)
         "budgetBytes" (out m/budget-bytes)
         "fit" (out m/fit)
         "recommend" (out m/recommend)
         "usageProblems" (out m/usage-problems)
         "freshness" (out m/freshness)
         "deviceView" (out m/device-view)))
