(ns shell.gyosei
  "Gyosei (AWAI-3148): mounts the digest-pinned Shakai / Kaisha / Matsuri guest
  from network-awai/app-itonami-egov in the shared restricted frame. The guest
  cannot reach the network; its one read goes through createEgovHostBroker and
  the shell's canonical broker, which asks each time."
  (:require ["react" :refer [useEffect useRef useState]]
            ["../vendor-runtime.gen.js" :refer [mountRestrictedClientApp verifyClientArtifact]]
            ["../egov-host.js" :refer [createEgovHostBroker]]
            ["../egov-guest.gen.js" :refer [GYOSEI_GUEST_DECLARATION GYOSEI_GUEST_HTML]]))

(defn- refusal-label
  "Short visible reason for a refused guest (Figma S10). The raw message stays
  in data-gyosei-error and the console."
  [message]
  (cond
    (re-find #"digest mismatch" (str message)) "digest 不一致"
    (re-find #"byte budget" (str message)) "サイズ超過"
    :else "検証エラー"))

(defn panel [broker]
  (let [container (useRef nil)
        [problem set-problem] (useState nil)
        [attempt set-attempt] (useState 0)]
    (useEffect
     (fn []
       (let [live (volatile! true)
             handle (volatile! nil)]
         (set-problem nil)
         (-> (verifyClientArtifact (.encode (js/TextEncoder.) GYOSEI_GUEST_HTML) GYOSEI_GUEST_DECLARATION)
             (.then (fn [artifact]
                      (when @live
                        (mountRestrictedClientApp #js {:artifact artifact
                                                       :container (.-current container)
                                                       :broker (createEgovHostBroker broker)}))))
             (.then (fn [h] (if @live (vreset! handle h) (some-> h .close))))
             (.catch (fn [error]
                       (js/console.error "gyosei: guest refused" error)
                       (when @live (set-problem (or (some-> error .-message) "unknown"))))))
         (fn [] (vreset! live false) (some-> @handle .close))))
     #js [attempt])
    [:main.chat.gyosei {:data-gyosei true}
     (when problem
       [:div.empty
        [:p.notice {:role "alert" :data-gyosei-error problem}
         (str "この画面の検証に失敗したため、実行しませんでした（" (refusal-label problem) "）。")]
        [:button {:type "button" :on-click #(set-attempt (inc attempt))} "再読み込み"]])
     [:div.gyosei-frame {:ref container}]]))
