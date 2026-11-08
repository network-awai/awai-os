(ns awai.apps.tsunagu
  #?(:cljs (:require ["react" :as react]
                     ["../connect.js" :refer [bridge]])))

;; Tsunagu: Tailscale and Kekkai from inside this VM (JUN-318).
;; Joining a tailnet goes through the shared broker, so the consent dialog names
;; the coordination server before tailscaled contacts it. Kekkai SSH pairing is
;; approved here, on this screen, by the person at the VM.

(defn tailscale-stage [state]
  (case state
    ("Stopped" "Unknown" nil) :off
    ("NeedsLogin" "NeedsMachineAuth" "Starting") :signing-in
    "Running" :on
    :off))

(defn kekkai-stage [{:keys [available code pending connected]}]
  (cond (not available) :unavailable
        pending :approve
        connected :connected
        code :code
        :else :closed))

#?(:cljs
   (do
     (defn el [tag props & children] (apply react/createElement tag props children))

     (defn ^:export Tsunagu [props]
       (let [broker (.-broker props)
             QrCode (.-QrCode props)
             status-state (react/useState nil) status (aget status-state 0) set-status (aget status-state 1)
             note-state (react/useState "") note (aget note-state 0) set-note (aget note-state 1)
             busy-state (react/useState false) busy (aget busy-state 0) set-busy (aget busy-state 1)
             refresh (fn [] (-> (bridge "/status") (.then set-status)
                                (.catch (fn [e]
                                          (set-status nil)
                                          (set-note (if (= (.-message e) "trusted_host_authorization_unavailable")
                                                      "Connection controls are unavailable until trusted host authorization is configured."
                                                      "The connection service on this VM is not answering."))))))
             act (fn [label f]
                   (set-busy true) (set-note "")
                   (-> (f) (.then (fn [_] (refresh)))
                       (.catch (fn [e] (set-note (str label " did not complete: " (.-message e)))))
                       (.finally (fn [] (set-busy false)))))
             ts (when status (js->clj (.-tailscale status) :keywordize-keys true))
             kk (when status (js->clj (.-kekkai status) :keywordize-keys true))
             ts-stage (if status (tailscale-stage (:state ts)) :unavailable)
             kk-stage (kekkai-stage kk)
             tail-ip (first (filter #(not (.includes % ":")) (:addresses ts)))]
         (react/useEffect (fn [] (refresh) (let [id (js/setInterval refresh 3000)] #(js/clearInterval id))) #js [])
         (el "main" #js {:className "chat account-view" :data-app-view "tsunagu"}
           (el "div" #js {:className "account-body"}
             (el "h1" nil "Tsunagu")
             (el "p" nil "Connect this Awai OS to your Tailscale network, and let a computer you approve reach it over Kekkai SSH.")
             (when (seq note) (el "p" #js {:className "muted" :role "status"} note))

             (el "section" #js {:data-tsunagu "tailscale"}
               (el "h2" nil "Tailscale")
               (case ts-stage
                 :unavailable (el "p" #js {:className "muted"} "Tailscale status is unavailable.")
                 :off
                 (el "div" nil
                   (el "p" nil "Off. Nothing is sent to Tailscale until you approve it.")
                   (el "button" #js {:type "button" :className "primary" :disabled busy
                                     :onClick #(act "Connecting"
                                                    (fn [] (.invoke broker #js {:capability "awai-network" :service "tailscale" :operation "join-tailnet"} #js {})))}
                       "Connect to Tailscale"))
                 :signing-in
                 (el "div" nil
                   (if-let [url (:authURL ts)]
                     (el "div" nil
                       (el "p" nil "Scan with your phone, or open this address, to add this VM to your tailnet.")
                       (el QrCode #js {:url url})
                       (el "p" #js {:className "muted"} url))
                     (el "p" nil "Waiting for the sign-in address…"))
                   (el "button" #js {:type "button" :className "secondary" :disabled busy
                                     :onClick #(act "Cancelling" (fn [] (bridge "/tailscale/disconnect" #js {})))} "Cancel"))
                 :on
                 (el "div" nil
                   (el "p" nil (str "Connected as " (or (:name ts) "this VM") "."))
                   (el "p" #js {:className "muted"} (.join (clj->js (:addresses ts)) ", "))
                   (el "button" #js {:type "button" :className "secondary" :disabled busy
                                     :onClick #(act "Disconnecting" (fn [] (bridge "/tailscale/disconnect" #js {})))} "Disconnect")
                   (el "button" #js {:type "button" :className "secondary" :disabled busy
                                     :onClick #(act "Signing out" (fn [] (bridge "/tailscale/logout" #js {})))} "Sign out of Tailscale"))))

             (el "section" #js {:data-tsunagu "kekkai"}
               (el "h2" nil "Kekkai SSH")
               (case kk-stage
                 :unavailable (el "p" #js {:className "muted"} "The Kekkai service is not running on this VM.")
                 :closed
                 (el "div" nil
                   (el "p" nil "Allow one computer to pair for five minutes. It gets SSH with administrator rights only after you approve its keys here.")
                   (el "button" #js {:type "button" :className "primary" :disabled busy
                                     :onClick #(act "Opening pairing" (fn [] (bridge "/kekkai/open" #js {})))} "Allow a computer to connect")
                   (el "button" #js {:type "button" :className "secondary" :disabled busy
                                     :onClick #(act "Removing access" (fn [] (bridge "/kekkai/revoke" #js {})))} "Remove SSH access"))
                 :code
                 (el "div" nil
                   (el "p" nil (str "On the computer, open https://" (or tail-ip "<this VM's tailnet address>") ":8443 and enter this code:"))
                   (el "p" #js {:className "app-clock" :data-pairing-code (:code kk)} (:code kk))
                   (when (:certificate kk) (el "p" #js {:className "muted"} (str "Page certificate " (:certificate kk))))
                   (el "button" #js {:type "button" :className "secondary" :disabled busy
                                     :onClick #(act "Closing pairing" (fn [] (bridge "/kekkai/close" #js {})))} "Stop pairing"))
                 :approve
                 (let [{:keys [name address]} (:pending kk) ssh (:ssh kk)]
                   (el "div" nil
                     (el "p" nil (str "\"" name "\" at " address " asks to connect."))
                     (when ssh (el "p" #js {:className "muted"} (str "SSH key " (:fingerprint ssh))))
                     (when (:kekkaiFingerprint ssh) (el "p" #js {:className "muted"} (str "Kekkai device key " (:kekkaiFingerprint ssh))))
                     (el "button" #js {:type "button" :className "primary" :disabled busy
                                       :onClick #(act "Approving"
                                                      (fn [] (bridge "/kekkai/approve" (clj->js {:fingerprint (:fingerprint ssh)
                                                                                                 :kekkaiFingerprint (:kekkaiFingerprint ssh)}))))}
                         "Approve this computer")
                     (el "button" #js {:type "button" :className "secondary" :disabled busy
                                       :onClick #(act "Refusing" (fn [] (bridge "/kekkai/close" #js {})))} "Refuse")))
                 :connected
                 (el "div" nil
                   (el "p" nil (str "\"" (:name (:connected kk)) "\" is paired."))
                   (el "button" #js {:type "button" :className "secondary" :disabled busy
                                     :onClick #(act "Removing access" (fn [] (bridge "/kekkai/revoke" #js {})))} "Remove SSH access"))))))))))
