(ns link.main
  (:require [reagent.dom.client :as rdom]
            ["react" :refer [useMemo useState]]
            ["../identity/link.js" :refer [RP_ID SESSION_MS compressP256 confirmationCode
                                               fromBase64Url parseLinkFragment passkeyChallenge
                                               sealResponse toBase64Url]]
            ["../identity/wallet.js" :refer [signWithProvider]]
            ["../runtime.js" :refer [createBroker deliverApproval phoneOperations]]))

(def relay-origin
  (.-relayOrigin (.-dataset (.getElementById js/document "root"))))
(def passkey-key "awai.passkey.v1")
(def devices-key "awai.devices.v1")

(defn- read-json [key fallback]
  (try
    (or (.parse js/JSON (.getItem js/localStorage key)) fallback)
    (catch :default _ fallback)))

(defn- register-passkey []
  (-> (.create (.-credentials js/navigator)
               #js {:publicKey #js {:rp #js {:id RP_ID :name "Awai Network"}
                                    :user #js {:id (.getRandomValues js/crypto (js/Uint8Array. 32))
                                               :name "Awai account"
                                               :displayName "Awai account"}
                                    :challenge (.getRandomValues js/crypto (js/Uint8Array. 32))
                                    :pubKeyCredParams #js [#js {:type "public-key" :alg -7}]
                                    :authenticatorSelection #js {:residentKey "required"
                                                                 :userVerification "required"}}})
      (.then (fn [credential]
               (let [spki (js/Uint8Array. (.getPublicKey (.-response credential)))
                     saved #js {:id (toBase64Url (js/Uint8Array. (.-rawId credential)))
                                :publicKey (toBase64Url (compressP256 (.slice spki -65)))}]
                 (.setItem js/localStorage passkey-key (.stringify js/JSON saved))
                 saved)))))

(defn- approve-with-passkey [request]
  (-> (js/Promise.resolve (read-json passkey-key nil))
      (.then (fn [saved] (or saved (register-passkey))))
      (.then (fn [saved]
               (let [expires-at (.toISOString (js/Date. (+ (.now js/Date) SESSION_MS)))]
                 (-> (.get (.-credentials js/navigator)
                           #js {:publicKey #js {:rpId RP_ID
                                                :challenge (passkeyChallenge
                                                            #js {:device (.-device request)
                                                                 :nonce (.-nonce request)
                                                                 :expiresAt expires-at})
                                                :allowCredentials #js [#js {:type "public-key"
                                                                            :id (fromBase64Url (.-id saved))}]
                                                :userVerification "required"}})
                     (.then (fn [assertion]
                              #js {:method "passkey"
                                   :publicKey (.-publicKey saved)
                                   :authenticatorData (toBase64Url
                                                       (js/Uint8Array.
                                                        (.-authenticatorData (.-response assertion))))
                                   :clientDataJSON (toBase64Url
                                                    (js/Uint8Array.
                                                     (.-clientDataJSON (.-response assertion))))
                                   :signature (toBase64Url
                                               (js/Uint8Array.
                                                (.-signature (.-response assertion))))
                                   :expiresAt expires-at}))))))))

(defn- approve-with-wallet [request]
  (signWithProvider (.-ethereum js/window) request))

(defn- read-request []
  (try
    #js {:request (parseLinkFragment (.-hash js/location))}
    (catch :default error
      #js {:problem (.-message error)})))

(defn link-page []
  (let [memo (useMemo read-request #js [])
        request (.-request memo)
        problem (.-problem memo)
        [confirmed set-confirmed] (useState false)
        [state set-state] (useState "ready")
        [error set-error] (useState nil)
        broker (useMemo (fn [] (when request (createBroker "index.html" (phoneOperations relay-origin))))
                        #js [request])
        approve (fn [sign]
                  (set-error nil)
                  (set-state "working")
                  (-> (sign request)
                      (.then (fn [response] (sealResponse request response)))
                      (.then (fn [sealed] (deliverApproval broker relay-origin (.-topic request) sealed)))
                      (.then (fn []
                               (let [devices (read-json devices-key #js [])
                                     kept (.filter devices
                                                   (fn [device] (not= (.-did device) (.-device request))))
                                     next (.stringify js/JSON
                                                       (.concat kept #js [#js {:did (.-device request)
                                                                               :linkedAt (.toISOString (js/Date.))}]))]
                                 (.setItem js/localStorage devices-key next))
                               (set-state "done")))
                      (.catch (fn [caught]
                                (set-error (if (re-find #"not approved" (or (.-message caught) ""))
                                             "Nothing was sent."
                                             "This could not be completed. Try again."))
                                (set-state "ready")))))]
    (cond
      (not request)
      [:main
       [:h1 "This link can't be used"]
       [:p {:data-link-problem problem}
        (when (= problem "request-expired") "The code expired. ")
        "Show a new code on your device and scan it again."]]

      (= state "done")
      [:main {:data-link-done true}
       [:h1 "Device linked"]
       [:p "You can return to your device. Your linked devices on this phone:"]
       [:ul.devices
        (.map (read-json devices-key #js [])
              (fn [device] [:li {:key (.-did device)} (.-did device)]))]]

      :else
      [:main
       [:h1 "Link this device?"]
       [:p "Approve only if you are setting up this device yourself."]
       [:dl
        [:dt "Device"]
        [:dd.did (.-device request)]
        [:dt "Code"]
        [:dd.code {:data-link-code true} (confirmationCode request)]]
       [:label.confirm
        [:input {:type "checkbox" :checked confirmed
                  :on-change #(set-confirmed (.. % -target -checked))}]
        [:span "My device shows the same code"]]
       [:button.primary {:type "button" :data-approve "passkey"
                          :disabled (or (not confirmed) (= state "working"))
                          :on-click #(approve approve-with-passkey)}
        "Approve with Passkey"]
       [:button.secondary {:type "button" :data-approve "wallet"
                            :disabled (or (not confirmed) (= state "working")
                                          (not (.-ethereum js/window)))
                            :on-click #(approve approve-with-wallet)}
        "Approve with Wallet"]
       (when-not (.-ethereum js/window)
         [:p.muted "To use a wallet, open this page in your wallet's browser."])
       (when error [:p.problem error])])))

(defn init []
  (let [root (rdom/create-root (.getElementById js/document "root"))]
    (rdom/render root [:f> link-page])))
