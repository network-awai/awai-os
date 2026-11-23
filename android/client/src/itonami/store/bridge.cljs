(ns itonami.store.bridge (:require [itonami.store.domain :as d] [itonami.store.setup :as setup] [itonami.store.handover :as h] [itonami.store.pc-setup :as pc]))
(defn parse [value] (js->clj (js/JSON.parse value) :keywordize-keys true))
(aset js/window "ItonamiDomain"
      #js {"schema" d/schema
           "palette" (clj->js d/palette)
           "descriptor" (clj->js (d/runtime-descriptor))
           "setupStage" setup/stage-name
           "setupNext" (fn [json] (setup/next-action (parse json)))
           "pcSetupStage" pc/stage-name
           "pcSetupNext" (fn [json] (pc/next-action (parse json)))
           "pcSetupTransports" (fn [json] (clj->js (pc/available-transports (parse json))))
           "pcProfileUnavailable" (fn [] (pc/honest-profile-copy))
           "validCatalog" (fn [json now] (boolean (d/valid-catalog? (parse json) now)))
           "appState" (fn [json platform runtime installed] (d/app-state (parse json) platform runtime installed))
           "saveEvent" (fn [json entry] (js/JSON.stringify (clj->js (d/save-event (parse json) (parse entry)))))
           "nextEvent" (fn [json now] (clj->js (d/next-event (parse json) now)))
           "handoverSchema" h/schema
           "handoverDescriptor" (clj->js (h/runtime-descriptor))
           "validChallenge" (fn [json] (boolean (h/valid-challenge? (parse json))))
           "challengeExpired" (fn [json now] (boolean (h/challenge-expired? (parse json) now)))
           "transferStatus" (fn [json] (clj->js (h/transfer-status (parse json))))
           "verifyChallenge" (fn [json] (js/JSON.stringify (clj->js (h/verify-challenge (parse json)))))
           "handoverNextStatus" (fn [json] (clj->js (h/handover-next-status (parse json))))
           "forbiddenKeysPresent" (fn [json] (boolean (h/forbidden-keys-present? (parse json))))
           "validEnvelope" (fn [json] (boolean (h/valid-envelope? (parse json))))})
