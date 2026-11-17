(ns itonami.otehon.yaml
  "The YAML that Hermes profiles actually contain, read into EDN.

  A .cljc port of src/itonami/agent/yaml.cljk (the legacy reader checked
  against PyYAML on 1,954 host files). Same subset, same refusals: block
  mappings, block sequences, plain / single- / double-quoted scalars, `#`
  comments, `[]` / `{}` empties and flow sequences of scalars. Anchors, tags
  and aliases are refused by name rather than misread. Keys stay strings.

  Portability notes (Basilisp 0.5.1, Babashka, nbb): no `.charAt`, no
  `str/trimr`, no `array-map`, and no `\\\\` inside regex literals (Basilisp
  folds it to one backslash); `\\x5c` is used for a literal backslash."
  (:require [clojure.string :as str]))

(defn- trimr [s] (str/replace s #"\s+$" ""))

(defn- unescape-double [s]
  (str/replace s #"\x5c(.)"
               (fn [[_ c]] (case c "n" "\n" "t" "\t" "\"" "\"" "\\" "\\" c))))

(defn- strip-comment [s]
  ;; a `#` starts a comment only at line start or after whitespace, and never
  ;; inside quotes
  (loop [i 0 q nil]
    (if (>= i (count s))
      s
      (let [c (nth s i)]
        (cond
          (and (= q \") (= c \\)) (recur (+ i 2) q)
          q (recur (inc i) (if (= c q) nil q))
          (or (= c \") (= c \')) (recur (inc i) c)
          (and (= c \#) (or (zero? i) (re-matches #"\s" (str (nth s (dec i))))))
          (subs s 0 i)
          :else (recur (inc i) nil))))))

(defn scalar
  "One plain or quoted scalar to an EDN value."
  [raw]
  (let [s (str/trim raw)]
    (cond
      (= s "") nil
      (and (str/starts-with? s "\"") (str/ends-with? s "\"") (> (count s) 1))
      (unescape-double (subs s 1 (dec (count s))))
      (and (str/starts-with? s "'") (str/ends-with? s "'") (> (count s) 1))
      (str/replace (subs s 1 (dec (count s))) "''" "'")
      (contains? #{"~" "null" "Null" "NULL"} s) nil
      (contains? #{"true" "True" "TRUE"} s) true
      (contains? #{"false" "False" "FALSE"} s) false
      (= s "[]") []
      (= s "{}") {}
      (and (str/starts-with? s "[") (str/ends-with? s "]"))
      (mapv scalar (remove str/blank? (str/split (subs s 1 (dec (count s))) #",")))
      (re-matches #"-?\d+" s) (parse-long s)
      (re-matches #"-?\d+\.\d+([eE][-+]?\d+)?" s) (parse-double s)
      (contains? #{"|" ">" "|-" ">-"} s)
      (throw (ex-info (str "yaml: block scalar not supported: " s) {:yaml/refused :block-scalar}))
      (or (str/starts-with? s "&") (str/starts-with? s "*") (str/starts-with? s "!"))
      (throw (ex-info (str "yaml: anchors/aliases/tags not supported: " s) {:yaml/refused :anchor}))
      :else s)))

(defn- indent-of [l] (count (re-find #"^ *" l)))

(defn- dq
  "A string as a double-quoted YAML scalar, so a multi-line value can travel
  as one logical line and come back through `scalar` unchanged."
  [s]
  (str "\"" (-> s (str/replace "\\" "\\\\") (str/replace "\"" "\\\"") (str/replace "\n" "\\n")) "\""))

(defn- fold
  "YAML flow folding of continuation lines: a line break becomes a space, an
  empty line becomes a newline."
  [parts]
  (loop [ps (seq parts) acc "" brk? false]
    (if-not ps
      acc
      (let [p (first ps)]
        (if (str/blank? p)
          (recur (next ps) (str acc "\n") true)
          (recur (next ps) (str acc (if (or brk? (= acc "")) "" " ") (str/trim p)) false))))))

(defn- head-value
  "For a raw line `  key: v` or `  - v` / `  - key: v`, [prefix v] where prefix
  is everything before the value; nil when the line carries no value."
  [raw]
  (or (when-let [[_ pre v] (re-matches #"^(\s*(?:-\s+)?(?:\"[^\"]*\"|'[^']*'|[^\s\-#'\"\[{][^:]*?)\s*:\s+)(\S.*)$" raw)]
        [pre v])
      (when-let [[_ pre v] (re-matches #"^(\s*-\s+)(\S.*)$" raw)]
        [pre v])))

(defn- unclosed-quote? [v]
  (let [q (first v)]
    (and (contains? #{\' \"} q)
         (let [body (subs v 1)]
           (if (= q \')
             (not (re-find #"^(?:[^']|'')*'(?:\s*(?:#.*)?)$" body))
             (not (re-find #"^(?:[^\"\x5c]|\x5c.)*\"(?:\s*(?:#.*)?)$" body)))))))

(defn- closes? [q s]
  (if (= q \')
    (re-find #"(?:^|[^'])(?:'')*'\s*$" s)
    (re-find #"(?:^|[^\x5c])\"\s*$" s)))

(defn- join-raw
  "Raw lines -> raw logical lines: multi-line quoted scalars, block scalars
  (`|`, `|-`, `>`, `>-`) and plain continuation lines are folded into one
  line holding a double-quoted scalar."
  [raws]
  (loop [i 0 out []]
    (if (>= i (count raws))
      out
      (let [raw (trimr (nth raws i))
            [pre v] (head-value (strip-comment raw))
            v (some-> v trimr)
            ind (indent-of raw)]
        (cond
          ;; a quoted scalar that does not close on its own line
          (and v (unclosed-quote? v))
          (let [q (first v)
                [parts j] (loop [j (inc i) parts [(subs v 1)]]
                            (let [r (nth raws j nil)]
                              (cond
                                (nil? r) [parts j]
                                (closes? q (trimr r))
                                (let [last-part (str/replace (trimr r) #".$" "")]
                                  ;; a line holding only the closing quote adds nothing
                                  [(if (str/blank? last-part) parts (conj parts last-part)) (inc j)])
                                :else (recur (inc j) (conj parts r)))))
                text (fold parts)
                text (if (= q \') (str/replace text "''" "'") (unescape-double text))]
            (recur j (conj out (str pre (dq text)))))

          ;; block scalar
          (and v (re-matches #"[|>][-+]?" v))
          (let [[body j] (loop [j (inc i) body []]
                           (let [r (nth raws j nil)]
                             (if (and r (or (str/blank? r) (> (indent-of r) ind)))
                               (recur (inc j) (conj body r))
                               [body j])))
                body (vec (reverse (drop-while str/blank? (reverse body))))
                bi (or (some #(when-not (str/blank? %) (indent-of %)) body) 0)
                body (map #(if (str/blank? %) "" (subs % (min bi (count %)))) body)
                text (if (str/starts-with? v "|") (str/join "\n" body) (fold body))
                text (if (str/ends-with? v "-") text (str text "\n"))]
            (recur j (conj out (str pre (dq text)))))

          ;; plain scalar continued on more-indented lines that are not keys
          (and v (not (contains? #{\' \" \[ \{} (first v))))
          (let [[parts j] (loop [j (inc i) parts [v]]
                            (let [r (nth raws j nil)]
                              (if (and r (not (str/blank? r)) (> (indent-of r) ind)
                                       (not (head-value r)) (not (str/starts-with? (str/trim r) "#")))
                                (recur (inc j) (conj parts r))
                                [parts j])))]
            (recur j (conj out (if (= 1 (count parts)) raw (str pre (dq (fold parts)))))))

          :else (recur (inc i) (conj out raw)))))))

(defn- lines [text]
  (->> (join-raw (vec (str/split-lines text)))
       (map-indexed (fn [i l] (let [l (trimr (strip-comment l))]
                                {:n (inc i) :indent (indent-of l) :text (str/trim l)})))
       (remove #(or (str/blank? (:text %)) (= "---" (:text %))))
       vec))

(defn- split-key [t]
  ;; `key: value` where key may be quoted; returns [key rest] or nil
  (when-let [[_ k r] (or (re-matches #"^\"([^\"]*)\"\s*:(?:\s+(.*))?$" t)
                         (re-matches #"^'([^']*)'\s*:(?:\s+(.*))?$" t)
                         (re-matches #"^([^:\[\]{}#][^:]*?)\s*:(?:\s+(.*))?$" t))]
    [k (or r "")]))

(declare parse-block)

(defn- parse-seq [ls i indent]
  (loop [i i acc []]
    (let [l (get ls i)]
      (if (and l (= (:indent l) indent) (str/starts-with? (:text l) "-")
               (or (= "-" (:text l)) (str/starts-with? (:text l) "- ")))
        (let [rest-t (str/trim (subs (:text l) 1))]
          (cond
            (= rest-t "")
            (let [[v j] (parse-block ls (inc i) (:indent (get ls (inc i) {:indent (inc indent)})))]
              (recur j (conj acc v)))
            (split-key rest-t)
            ;; `- key: v` opens a mapping whose further keys sit at indent+2
            (let [inner (+ indent 2 (- (count (:text l)) 2 (count rest-t)))
                  ls' (assoc ls i (assoc l :indent inner :text rest-t))
                  [v j] (parse-block ls' i inner)]
              (recur j (conj acc v)))
            :else (recur (inc i) (conj acc (scalar rest-t)))))
        [acc i]))))

(defn- parse-map [ls i indent]
  (loop [i i acc {}]
    (let [l (get ls i)]
      (if (and l (= (:indent l) indent) (not (str/starts-with? (:text l) "- ")))
        (let [[k r] (or (split-key (:text l))
                        (throw (ex-info (str "yaml: line " (:n l) ": expected key: value") {:line (:n l)})))]
          (if (str/blank? r)
            (let [nxt (get ls (inc i))]
              (cond
                (nil? nxt) [(assoc acc k nil) (inc i)]
                (> (:indent nxt) indent)
                (let [[v j] (parse-block ls (inc i) (:indent nxt))] (recur j (assoc acc k v)))
                ;; a sequence may sit at the same indent as its key
                (and (= (:indent nxt) indent) (str/starts-with? (:text nxt) "- "))
                (let [[v j] (parse-seq ls (inc i) indent)] (recur j (assoc acc k v)))
                :else (recur (inc i) (assoc acc k nil))))
            (recur (inc i) (assoc acc k (scalar r)))))
        [acc i]))))

(defn- parse-block [ls i indent]
  (let [l (get ls i)]
    (cond
      (nil? l) [nil i]
      (or (= "-" (:text l)) (str/starts-with? (:text l) "- ")) (parse-seq ls i indent)
      :else (parse-map ls i indent))))

(defn parse
  "YAML text -> EDN (maps with string keys). Empty text -> {}."
  [text]
  (let [ls (lines (or text ""))]
    (if (empty? ls)
      {}
      (let [[v i] (parse-block ls 0 (:indent (first ls)))]
        (when (< i (count ls))
          (throw (ex-info (str "yaml: unparsed from line " (:n (get ls i))) {:line (:n (get ls i))})))
        v))))
