(ns itonami.store.pc-setup
  "PC setup wizard — AWAI-4072. Mirrors the mobile SetupWizard semantics (AWAI-3004)
   but PC-adapted: Welcome/language/network/date-time are visible wizard pages
   on PC, hardware-adaptive (Ethernet / Wi-Fi / tethering), keyboard / mouse
   focus friendly, and integrated with Settings APIs for locale / connectivity /
   date-time. Settings APIs own locale, validated connectivity, date-time and
   enrollment; this namespace only decides the page order and honesty gates.")

;; Same indices as itonami.store.setup so saved progress keeps its meaning.
(def stages ["welcome" "language" "network" "datetime" "account" "privacy" "lock" "done"])
(def stage-count (count stages))

(defn stage-name [n] (get stages n "welcome"))

;; Profile transfer is honestly unavailable until the account handover lands.
(def profile-transfer :unavailable)

(defn available-transports [{:keys [hasEthernet hasWifi hasTethering]}]
  (cond-> []
    hasEthernet (conj "ethernet")
    hasWifi     (conj "wifi")
    hasTethering (conj "tethering")
    (and (not hasEthernet) (not hasWifi) (not hasTethering)) (conj "wifi")))

(defn next-action [{:keys [stage secure account validated connected locale timeZone
                          hasEthernet hasWifi hasTethering]}]
  (case stage
    ;; Language step: locale must be readable (native Settings supplies it).
    1 (if (string? locale) "next" "refused")
    ;; Network step: validated (or captive / offline explicit) — never fabricate.
    2 (if (or validated connected (nil? validated)) "next" "refused")
    ;; Date-time: timezone observable.
    3 (if (string? timeZone) "next" "refused")
    ;; Account: profile transfer unavailable — must defer or purely sign-in flow.
    4 "account-required"
    7 (if (and secure (or (= account "deferred") (= account "linked"))) "finish" "refused")
    "next"))

(defn pc-complete? [{:keys [stage secure account]}]
  (and (= stage 7) secure (or (= account "deferred") (= account "linked"))))

(defn honest-profile-copy []
  "プロフィールの転送はまだ利用できません。この端末で続けるか、あとで設定してください。")
