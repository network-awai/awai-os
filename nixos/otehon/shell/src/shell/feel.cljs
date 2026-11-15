(ns shell.feel
  (:require ["react" :refer [useState]]
            ["../feel.js" :refer [readFeel updateFeel]]))

(defn feel-settings []
  (let [[prefs set-prefs] (useState readFeel)
        [saved set-saved] (useState true)]
    [:section.feel-settings {:aria-labelledby "feel-title"}
     [:h2 {:id "feel-title"} "音とモーション"]
     [:p.muted "短く、心地よく。好みに合わせて。"]
     (map (fn [[field label]]
            [:label.feel-choice {:key field}
             [:span label]
             [:input {:type "checkbox" :checked (aget prefs field)
                      :on-change (fn [event]
                                   (let [next (js/Object.assign #js {} prefs)]
                                     (aset next field (.. event -target -checked))
                                     (set-prefs next)
                                     (set-saved (updateFeel next))))}]])
          [["sound" "操作音"] ["startup" "起動音"] ["reduceMotion" "動きを減らす"]])
     [:button.secondary {:type "button" :data-ui-sound "confirm"} "音を確認"]
     [:p.muted "起動音は「はじめる」を押すと鳴ります。端末の消音・音量に従います。"]
     [:p.muted "システムの「動きを減らす」が有効な場合は、そちらを優先します。"]
     (when-not saved [:p {:role "status"} "設定を保存できませんでした。ブラウザーの保存設定を確認してください。"])]))
