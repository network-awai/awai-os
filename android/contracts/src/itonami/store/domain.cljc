(ns itonami.store.domain
  "Shared Android/NixOS Store decisions. Local state, no I/O and no approval authority."
  (:require [clojure.string :as str]))

(def schema "itonami.store.bundled.v1")
(def palette
  {:light {:background "#ffffff" :surface "#f5f6f8" :text "#182332" :muted "#485c74"
           :primary "#1e50a2" :onPrimary "#ffffff" :container "#e1eaff" :error "#bc002d"}
   :dark {:background "#14110f" :surface "#272422" :text "#ffffff" :muted "#b8b8b7"
          :primary "#b5cfff" :onPrimary "#182332" :container "#26354e" :error "#ffd1cb"}})

(defn good-text? [x limit] (and (string? x) (not (str/blank? x)) (<= (count x) limit)))
(defn package-id? [x] (and (string? x) (boolean (re-matches #"[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+" x))))
(defn digest? [x] (and (string? x) (boolean (re-matches #"[0-9a-f]{64}" x))))
;; Single hard ceiling for one catalog artifact. Raised from 20MiB so a Tauri
;; v3 WebView runtime (~30MiB floor) fits; the host boundary (Catalog.java)
;; still enforces the tighter per-app budget. Browser pin validation keeps
;; its own lower ceiling for remote downloads.
(def max-artifact-bytes (* 64 1024 1024))
(defn safe-artifact? [{:keys [platform runtime kind asset sha256 bytes signerSha256]}]
  (and (digest? sha256) (integer? bytes) (pos? bytes) (<= bytes max-artifact-bytes)
       (or (and (= platform "android") (= runtime "android") (= kind "apk")
                (string? asset) (boolean (re-matches #"packages/[a-z0-9-]+\.apk" asset))
                (digest? signerSha256))
           (and (= platform "nixos") (= runtime "browser") (= kind "bundled-web")
                (= asset "bundled:yotei")))))
(defn app? [{:keys [id name versionCode versionName artifacts]}]
  (and (package-id? id) (good-text? name 80) (good-text? versionName 40)
       (integer? versionCode) (pos? versionCode)
       (vector? artifacts) (seq artifacts) (every? safe-artifact? artifacts)
       (= (count artifacts) (count (set (map #(select-keys % [:platform :runtime]) artifacts))))))
(defn valid-catalog? [c now]
  (and (map? c) (= schema (:schema c)) (integer? (:revision c)) (pos? (:revision c))
       (integer? now) (integer? (:expiresAt c)) (> (:expiresAt c) now)
       (vector? (:apps c)) (every? app? (:apps c))
       (= (count (:apps c)) (count (set (map :id (:apps c)))))))

(defn artifact-for [app platform runtime]
  (when (app? app)
    (first (filter #(and (= platform (:platform %)) (= runtime (:runtime %))) (:artifacts app)))))
(defn app-state [app platform runtime installed-version]
  (cond
    (not (artifact-for app platform runtime)) "unavailable"
    (nil? installed-version) "available"
    (not (and (integer? installed-version) (pos? installed-version))) "invalid-installed-version"
    (< installed-version (:versionCode app)) "update"
    :else "installed"))

(defn event-problems [{:keys [id title at]}]
  (cond-> []
    (not (good-text? id 80)) (conj :invalid-id)
    (not (good-text? title 160)) (conj :invalid-title)
    (not (and (integer? at) (pos? at))) (conj :invalid-time)))
(defn save-event [events event]
  (cond
    (not (vector? events)) {:error "invalid-state"}
    (seq (event-problems event)) {:error "invalid-event"}
    (and (>= (count events) 200) (not-any? #(= (:id %) (:id event)) events)) {:error "event-limit"}
    :else {:events (->> (conj (vec (remove #(= (:id %) (:id event)) events))
                              (select-keys event [:id :title :at]))
                        (sort-by :at) vec)}))
(defn next-event [events now]
  (first (sort-by :at (filter #(and (empty? (event-problems %)) (>= (:at %) now)) events))))

(defn runtime-descriptor []
  {:schema "kotoba.app.client-runtime.v1" :target "browser" :profile "trusted-page-v1"
   :entry "index.html" :local-state {:adapter "localstorage" :schema "itonami.store.local.v1" :version 1}
   :workers [] :operations []})
