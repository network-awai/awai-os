(ns awai.apps.hyokeisan
  #?(:cljs (:require ["react" :as react])))

#?(:cljs
   (do
     (defn empty-sheet [] (vec (repeat 15 "")))
     (defn sheet-key [account-id]
       (when (and (string? account-id) (.startsWith account-id "did:") (<= (count account-id) 512))
         (str "otehon.hyokeisan.v1:" (js/encodeURIComponent account-id))))
     (defn read-sheet [account-id]
       (if-let [key (sheet-key account-id)]
         (try
           (let [value (js/JSON.parse (.getItem js/localStorage key))]
             (if (and (js/Array.isArray value) (= (.-length value) 15)
                      (.every value (fn [x] (and (string? x) (<= (count x) 1000)))))
               (vec (array-seq value)) (empty-sheet)))
           (catch :default _ (empty-sheet)))
         (empty-sheet)))
     (defn save-sheet [account-id cells]
       (if-let [key (sheet-key account-id)]
         (try
           (let [encoded (js/JSON.stringify (clj->js cells))]
             (.setItem js/localStorage key encoded)
             (= encoded (.getItem js/localStorage key)))
           (catch :default _ false))
         false))
     (defn ^:export Hyokeisan [props]
       (let [account-id (.-accountDid props)
             state (react/useState (fn [] (read-sheet account-id)))
             cells (aget state 0) set-cells (aget state 1)
             status-state (react/useState "") status (aget status-state 0) set-status (aget status-state 1)]
         (react/createElement "main" #js {:className "chat account-view" :data-app-view "hyokeisan"}
           (react/createElement "div" #js {:className "account-body"}
             (react/createElement "h1" nil "Hyokeisan")
             (react/createElement "p" nil "A local sheet with five rows and three columns. Numeric cells are summed per row; formulas are not yet supported.")
             (react/createElement "table" nil
               (react/createElement "thead" nil
                 (react/createElement "tr" nil
                   (react/createElement "th" #js {:scope "col"} "Row")
                   (react/createElement "th" #js {:scope "col"} "A")
                   (react/createElement "th" #js {:scope "col"} "B")
                   (react/createElement "th" #js {:scope "col"} "C")
                   (react/createElement "th" #js {:scope "col"} "Sum")))
               (react/createElement "tbody" nil
                 (into-array
                   (for [row (range 5)]
                     (let [values (subvec cells (* row 3) (+ (* row 3) 3))
                           total (reduce (fn [n x] (let [v (js/Number x)]
                                                     (if (and (not= x "") (js/Number.isFinite v)) (+ n v) n))) 0 values)]
                       (react/createElement "tr" #js {:key row}
                         (react/createElement "th" #js {:scope "row"} (str (inc row)))
                         (into-array
                           (for [col (range 3)]
                             (let [index (+ (* row 3) col) label (str (nth ["A" "B" "C"] col) (inc row))]
                               (react/createElement "td" #js {:key label}
                                 (react/createElement "input" #js {:aria-label label :value (nth cells index) :maxLength 1000
                                   :onChange (fn [event] (set-cells (assoc cells index (.. event -target -value))) (set-status ""))})))))
                         (react/createElement "td" #js {:aria-label (str "Row " (inc row) " sum")} (str total))))))))
             (react/createElement "button" #js {:type "button" :className "secondary"
               :onClick (fn [] (set-status (if (save-sheet account-id cells) "Saved on this device." "Could not save on this device.")))} "Save sheet")
             (react/createElement "p" #js {:role "status"} status)))))))
