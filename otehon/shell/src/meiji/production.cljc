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
             :unavailable "観測データがありません" :measured "測定済み" :review "業務レポート"
             :usage "モデル・使用量" :input "入力" :output "出力" :not-measured "未計測" :draft "下書き"}
        :en {:title "Production bots" :waiting "Scheduled" :unknown "Needs attention" :stale "Awaiting observation"
             :result "Latest result" :next "Next run" :replicas "Replicas" :observed "Observed"
             :unavailable "No observation available" :measured "Measured" :review "Work report"
             :usage "Model & usage" :input "Input" :output "Output" :not-measured "Unknown" :draft "Draft"}})
     (defn t [key] (get-in words [(if (.startsWith (or (.-language js/navigator) "en") "ja") :ja :en) key]))
     (defn time-label [value] (when value (.toLocaleString (js/Date. value))))
     (defn review-card [result]
       [:article.meiji-vm
        [:header [:h3 (t :review)] (when-not (= "complete" (:quality result)) [:strong (t :draft)])]
        [:p "jacob · Kapitsa"]
        [:time {:date-time (:observedAt result)} (time-label (:observedAt result))]
        [:pre {:style {:white-space "pre-wrap" :overflow-wrap "anywhere" :font "inherit"}} (:text result)]
        [:details
         [:summary (t :usage)]
         [:p (:model result)]
         [:p (t :input) " · " (or (get-in result [:usage :prompt_tokens]) (get-in result [:usage :input_tokens]) (t :not-measured))]
         [:p (t :output) " · " (or (get-in result [:usage :completion_tokens]) (get-in result [:usage :output_tokens]) (t :not-measured))]]])
     (defn panel []
       (let [[report set-report] (useState nil) [review set-review] (useState nil) [now set-now] (useState (.now js/Date))]
         (useEffect (fn []
                      (let [live (atom true)
                            load #(do (set-now (.now js/Date))
                                      (-> (client/report-response "meiji-production.json" nil)
                                          (.then (fn [response] (.json response)))
                                          (.then (fn [data]
                                                   (let [value (js->clj data :keywordize-keys true)]
                                                     (when (and @live (= "awai.meiji-production.v1" (:schema value)))
                                                       (set-report value)))))
                                          (.catch (fn [_] nil)))
                                      (-> (client/report-response "meiji-review.json" nil)
                                          (.then (fn [response] (.json response)))
                                          (.then (fn [data]
                                                   (let [value (js->clj data :keywordize-keys true)]
                                                     (when (and @live (= "completed" (:state value))
                                                                (= "kapitsa" (:provider value)) (= "jacob" (:node value)))
                                                       (set-review value)))))
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
                   [:a {:href (str "https://linear.app/kotobalabs/issue/" issue) :target "_blank" :rel "noopener noreferrer"} issue])])]
             (when review [:f> review-card review])])]))))
