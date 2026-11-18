(ns shell.screen-tools
  (:require ["react" :refer [useEffect useRef useState]]
            ["../screen-tools.js" :refer [screenTool screenToolsAvailable]]
            [shell.ui-copy :as ui]))

;; A whole message is a proposal for exactly one action. No arguments or code.
(def commands
  {"/screen record" ["record-start" :screenRecord]
   "/screen stop" ["record-stop" :screenStop]
   "/screen home" ["home" :screenHome]
   "/screen recents" ["recents" :screenRecents]
   "/screen settings" ["settings" :screenSettings]})

(defn command [text]
  (when (and (screenToolsAvailable) (string? text))
    (get commands (.trim text))))

(defn panel [locale]
  (let [tr #(ui/t locale %)
        [state set-state] (useState nil)
        [problem set-problem] (useState false)
        [pending set-pending] (useState false)
        operating (useRef false)]
    (useEffect
     (fn []
       (when (screenToolsAvailable)
         (let [live (volatile! true)
               reading (volatile! false)
               refresh (fn []
                         (when (and (not @reading) (not (.-current operating)))
                           (vreset! reading true)
                           (-> (screenTool "status")
                               (.then (fn [result] (when (and @live (not (.-current operating)))
                                                    (set-state (.-state result)))))
                               (.catch (fn [_] (when @live (set-state nil))))
                               (.finally #(vreset! reading false)))))
               timer (js/setInterval refresh 750)]
           (refresh)
           (fn []
             (vreset! live false)
             (js/clearInterval timer)))))
     #js [])
    (when (screenToolsAvailable)
      (let [run (fn [action]
                  (when-not (.-current operating)
                    (set! (.-current operating) true)
                    (set-pending true)
                    (set-problem false)
                    (-> (screenTool action)
                        (.then #(set-state (.-state %)))
                        (.catch (fn [_] (set-problem true)))
                        (.finally (fn [] (set! (.-current operating) false) (set-pending false))))))
            busy (or pending (nil? state) (contains? #{"starting" "saving"} state))]
        [:details {:data-screen-tools true}
         [:summary (tr :screenTitle)]
         [:div.agent-session-toolbar
          (if (= state "recording")
            [:button.secondary {:type "button" :disabled busy :on-click #(run "record-stop")} (tr :screenStop)]
            [:button.secondary {:type "button" :disabled busy :on-click #(run "record-start")} (tr :screenRecord)])
          (for [[action label] [["home" :screenHome] ["recents" :screenRecents]
                                ["settings" :screenSettings] ["accessibility-settings" :screenAccessibility]]]
            ^{:key action}
            [:button.secondary {:type "button" :disabled busy :on-click #(run action)} (tr label)])]
         [:p {:role "status"}
          (tr (cond
                problem :screenUnavailable
                (nil? state) :screenChecking
                :else (keyword (str "screen-" state))))]]))))
