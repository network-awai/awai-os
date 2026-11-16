(ns meiji.panel
  #?(:cljs (:require ["react" :refer [useEffect useState]] [meiji.client :as client])))

#?(:cljs
   (do
     (def copy
       {:ja {:title "Meiji" :start "起動" :stop "停止" :force "強制停止" :save "上限を保存"
             :cpus "CPU（コア）" :memory "メモリ（MiB）" :check "推論を確認"
             :running "稼働中" :stopping "停止中" :stopped "停止済み" :failed "異常終了"
             :setup "セットアップが必要です" :saved "反映しました" :responded "推論に応答しました"
             :unknown-gpu "GPU使用：未確認" :close "VMを停止してから終了してください"
             :failed-action "操作できませんでした" :stop-first "停止してから変更してください"
             :invalid "上限の範囲内で入力してください" :vm-health "ゲストの状態：未確認"}
        :en {:title "Meiji" :start "Start" :stop "Stop" :force "Force stop" :save "Save limits"
             :cpus "CPU cores" :memory "Memory (MiB)" :check "Check inference"
             :running "Running" :stopping "Stopping" :stopped "Stopped" :failed "Failed"
             :setup "Setup required" :saved "Saved" :responded "Inference responded"
             :unknown-gpu "GPU use: unknown" :close "Stop your VMs before quitting"
             :failed-action "Operation failed" :stop-first "Stop the VM before changing limits"
             :invalid "Enter values within the limits" :vm-health "Guest health: unknown"}})
     (defn locale [] (if (.startsWith (or (.-language js/navigator) "en") "ja") :ja :en))
     (defn t [key] (get-in copy [(locale) key] (name key)))
     (defn vm-card [vm busy action]
       (let [[cpus set-cpus] (useState (get-in vm [:limits :cpus]))
             [memory set-memory] (useState (get-in vm [:limits :memory-mib]))
             active? (contains? #{"running" "stopping"} (:state vm))
             id (:id vm)]
         [:article.meiji-vm {:aria-busy busy}
          [:header [:h3 (:name vm)] [:span {:data-state (:state vm)} (t (keyword (:state vm)))]]
          [:p (str (name (:backend vm)) " · " (name (:arch vm)))]
          [:p (t :vm-health)]
          [:div.meiji-actions
           [:button {:type "button" :disabled (or busy active?) :on-click #(action {:op "start" :id id})} (t :start)]
           [:button {:type "button" :disabled (or busy (not active?) (= :krunkit (keyword (:backend vm))))
                     :on-click #(action {:op "stop" :id id})} (t :stop)]
           (when active?
             [:button {:type "button" :disabled busy :on-click #(action {:op "force-stop" :id id})} (t :force)])]
          [:form {:on-submit (fn [event] (.preventDefault event)
                               (action {:op "limits" :id id :limits {:cpus (js/Number cpus) :memory-mib (js/Number memory)}}))}
           [:fieldset {:disabled (or busy active?)}
            [:legend (t :save)]
            [:label {:for (str id "-cpu")} (t :cpus)]
            [:input {:id (str id "-cpu") :name "cpus" :type "number" :required true :min 1 :step 1
                     :max (get-in vm [:ceiling :cpus]) :value cpus :on-change #(set-cpus (.. % -target -value))}]
            [:label {:for (str id "-ram")} (t :memory)]
            [:input {:id (str id "-ram") :name "memory" :type "number" :required true :min 256 :step 1
                     :max (get-in vm [:ceiling :memory-mib]) :value memory :on-change #(set-memory (.. % -target -value))}]
            [:button {:type "submit"} (t :save)]]]
          (when (:inference-provider vm)
            [:div
             [:p (str (get-in vm [:inference :node]) " · " (get-in vm [:inference :backend]) " · " (get-in vm [:inference :origin]))]
             [:button {:type "button" :disabled (or busy (not (get-in vm [:inference :origin])))
                       :on-click #(action {:op "inference-check" :id id})} (t :check)]])]))
     (defn panel []
       (let [[snapshot set-snapshot] (useState nil) [busy set-busy] (useState false)
             [error set-error] (useState nil) [notice set-notice] (useState "")
             refresh #(-> (client/request {:op "snapshot"}) (.then set-snapshot)
                          (.catch (fn [_] (set-error (t :setup)))))
             action (fn [request]
                      (set-busy true) (set-error nil) (set-notice "")
                      (-> (client/request request)
                          (.then (fn [result]
                                   (when (:vms result) (set-snapshot result))
                                   (set-notice (if (= "inference-check" (:op request))
                                                 (str (t :responded) " · " (t :unknown-gpu)) (t :saved)))))
                          (.catch (fn [_] (set-error (t :failed-action))))
                          (.finally (fn [] (set-busy false) (refresh)))))]
         (useEffect (fn []
                      (when (client/available?)
                        (let [live (atom true)
                              load #(-> (client/request {:op "snapshot"})
                                        (.then (fn [s] (when @live (set-snapshot s))))
                                        (.catch (fn [_] (when @live (set-error (t :setup))))))
                              timer (js/setInterval load 5000)
                              stop-listener (atom nil)
                              listen (some-> js/window (aget "__TAURI__") (aget "event") (aget "listen"))]
                          (load)
                          (when listen
                            (-> (listen "meiji-close-blocked" #(when @live (set-error (t :close))))
                                (.then (fn [stop] (if @live (reset! stop-listener stop) (stop))))))
                          (fn [] (reset! live false) (js/clearInterval timer) (when-let [stop @stop-listener] (stop)))))) #js [])
         (when (client/available?)
           [:section.meiji-control
            [:h2 (t :title)]
            [:p {:role "status"} notice]
            (when error [:p.net-error {:role "alert"} error])
            (when (and snapshot (empty? (:vms snapshot))) [:p (t :setup)])
            [:div.meiji-vms
             (for [vm (:vms snapshot)] ^{:key (:id vm)} [:f> vm-card vm busy action])]])))))
