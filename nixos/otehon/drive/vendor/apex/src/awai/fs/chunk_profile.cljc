(ns awai.fs.chunk-profile
  "Versioned logical chunk parameters, separate from physical media layout.
  This is local manifest metadata, not a replacement for canonical codecs or
  the private-tree/query semantics owned by AWAI-173/174."
  (:require [awai.fs.large-file :as lf]))

(defn fixed-profile [leaf-size]
  (when-not (and (integer? leaf-size) (<= 1 leaf-size (* 16 1024 1024)))
    (throw (ex-info "unsupported logical leaf size" {:type :awai.fs/invalid-chunk-profile})))
  {:version 1 :kind :fixed :leaf-size leaf-size})

(def default-profile (fixed-profile lf/default-leaf-size))

(defn admit! [p]
  (when-not (and (= #{:version :kind :leaf-size} (set (keys p)))
                 (= 1 (:version p)) (= :fixed (:kind p))
                 (= p (fixed-profile (:leaf-size p))))
    (throw (ex-info "unsupported logical chunk profile" {:type :awai.fs/invalid-chunk-profile})))
  p)

(defn from-manifest
  "Keep an explicitly persisted profile. Legacy records retain their
  recorded leaf size; media class never supplies one during load/repack."
  [manifest]
  (let [p (or (:chunk-profile manifest) (fixed-profile (:leaf-size manifest)))]
    (admit! p)
    (when-not (= (:leaf-size p) (:leaf-size manifest))
      (throw (ex-info "manifest/profile leaf size mismatch" {:type :awai.fs/invalid-chunk-profile})))
    p))

(defn logical-view
  "Existing logical manifest fields, excluding placement/catalog fields.
  No ID is computed here; canonical ID primitives remain with their owner."
  [manifest]
  {:chunk-profile (from-manifest manifest)
   :file-size (:file-size manifest) :id (:id manifest) :sha (:sha manifest)
   :cid (:cid manifest) :content-root (:content-root manifest)
   :content-root-hex (:content-root-hex manifest)
   :entries (mapv #(select-keys % [:index :offset :length :sha :cid]) (:entries manifest))})
