(ns itonami.otehon.soul
  "The generated blocks of an itonami profile's SOUL.md: world, unit and role.

  A verbatim .cljc port of soul.cljk: string shape in, string shape out;
  the only host touch is the block sha (sha256-utf8). `splice` never
  changes the body — (strip (splice soul blocks)) = (strip soul) — and
  the command refuses a profile where that would not hold."
  (:require [clojure.string :as str]
            [itonami.otehon.io :as hio]))

(def kinds [:world :unit :role])

(def ws-end "<!-- /managed-agent-workspace-locations -->")

(def limit
  "Characters the three generated blocks may take together."
  1500)

(def ^:private block-rx
  ;; a generated block with the blank line in front of it
  #"\n\n<!-- itonami:(world|unit|role):v1 sha=[0-9a-f]+ -->\n[\s\S]*?\n<!-- /itonami:\1:v1 -->")

(def ^:private top-rx
  ;; a generated block opening a SOUL that has no workspace-locations block
  #"^<!-- itonami:(world|unit|role):v1 sha=[0-9a-f]+ -->\n[\s\S]*?\n<!-- /itonami:\1:v1 -->\n\n")

(defn strip
  "The SOUL without its generated blocks: what `splice` must leave unchanged."
  [soul]
  (-> (str soul) (str/replace block-rx "") (str/replace top-rx "")))

(defn- block [k text]
  (str "<!-- itonami:" (name k) ":v1 sha=" (subs (hio/sha256-utf8 text) 0 12) " -->\n"
       text "\n<!-- /itonami:" (name k) ":v1 -->"))

(defn- bullets [xs] (str/join "\n" (map #(str "- " %) (remove nil? xs))))

(defn- label [x] (if (keyword? x) (subs (str x) 1) (str x)))

;; ---------------------------------------------------------------- world

(defn world-text
  "The world block's text for a registry entry."
  [entry worlds]
  (let [ws (:worlds worlds)
        path (:org/path entry)
        named (fn [k] (or (get-in ws [k :name]) (label k)))
        chain (or (seq (filter #(contains? ws %) path)) [(:org/world entry)])
        joined (fn [ls] (str/join "。" (map :line ls)))]
    (str "## 組織（manifest/worlds.edn から生成。手で直さない）\n\n"
         (bullets
          (concat
           [(str "系列: " (if (seq path) (str/join " › " (map named path)) "組織の木の外（ホスト運用）"))]
           (for [k chain :let [ls (get-in ws [k :soul])] :when (seq ls)]
             (str (named k) ": " (joined ls)))
           (when-let [ls (seq (:soul/common worlds))]
             [(str "共通: " (joined ls))]))))))

;; ---------------------------------------------------------------- unit

(defn unit-text
  "The unit block's text for a registry entry."
  [entry worlds]
  (let [{:keys [org/unit org/world org/parent org/layer agent/kind invocation awai/business source outward]} entry
        u (get-in worlds [:worlds world :units (if (string? unit) (keyword unit) unit)])
        what (or (:what u) (:question u))]
    (str "## 所属（manifest/agent-registry.edn から生成。手で直さない）\n\n"
         (bullets
          [(when unit (str "unit: " (label unit) (when what (str " — " what))))
           (str "kind: " (label kind) "　／　上位の steward: " (or parent "なし（owner 直下）")
                (when invocation (str "　／　起動: " (label invocation))))
           (when-let [r (:repo source)] (str "担当 repo: " r))
           (when business (str "awai の事業: " (label business)))
           (when layer (str "kotoba の層: " (label layer)))
           (when outward
             (str "外向き役割: " (label (:business outward)) " の " (label (:role outward))
                  "（宛先 " (:mailbox outward) "、identity " (:identity outward) "）。会社として外に向けて話すのはこの役割だけ"))]))))

;; ---------------------------------------------------------------- role

(def ^:private decision-labels
  [[:autonomous "自律"] [:voice-required ":voice-required"] [:approval-required "承認が要る"] [:blocked "禁止"]])

(defn- names [caps n]
  (let [ns (map (comp label :capability) caps)]
    (str (str/join "、" (take n ns))
         (when (> (count ns) n) (str " ほか " (- (count ns) n) " 件")))))

(defn role-text
  "The role block's text: yakuwari.edn's capabilities grouped by decision, or
  the manifest's default when the profile has no yakuwari.edn."
  [caps authority n]
  (let [by (group-by :decision caps)
        known (set (map first decision-labels))]
    (str "## 権限（yakuwari.edn の要約。正本は yakuwari.edn。手で直さない）\n\n"
         (bullets
          (if (seq caps)
            (concat
             (for [[d l] decision-labels :let [cs (get by d)] :when (seq cs)] (str l ": " (names cs n)))
             (for [[d cs] by :when (not (known d))] (str (pr-str d) "（yakuwari の語彙に無い。yakuwari は :blocked と読む）: " (names cs n)))
             ["yakuwari.edn に無い capability は禁止（yakuwari は :blocked と読む）"])
            [(str "yakuwari.edn なし。既定は " (label (or (:default-decision authority) :approval-required)) "（提案まで）")
             "権限を足すときは yakuwari.edn を作る。SOUL や itonami.edn に権限を書かない"])))))

;; ---------------------------------------------------------------- render / splice

(defn generated-size [blocks] (reduce + (map (comp count blocks) kinds)))

(defn render
  "The three blocks for a profile. Capability lists shrink until the blocks
  fit `limit`; when even one name per decision does not fit, the result is
  over the limit and the command refuses it."
  [entry worlds caps authority]
  (let [fixed {:world (block :world (world-text entry worlds))
               :unit (block :unit (unit-text entry worlds))}]
    (or (first (for [n [12 8 5 3 1]
                     :let [b (assoc fixed :role (block :role (role-text caps authority n)))]
                     :when (<= (generated-size b) limit)]
                 b))
        (assoc fixed :role (block :role (role-text caps authority 1))))))

(defn splice
  "The SOUL with `blocks` in place: right after the workspace-locations block,
  or at the top when there is none. Earlier generated blocks are replaced;
  nothing else moves."
  [soul blocks]
  (let [base (strip soul)
        gen (str/join "\n\n" (map blocks kinds))]
    (if-let [i (str/index-of base ws-end)]
      (let [j (+ i (count ws-end))]
        (str (subs base 0 j) "\n\n" gen (subs base j)))
      (str gen "\n\n" base))))
