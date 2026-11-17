(ns itonami.store.setup)
(def stages ["welcome" "language" "network" "datetime" "account" "privacy" "lock" "done"])
(defn stage-name [n] (get stages n "welcome"))
(defn next-action [{:keys [stage secure validated offline account]}]
  (case stage
    2 (if (or validated offline) "next" "network-required")
    4 "account-required"
    6 (if secure "next" "lock-required")
    7 (if (and secure (or (= account "deferred") (= account "linked"))) "finish" "refused")
    "next"))
