(ns shell.ui-copy
  (:require ["../ui-copy.js" :refer [getCopy]]))
(defn t [locale key & [parameters]]
  (getCopy (or locale "ja") (name key) (clj->js (or parameters {}))))
(def state-keys {"running" :stateRunning "recovering" :stateRecovering "waiting" :stateWaiting
                 "queued" :stateQueued "held" :stateHeld "attention" :stateAttention "unknown" :stateUnknown "updated" :stateUpdated})
(defn state-label [locale state] (t locale (get state-keys state :stateUnknown)))
(defn stamp [locale value]
  (if value (.toLocaleString (js/Date. value) (if (= locale "en") "en-US" "ja-JP") #js {:timeZone "Asia/Tokyo" :timeZoneName "short"}) (t locale :unrecorded)))

(defn hold-label [locale reason]
  (try (t locale (keyword (str "hold-" reason))) (catch :default _ reason)))
