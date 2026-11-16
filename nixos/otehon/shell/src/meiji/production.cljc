(ns meiji.production
  #?(:cljs (:require ["react" :refer [useEffect useState]] [meiji.client :as client])))

(defn fresh? [report now]
  #?(:cljs (let [at (js/Date.parse (:observedAt report))]
             (and (js/Number.isFinite at) (<= 0 (- now at) 180000)))
     :clj (try (<= 0 (- now (.toEpochMilli (java.time.Instant/parse (:observedAt report)))) 180000)
               (catch Exception _ false))))

#?(:cljs
   (do
     (def words
       {:ja {:title "本番のBot" :waiting "次回を待機" :unknown "要確認" :stale "観測待ち"
             :result "最新の成果" :next "次回" :replicas "保存先" :observed "確認時刻"
             :unavailable "観測データがありません" :measured "測定済み"}
        :en {:title "Production bots" :waiting "Scheduled" :unknown "Needs attention" :stale "Awaiting observation"
             :result "Latest result" :next "Next run" :replicas "Replicas" :observed "Observed"
             :unavailable "No observation available" :measured "Measured"}})
     (defn t [key] (get-in words [(if (.startsWith (or (.-language js/navigator) "en") "ja") :ja :en) key]))
     (defn time-label [value] (when value (.toLocaleString (js/Date. value))))
     (defn panel []
       (let [[report set-report] (useState nil) [now set-now] (useState (.now js/Date))]
         (useEffect (fn []
                      (let [live (atom true)
                            load #(do (set-now (.now js/Date))
                                      (-> (client/report-response "meiji-production.json" nil)
                                          (.then (fn [response] (.json response)))
                                          (.then (fn [data]
                                                   (let [value (js->clj data :keywordize-keys true)]
                                                     (when (and @live (= "awai.meiji-production.v1" (:schema value)))
                                                       (set-report value)))))
                                          (.catch (fn [_] nil))))
                            timer (js/setInterval load 15000)]
                        (load)
                        (fn [] (reset! live false) (js/clearInterval timer)))) #js [])
         [:section.meiji-control
          [:h2 (t :title)]
          (if-not report [:p (t :unavailable)]
            [:div
             [:p (t :observed) " · " [:time {:date-time (:observedAt report)} (time-label (:observedAt report))]]
             [:div.meiji-vms
              (for [job (:jobs report)
                    :let [result (:last-result job) domain (:domain-result result)
                          state (if (fresh? report now) (keyword (:state job)) :stale)
                          issue (:issue-id job)]]
                ^{:key (:job-id job)}
                [:article.meiji-vm
                 [:header [:h3 (:catalog-bot-id job)] [:strong (or (t state) (t :unknown))]]
                 [:p (:preferred-node job)]
                 (when (:next-slot job) [:p (t :next) " · " (time-label (:next-slot job))])
                 (when result
                   [:div
                    [:h4 (t :result)]
                    [:p (t :measured) " · " (get-in domain [:probe-summary :count]) "/" (get-in domain [:probe-summary :expected])]
                    [:p (t :replicas) " · " (:replicas domain)]
                    [:p (:run-id result)]])
                 (when (and (string? issue) (re-matches #"AWAI-[0-9]+" issue))
                   [:a {:href (str "https://linear.app/kotobalabs/issue/" issue) :target "_blank" :rel "noopener noreferrer"} issue])])]])]))))
