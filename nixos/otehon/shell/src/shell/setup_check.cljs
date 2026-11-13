(ns shell.setup-check
  (:require [reagent.core :as r]
            ["react-dom/server" :refer [renderToStaticMarkup]]
            [shell.setup :refer [qr-code]]
            [shell.bot-chat :as bot-chat]
            [shell.fleet-circles :as circles]))

;; Exercise the actual component and npm import after advanced compilation.
;; No relay, account, signature or network operation is needed to render a QR.
(defn main []
  (doseq [[locale expected] [["ja" "履歴を取得"] ["en" "Load history"]]]
    (let [html (renderToStaticMarkup (r/as-element [:f> bot-chat/panel {:id "profile:sample" :name "sample"} locale]))]
      (when-not (and (.includes html expected) (.includes html "<textarea") (.includes html "disabled"))
        (throw (js/Error. "agent-conversation-render-failed")))))
  (let [url "https://awai.network/link/#local-qr-regression"
        html (renderToStaticMarkup (r/as-element [:f> qr-code url]))]
    (when-not (and (.includes html "<svg")
                   (.includes html "<path")
                   (.includes html "h1v1h-1z")
                   (.includes html url))
      (throw (js/Error. "phone-link-qr-render-failed")))
    (js/console.log "PASS: phone sign-in QR renders after advanced compilation without a relay or identity"))
  (let [bots [{:id "a" :name "a" :repository "current/app" :circleIds ["repo:original/app"] :state "waiting" :configured true}
              {:id "b" :name "b" :repository "current/app" :circleIds ["repo:original/app"] :state "held" :configured false}]
        html (renderToStaticMarkup (r/as-element [:f> circles/panel bots false 0 "" (fn [_]) (fn [_])]))]
    (when-not (and (.includes html "2 Bot · 0 Circle")
                   (.includes html "配置確認")
                   (.includes html "Agentの活動")
                   (not (.includes html "<animate"))
                   (.includes html "定期待機 1")
                   (.includes html "未有効 1"))
      (throw (js/Error. "circle-advanced-interop-render-failed")))
    (js/console.log "PASS: Circle totals, catalog identity and state ring render after advanced compilation")
    (let [english (renderToStaticMarkup (r/as-element [:f> circles/panel bots false 0 "" (fn [_]) (fn [_]) "en"]))]
      (when-not (and (.includes english "2 bots · 0 circles") (.includes english "Agent activity") (.includes english "Responsibilities"))
        (throw (js/Error. "localized-circle-advanced-render-failed")))
      (js/console.log "PASS: English copy and named counts survive advanced compilation"))))
