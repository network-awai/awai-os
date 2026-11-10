(ns saifu.app
  "The Saifu screen. Reads an EVM balance through the host's consent-checked broker.
  It never holds keys, and it cannot sign or send."
  (:require [reagent.core :as r]
            [reagent.dom.client :as rdom]
            [saifu.core :as core]))

(defonce state (r/atom {:address "" :status :idle}))

(defn- read-through
  "A JSON-RPC response as a map from the host; fail closed when no host is connected."
  [request]
  (cond
    (some-> js/window .-saifuHost .-readChainState)
    (-> (.readChainState js/window.saifuHost (clj->js request))
        (.then #(js->clj % :keywordize-keys true)))

    :else (js/Promise.resolve {:error {:message "no-consent-host"}})))

(defn- read-balance! []
  (let [request (core/balance-request (:address @state) 1)]
    (if (:error request)
      (swap! state assoc :status :invalid)
      (do
        (swap! state assoc :status :reading)
        (-> (read-through request)
            (.then (fn [response]
                     (let [read (core/read-balance response 18)]
                       (swap! state assoc
                              :status (if (:error read) :failed :done)
                              :display (:display read)))))
            (.catch (fn [_] (swap! state assoc :status :denied))))))))

(defn- view []
  (let [{:keys [address status display]} @state]
    [:div.saifu
     [:h3 "Saifu"]
     [:p "Read a balance. This app cannot sign or send."]
     [:input {:aria-label "EVM address" :placeholder "0x…" :value address :spell-check false
              :on-change #(swap! state assoc :address (.. % -target -value) :status :idle)}]
     [:button {:on-click read-balance! :disabled (= status :reading)} "Read Balance"]
     (case status
       :done [:p {:data-balance display} display " ETH"]
       :invalid [:p.problem {:data-state "invalid"} "That is not an EVM address."]
       :failed [:p.problem {:data-state "failed"} "The balance could not be read."]
       :denied [:p {:data-state "denied"} "Nothing was sent."]
       :reading [:p "Reading…"]
       nil)]))

(defn init []
  (when-let [el (.getElementById js/document "saifu")]
    (rdom/render (rdom/create-root el) [view])))
