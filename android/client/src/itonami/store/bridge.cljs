(ns itonami.store.bridge (:require [itonami.store.domain :as d] [itonami.store.setup :as setup]))
(defn parse [value] (js->clj (js/JSON.parse value) :keywordize-keys true))
(aset js/window "ItonamiDomain"
      #js {"schema" d/schema
           "palette" (clj->js d/palette)
           "descriptor" (clj->js (d/runtime-descriptor))
           "setupStage" setup/stage-name
           "setupNext" (fn [json] (setup/next-action (parse json)))
           "validCatalog" (fn [json now] (boolean (d/valid-catalog? (parse json) now)))
           "appState" (fn [json platform runtime installed] (d/app-state (parse json) platform runtime installed))
           "saveEvent" (fn [json entry] (js/JSON.stringify (clj->js (d/save-event (parse json) (parse entry)))))
           "nextEvent" (fn [json now] (clj->js (d/next-event (parse json) now)))})
