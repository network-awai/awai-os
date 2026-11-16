(ns itonami.otehon.yakuwari
  "yakuwari.edn: the authority for what a profile may do.

  Decision vocabulary :autonomous / :voice-required / :approval-required /
  :blocked. A legacy spelling reads as its modern word; any other word reads
  as :blocked. A capability yakuwari.edn does not list is :blocked (fail
  closed). Without yakuwari.edn a profile may only ask: every capability is
  the manifest's :authority :default-decision, at most :approval-required.
  itonami.edn :capabilities is a copy and never grants anything."
  (:require [itonami.otehon.manifest :as manifest]))

(defn- err [path msg] (manifest/problem :error path msg))
(defn- warn [path msg] (manifest/problem :warn path msg))

(defn read-decision
  "A decision word as yakuwari reads it."
  [d]
  (cond
    (contains? manifest/decisions d) d
    (contains? manifest/legacy-decisions d) (get manifest/legacy-decisions d)
    :else :blocked))

(defn validate
  "Problems with a yakuwari.edn map, [] when clean. Duplicate capability
  entries are an error: which one wins would be a guess."
  [y]
  (if-not (map? y)
    [(err [] "not a map")]
    (let [caps (:yakuwari/capabilities y)]
      (vec
       (concat
        (when (and (contains? y :yakuwari/id) (not (keyword? (:yakuwari/id y))))
          [(err [:yakuwari/id] "not a keyword")])
        (if-not (and (vector? caps) (every? map? caps))
          [(err [:yakuwari/capabilities] "not a vector of {:capability :decision}")]
          (concat
           (for [[i c] (map-indexed vector caps)
                 :let [d (:decision c) path [:yakuwari/capabilities i]]
                 p [(when-not (keyword? (:capability c)) (err (conj path :capability) "not a keyword"))
                    (cond
                      (contains? manifest/decisions d) nil
                      (contains? manifest/legacy-decisions d)
                      (warn (conj path :decision) (str d " is a legacy spelling; read as " (read-decision d)))
                      :else (warn (conj path :decision) (str (pr-str d) " is not in the vocabulary; read as :blocked")))]
                 :when p]
             p)
           (for [[cap n] (frequencies (map :capability caps)) :when (> n 1)]
             (err [:yakuwari/capabilities] (str cap " is listed " n " times"))))))))))

(defn decide
  "{:capability c :decision d :source s} for one capability.
  `y` is the yakuwari.edn map or nil; `authority` is the manifest's
  :authority map (only consulted without yakuwari.edn)."
  [y authority cap]
  (if (map? y)
    (if-let [entry (first (filter #(= cap (:capability %)) (:yakuwari/capabilities y)))]
      {:capability cap :decision (read-decision (:decision entry)) :source :yakuwari}
      {:capability cap :decision :blocked :source :unlisted})
    (let [d (read-decision (get authority :default-decision :approval-required))]
      {:capability cap
       ;; without yakuwari.edn nothing is autonomous
       :decision (if (contains? #{:autonomous :voice-required} d) :approval-required d)
       :source :default})))

(defn copy-drift
  "Warnings when itonami.edn :capabilities is not the copy of yakuwari.edn.
  Drift is reported, never acted on: decide reads yakuwari.edn only."
  [manifest-caps y]
  (when (map? y)
    (let [proj (fn [cs] (set (map #(select-keys % [:capability :decision]) cs)))]
      (when-not (= (proj manifest-caps) (proj (:yakuwari/capabilities y)))
        [(warn [:capabilities] "differs from yakuwari.edn; yakuwari.edn is the authority")]))))
