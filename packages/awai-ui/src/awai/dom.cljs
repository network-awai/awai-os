(ns awai.dom (:require [clojure.string :as str]))
;; Text nodes only; never parse content strings as HTML.
(defn node [x]
 (cond
  (nil? x) (.createTextNode js/document "")
  (or (string? x) (number? x)) (.createTextNode js/document (str x))
  (vector? x)
  (let [[tag & xs] x attrs (if (map? (first xs)) (first xs) {}) children (if (map? (first xs)) (rest xs) xs) el (.createElement js/document (name tag))]
   (doseq [[k v] attrs]
    (cond (nil? v) nil
     (str/starts-with? (name k) "on-") (when (fn? v) (.addEventListener el (subs (name k) 3) v))
     (str/starts-with? (name k) "on") (throw (js/Error. "inline event attributes are not supported"))
     (= k :value) (set! (.-value el) v) (false? v) nil (true? v) (.setAttribute el (name k) "")
     :else (.setAttribute el (name k) (str v))))
   (doseq [c children] (.appendChild el (node c))) (when (contains? attrs :value) (set! (.-value el) (:value attrs))) el)
  (sequential? x) (let [f (.createDocumentFragment js/document)] (doseq [c x] (.appendChild f (node c))) f)
  :else (.createTextNode js/document (str x))))
(defn mount [element tree] (.replaceChildren element (node tree)))
