(ns itonami.store.setup)
;; Indices 1 (language), 2 (network), 3 (datetime) and 6 (lock) are retired and
;; never shown: AOSP setup owns them. Completion still requires a device lock.
;; Indices stay stable so saved progress keeps its meaning.
(def stages ["welcome" "language" "network" "datetime" "account" "privacy" "lock" "done"])
(defn stage-name [n] (get stages n "welcome"))
(defn next-action [{:keys [stage secure account]}]
  (case stage
    4 "account-required"
    7 (if (and secure (or (= account "deferred") (= account "linked"))) "finish" "refused")
    "next"))
