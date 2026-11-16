(ns shell.particles
  (:require ["react" :refer [useEffect useRef]]
            ["../particle-motion.js" :refer [mountParticleMotion]]))

(defn particle-layer [kind]
  (let [canvas (useRef nil)]
    (useEffect
     (fn []
       (let [controller (mountParticleMotion (.-current canvas) kind)]
         (.play controller)
         (fn [] (.dispose controller))))
     #js [kind])
    [:canvas.particle-layer {:ref canvas :aria-hidden true}]))
