(ns awai.ui (:require [clojure.string :as str]))
;; Pure hiccup. No credentials, storage, requests, approval or application state.
(defn classes [& xs] (str/join " " (remove str/blank? xs)))
(defn button [label opts]
 (let [{:keys [variant disabled busy destructive attrs]} opts variant (or variant "primary")]
  (when-not (contains? #{"primary" "tonal" "text"} variant) (throw (ex-info "unknown button variant" {})))
  [:button (merge attrs {:type (or (:type attrs) "button") :class (classes "awai-button" (str "awai-button--" variant) (:class attrs))
   :disabled (or disabled busy) :aria-busy (when busy "true") :data-destructive (when destructive "true")}) label]))
(defn heading [level label]
 (when-not (contains? #{1 2 3 4 5 6} level) (throw (ex-info "heading level" {})))
 [(keyword (str "h" level)) {:class "awai-heading"} label])
(defn card [& children] (into [:section {:class "awai-card"}] children))
(defn stack [& children] (into [:div {:class "awai-stack"}] children))
(defn container [& children] (into [:div {:class "awai-ui awai-container"}] children))
(defn local-icon [path]
 (when path
  (when-not (and (string? path) (re-matches #"[A-Za-z0-9._/-]+" path) (not (str/starts-with? path "//")))
   (throw (ex-info "icon requires a bundled local path" {}))))
 path)
(defn search-field [{:keys [id label value placeholder on-input on-composition-end disabled error icon-src]}]
 (when (or (str/blank? id) (str/blank? label)) (throw (ex-info "search needs id and label" {})))
 (local-icon icon-src)
 [:div {:class "awai-field"} [:label {:for id :class "awai-sr-only"} label]
  [:div {:class "awai-search" :data-invalid (when error "true")}
   (when icon-src [:img {:src icon-src :alt "" :width "24" :height "24" :class "awai-icon"}])
   [:input {:id id :type "search" :value value :placeholder (or placeholder label) :disabled disabled :aria-invalid (when error "true")
    :aria-describedby (when error (str id "-error")) :on-input on-input :on-compositionend on-composition-end}]]
  (when error [:p {:id (str id "-error") :class "awai-error"} error])])
(defn field [{:keys [id label hint error]} control]
 (when (or (str/blank? id) (str/blank? label)) (throw (ex-info "field needs id and label" {})))
 [:div {:class "awai-field"} [:label {:for id} label]
  (let [[tag attrs & children] control]
   (into [tag (merge attrs {:id id :aria-invalid (when error "true") :aria-describedby (not-empty (str/join " " (remove nil? [(when hint (str id "-hint")) (when error (str id "-error"))])))})] children))
  (when hint [:p {:id (str id "-hint") :class "awai-muted awai-caption"} hint])
  (when error [:p {:id (str id "-error") :class "awai-error"} error])])
(defn navigation [label items current]
 [:nav {:class "awai-navigation" :aria-label label}
  [:ul (map (fn [{:keys [id label href icon-src]}]
    (when-not (and (string? href) (re-matches #"#[A-Za-z][A-Za-z0-9_-]*" href)) (throw (ex-info "navigation requires local fragment" {})))
    (local-icon icon-src)
    [:li [:a {:href href :aria-current (when (= id current) "page")}
          [:span {:class "awai-nav-indicator" :aria-hidden "true"}
           (if icon-src [:img {:src icon-src :width "24" :height "24" :alt "" :class "awai-icon"}] [:span {:class "awai-nav-mark"}])]
          [:span label]]]) items)]])
(defn disclosure [label & children] (into [:details {:class "awai-disclosure"} [:summary label]] children))
(defn status [text opts] [:p (merge {:class "awai-status" :role "status" :aria-live "polite" :aria-atomic "true"} opts) text])
