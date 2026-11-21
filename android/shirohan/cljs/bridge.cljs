(ns shirohan.android
  (:require [shirohan.core :as shirohan]))

(defn- result [job]
  (clj->js {:preview (shirohan/preview job)
            :underbase (shirohan/underbase-check job)
            :films (shirohan/films job)
            :findings (mapv #(select-keys % [:kind :note]) (:findings job))}))

(set! (.-Shirohan js/globalThis)
      #js {:planSvg (fn [svg options]
                      (result (shirohan/plan svg (js->clj options :keywordize-keys true))))
           :planImage (fn [color silhouette options]
                        (let [pixels (fn [image]
                                       {:width (.-width image) :height (.-height image)
                                        :data (.-data image)})]
                          (result (shirohan/plan-image
                                   (pixels color)
                                   (assoc (js->clj options :keywordize-keys true)
                                          :silhouette-image (pixels silhouette))))))})
