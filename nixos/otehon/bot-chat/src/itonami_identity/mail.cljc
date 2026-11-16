(ns itonami-identity.mail (:require [clojure.string :as str]))
(defn require! [condition reason] (when-not condition (throw (ex-info reason {}))))
(defn uuid? [s] (boolean (and (string? s) (re-matches #"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}" s))))
(defn bot? [s] (boolean (and (string? s) (re-matches #"profile:[A-Za-z0-9_.-]{1,200}" s))))
(defn bounded? [s n] (and (string? s) (not (str/blank? s)) (<= (count s) n) (not (re-find #"[\u0000-\u001f\u007f]" s))))
(defn binding-data [b] (array-map :schema "itonami.mail-principal-binding.v1" :principalId (:principalId b) :botId (:botId b) :did (:did b) :epoch (:epoch b)))
(defn directory [events binding now]
 (let [stopped (set (map :aliasId (filter #(= "stop" (:action %)) events)))
       rows (mapv (fn [e] (let [a (:alias e)] (assoc a :state (cond (contains? stopped (:aliasId a)) "stopped" (and (:expiryMs a) (<= (:expiryMs a) now)) "expired" :else "reserved")))) (filter #(= "issue" (:action %)) events))]
  (require! (= (count rows) (count (set (map :aliasId rows))) (count (set (map :address rows)))) "mail-directory-conflict")
  {:principalId (:principalId binding) :did (:did binding) :epoch (:epoch binding) :aliases (vec (reverse (sort-by :createdAt rows)))}))
(defn request-data [r principal]
 (array-map :action (:action r) :principalId principal :botId (:botId r) :purpose (:purpose r) :counterparty (:counterparty r) :expiresAt (:expiresAt r) :aliasId (:aliasId r)))
(defn plan [binding events request {:keys [now at aliasId local requestSha expiryMs]}]
 (require! (contains? #{"list" "issue" "stop"} (:action request)) "invalid-mail-action")
 (require! (some #{(:action request)} (:actions binding)) "mail-operation-not-granted")
 (if (= "list" (:action request)) {:view (directory events binding now)}
  (let [prior (first (filter #(= (:requestId request) (:requestId %)) events)) view (directory events binding now)]
   (require! (uuid? (:requestId request)) "invalid-mail-request")
   (if prior (do (require! (= requestSha (:requestSha prior)) "mail-request-conflict") {:view view :replay true})
    (do
     (if (= "issue" (:action request))
      (do (require! (and (bounded? (:purpose request) 120) (bounded? (:counterparty request) 254) (< (count (:aliases view)) 1000)
                        (or (nil? (:expiresAt request)) (and (number? expiryMs) (> expiryMs now)))) "invalid-mail-request")
          (require! (not-any? #(= (str local "@awai.network") (:address %)) (:aliases view)) "mail-address-collision"))
      (require! (some #(= (:aliasId request) (:aliasId %)) (:aliases view)) "mail-alias-not-found"))
     {:event (merge {:schema "itonami.private-mail-alias-event.v1" :principalId (:principalId binding) :botId (:botId binding)
                    :did (:did binding) :epoch (:epoch binding) :requestId (:requestId request) :requestSha requestSha :action (:action request) :at at}
              (if (= "issue" (:action request))
               {:alias {:aliasId aliasId :address (str local "@awai.network") :purpose (str/trim (:purpose request)) :counterparty (str/trim (:counterparty request))
                        :createdAt at :expiresAt (:expiresAt request) :expiryMs expiryMs :routing "not-provisioned"}}
               {:aliasId (:aliasId request)}))})))))
(defn usable-alias [view id] (let [a (first (filter #(= id (:aliasId %)) (:aliases view)))] (require! (= "reserved" (:state a)) "mail-alias-inactive") a))
