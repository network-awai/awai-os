(ns itonami.store.setup)
;; Index 2 ("network") is retired and never shown: AOSP setup owns connectivity.
;; Indices stay stable so saved progress keeps its meaning.
(def stages ["welcome" "language" "network" "datetime" "account" "privacy" "lock" "done"])
(defn stage-name [n] (get stages n "welcome"))
(defn next-action [{:keys [stage secure account]}]
  (case stage
    4 "account-required"
    6 (if secure "next" "lock-required")
    7 (if (and secure (or (= account "deferred") (= account "linked"))) "finish" "refused")
    "next"))
