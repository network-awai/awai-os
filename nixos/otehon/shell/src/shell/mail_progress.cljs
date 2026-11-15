(ns shell.mail-progress (:require [shell.ui-copy :as ui]))
(defn panel [progress selected locale]
 (when progress
  (let [bot (first (filter #(= selected (:botId %)) (:entries progress)))]
   [:section.fleet-cooperation {:aria-labelledby "bot-mail-heading"}
    [:h3 {:id "bot-mail-heading"} (ui/t locale :botMail)]
    [:p (ui/t locale :mailReservedCount {:count (count (:entries progress))})]
    (when bot [:dl.fleet-facts [:dt (ui/t locale :mailAddress)] [:dd [:code {:style {:overflow-wrap "anywhere"}} (:address bot)]]])
    [:ul [:li (ui/t locale :mailRoutingPending)] [:li (ui/t locale :mailKeysPending)] [:li (ui/t locale :mailSendNotGranted)]]
    [:a {:href "https://linear.app/kotobalabs/issue/AWAI-328"} "AWAI-328"]
    [:details.fleet-disclosure [:summary (ui/t locale :executionDetails)]
     [:p (ui/t locale :mailGatewayGoogle)]
     [:time (ui/stamp locale (:observedAt progress))]]])))
