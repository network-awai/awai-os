(ns shell.fleet-org-editor
  (:require ["react" :refer [useState]]))
(defn panel [nodes selected on-change error]
  (let [[name set-name] (useState "") [parent set-parent] (useState "fleet")
        [issue set-issue] (useState "")
        orgs (sort-by :label (filter #(= "organization" (:kind %)) nodes))]
    [:details.fleet-org-editor
     [:summary "Org in Org · 組織と所属を編集"]
     [:p.muted "表示上の組織をこのブラウザーに保存します。正本Circle・cron・実行権限は変更しません。組織の中に子組織を作り、円を選んでBotやCircleを所属させられます。"]
     (when error [:p.problem {:role "alert"} error])
     [:label.soshiki-field [:span "親組織・所属先"]
      [:select {:aria-label "親組織・所属先" :value parent :on-change #(set-parent (.. % -target -value))}
       [:option {:value "fleet"} "全体（親なし）"]
       (for [org orgs] ^{:key (:id org)} [:option {:value (:id org)} (:label org)])]]
     [:label.soshiki-field [:span "新しい組織名"]
      [:input {:aria-label "新しい組織名" :value name :max-length 100 :on-change #(set-name (.. % -target -value))}]]
     [:label.soshiki-field [:span "対応Linear Issue（任意）"]
      [:input {:aria-label "組織のLinear Issue" :value issue :placeholder "AWAI-2795" :on-change #(set-issue (.. % -target -value))}]]
     [:button.secondary {:type "button" :disabled (or error (empty? (.trim name)))
                         :on-click #(when (on-change #js {:type "create" :id (str "org:custom:" (.randomUUID js/crypto))
                                                        :name name :parentId parent :linearIssue issue})
                                      (set-name "") (set-issue ""))} "子組織を作る"]
     (when selected
       [:div
        [:p (str "選択: " (:label selected))]
        (if (= "organization" (:kind selected))
          [:button.secondary {:type "button" :disabled (boolean error)
                              :on-click #(on-change #js {:type "move" :id (:id selected) :parentId parent})} "選択した組織を移す"]
          (when (contains? #{"bot" "circle"} (:kind selected))
            [:<>
             [:button.secondary {:type "button" :disabled (or error (= parent "fleet"))
                                 :on-click #(on-change #js {:type "assign" :entityId (if (= "bot" (:kind selected)) (:id selected) (:circleId selected)) :parentId parent})}
              "選択したBot・Circleを所属させる"]
             [:button.secondary {:type "button" :disabled (boolean error)
                                 :on-click #(on-change #js {:type "restore" :entityId (if (= "bot" (:kind selected)) (:id selected) (:circleId selected))})}
              "元の表示所属へ戻す"]]))])]))
