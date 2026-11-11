(ns shell.styles.link
  "The phone link page stylesheet as Garden data."
  (:require [garden.core :as garden]
            [garden.stylesheet :refer [at-media]]))

(def styles
  [[":root" {:color-scheme "light dark"
            :font-family "system-ui, sans-serif"
            :background "Canvas"
            :color "CanvasText"}]
   [:* {:box-sizing "border-box"}]
   [:body {:margin 0}]
   [:main {:max-width "480px" :margin "0 auto" :padding "32px 16px"}]
   [:h1 {:margin "0 0 12px" :font-size "26px"}]
   [:dl {:margin "20px 0"}]
   [:dt {:margin-top "12px" :font-size "13px" :opacity 0.7}]
   [:dd {:margin "2px 0 0"}]
   [".did, .devices" {:font-size "13px" :overflow-wrap "anywhere"}]
   [:.code {:font-size "26px" :font-weight 600 :font-variant-numeric "tabular-nums"}]
   [:.confirm {:display "flex" :gap "10px" :align-items "center" :min-height "44px"
                :margin-bottom "12px"}]
   [".confirm input" {:width "20px" :height "20px"}]
   [:button {:width "100%" :min-height "48px" :margin-top "8px" :border 0
              :border-radius "12px" :font "inherit" :font-weight 600 :cursor "pointer"}]
   ["button:disabled" {:opacity 0.45 :cursor "default"}]
   [:.primary {:background "#0a66d6" :color "#fff"}]
   [:.secondary {:background "color-mix(in srgb, CanvasText 12%, Canvas)" :color "CanvasText"}]
   [:.muted {:font-size "14px" :opacity 0.7}]
   [:.problem {:color "#c42b1c"}]
   (at-media {:prefers-color-scheme "dark"}
             [:.problem {:color "#f09a8a"}])
])