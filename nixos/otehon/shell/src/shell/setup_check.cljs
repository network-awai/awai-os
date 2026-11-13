(ns shell.setup-check
  (:require [reagent.core :as r]
            ["react-dom/server" :refer [renderToStaticMarkup]]
            [shell.setup :refer [qr-code]]))

;; Exercise the actual component and npm import after advanced compilation.
;; No relay, account, signature or network operation is needed to render a QR.
(defn main []
  (let [url "https://awai.network/link/#local-qr-regression"
        html (renderToStaticMarkup (r/as-element [:f> qr-code url]))]
    (when-not (and (.includes html "<svg")
                   (.includes html "<path")
                   (.includes html "h1v1h-1z")
                   (.includes html url))
      (throw (js/Error. "phone-link-qr-render-failed")))
    (js/console.log "PASS: phone sign-in QR renders after advanced compilation without a relay or identity")))
