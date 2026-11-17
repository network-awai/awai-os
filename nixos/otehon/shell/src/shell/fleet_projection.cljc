(ns shell.fleet-projection
  #?(:cljs (:require ["../agent-directory.js" :refer [directoryState]]
                     ["../circle-work.js" :refer [circleExecution]])))

#?(:cljs
   (defn annotate [bots presence circle-work catalog-sha now stale?]
     ;; These reports are shared across the fleet. Converting a 550 KB report
     ;; once for each of 899 bots kept the WebView busy between polling ticks.
     (let [presence-js (clj->js presence) work-js (clj->js circle-work)]
       (mapv (fn [bot]
               (let [directory (directoryState (clj->js bot) presence-js catalog-sha now stale?)
                     observation (or (circleExecution work-js (:id bot) catalog-sha now)
                                     (.-observation directory))]
                 (cond-> bot observation
                   (assoc :agentPresence (js->clj observation :keywordize-keys true)
                          :state "running" :cronState (:state bot))))) bots))))
