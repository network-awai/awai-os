(ns itonami.otehon.tick
  "Due jobs and next fire times, without running anything.

  Ported from src/itonami/agent/cron.cljk (parse-cron, next-cron,
  next-run, due?) but pure: time is data, never a host call.

  A moment is {:year :month :day :hour :minute} (month 1-12) plus, where a
  comparison with jobs.json is needed, :iso (the same ISO local string the
  legacy route writes, compared lexicographically). The caller builds the
  moment: the shared cases fix it in edn, the CLI reads it from
  itonami.otehon.io/now-parts. Nothing here touches a disk, a clock, a
  process or the network: planning only, :side-effects :none."
  (:require [clojure.string :as str]
            [itonami.otehon.cron :as cron]))

;; ---------------------------------------------------------------- integers

(defn- parse-int
  "A decimal integer or nil. Pure: js/parseInt (which the legacy route uses)
  does not exist on every runner."
  [s]
  (let [t (str/trim (str s))]
    (when (re-find #"^[+-]?\d+$" t)
      (let [neg (str/starts-with? t "-")
            ds (if (or neg (str/starts-with? t "+")) (subs t 1) t)
            n (reduce (fn [a ch] (+ (* a 10) (- (int ch) (int \0)))) 0 ds)]
        (if neg (- n) n)))))

;; ---------------------------------------------------------------- 5-field cron

(def ^:private dow-names
  {"sun" 0 "mon" 1 "tue" 2 "wed" 3 "thu" 4 "fri" 5 "sat" 6})

(defn- expand-part
  "One comma-separated field of a cron part into a sorted vector of ints."
  [field lo hi]
  (let [named (reduce (fn [s [k v]] (str/replace s (re-pattern (str "(?i)" k)) (str v)))
                      field dow-names)
        step-split (fn [p] (str/split p #"/"))
        nums (mapcat (fn [part]
                       (let [[rng step-s] (step-split part)
                             step (or (parse-int (or step-s "1")) 1)
                             step (if (pos? step) step 1)
                             [a b] (cond
                                     (= rng "*") [lo hi]
                                     (str/includes? rng "-")
                                     (let [[x y] (str/split rng #"-")]
                                       [(parse-int x) (parse-int y)])
                                     :else (let [v (parse-int rng)]
                                             [v (if (str/includes? part "/") hi v)]))]
                         (if (or (nil? a) (nil? b))
                           (throw (ex-info (str "cron: bad field part: " part) {:part part}))
                           (range a (inc b) step))))
                     (str/split named #","))]
    (vec (sort (distinct nums)))))

(defn parse-cron
  "A 5-field cron expression into {:minute :hour :dom :month :dow :dom* :dow*}
  of sorted vectors. Throws ex-info when the shape is wrong."
  [expr]
  (let [fields (vec (remove str/blank? (str/split (str/trim (str expr)) #"\s+")))]
    (when (not= 5 (count fields))
      (throw (ex-info (str "cron: need 5 fields: " expr) {:expr expr})))
    (let [[mi ho dm mo dw] fields]
      {:minute (expand-part mi 0 59)
       :hour (expand-part ho 0 23)
       :dom (expand-part dm 1 31)
       :month (expand-part mo 1 12)
       :dow (vec (sort (distinct (map #(mod % 7) (expand-part dw 0 7)))))
       :dom* (= dm "*")
       :dow* (= dw "*")})))

;; ---------------------------------------------------------------- civil date arithmetic (pure)

(defn leap-year? [y]
  (and (zero? (mod y 4)) (or (not (zero? (mod y 100))) (zero? (mod y 400)))))

(defn days-in-month [y m]
  (case m
    1 31 3 31 5 31 7 31 8 31 10 31 12 31
    4 30 6 30 9 30 11 30
    2 (if (leap-year? y) 29 28)
    (throw (ex-info (str "month out of range: " m) {:month m}))))

(defn- days-from-civil
  "Days since 1970-01-01 (Howard Hinnant's algorithm), all pure math."
  [y m d]
  (let [y (if (<= m 2) (dec y) y)
        era (quot (if (>= y 0) y (dec y)) 400)
        yoe (- y (* era 400))
        mp (if (> m 2) (- m 3) (+ m 9))
        doy (+ (quot (+ (* 153 mp) 2) 5) (dec d))
        doe (+ (* yoe 365) (quot yoe 4) (- (quot yoe 100)) doy)]
    (+ (* era 146097) doe -719468)))

(defn dow-of
  "Day of week of a civil date: 0 Sunday .. 6 Saturday."
  [y m d]
  (mod (+ (days-from-civil y m d) 4) 7))

(defn- in? [xs v] (boolean (some #(= % v) xs)))

(defn- day-ok? [{:keys [dom dow dom* dow*]} y m d]
  ;; Vixie cron: when both are restricted, either matches.
  (let [a (in? dom d) b (in? dow (dow-of y m d))]
    (cond (and dom* dow*) true dom* b dow* a :else (or a b))))

(defn- inc-minute [{:keys [year month day hour minute]}]
  (let [minute (inc minute)]
    (if (< minute 60)
      {:year year :month month :day day :hour hour :minute minute}
      (let [hour (inc hour)]
        (if (< hour 24)
          {:year year :month month :day day :hour hour :minute 0}
          (let [day (inc day)]
            (if (<= day (days-in-month year month))
              {:year year :month month :day day :hour 0 :minute 0}
              (if (= month 12)
                {:year (inc year) :month 1 :day 1 :hour 0 :minute 0}
                {:year year :month (inc month) :day 1 :hour 0 :minute 0}))))))))

(defn- plus-minutes [parts n]
  (nth (iterate inc-minute parts) n))

(defn next-cron-parts
  "First minute strictly after `now` matching expr, as parts.
  Nil past the guard (a year of minutes), like the legacy route's nil."
  [expr now]
  (let [c (parse-cron expr)
        start (inc-minute (select-keys now [:year :month :day :hour :minute]))]
    (loop [p start guard 0]
      (cond
        (> guard 600000) nil
        (not (in? (:month c) (:month p)))
        (recur (if (= (:month p) 12)
                 {:year (inc (:year p)) :month 1 :day 1 :hour 0 :minute 0}
                 {:year (:year p) :month (inc (:month p)) :day 1 :hour 0 :minute 0})
               (inc guard))
        (not (day-ok? c (:year p) (:month p) (:day p)))
        (recur (let [d (inc (:day p))]
                 (if (<= d (days-in-month (:year p) (:month p)))
                   (assoc p :day d :hour 0 :minute 0)
                   (if (= (:month p) 12)
                     {:year (inc (:year p)) :month 1 :day 1 :hour 0 :minute 0}
                     {:year (:year p) :month (inc (:month p)) :day 1 :hour 0 :minute 0})))
               (inc guard))
        (not (in? (:hour c) (:hour p)))
        (recur (if (= (:hour p) 23)
                 (let [d (inc (:day p))]
                   (if (<= d (days-in-month (:year p) (:month p)))
                     (assoc p :day d :hour 0 :minute 0)
                     (if (= (:month p) 12)
                       {:year (inc (:year p)) :month 1 :day 1 :hour 0 :minute 0}
                       {:year (:year p) :month (inc (:month p)) :day 1 :hour 0 :minute 0})))
                 (assoc p :hour (inc (:hour p)) :minute 0))
               (inc guard))
        (not (in? (:minute c) (:minute p)))
        (recur (inc-minute p) (inc guard))
        :else p))))

;; ---------------------------------------------------------------- jobs

(defn next-run
  "Next fire time of a job after `now` ({:iso :parts}), or nil for a spent
  one-shot. Cron and interval answers are parts; a future one-shot answers
  {:iso run-at}."
  [job now]
  (let [{:strs [kind expr minutes run_at]} (get job "schedule")]
    (case kind
      "cron" (when expr (next-cron-parts expr (:parts now)))
      "interval" (when (and (integer? minutes) (pos? minutes))
                   (plus-minutes (:parts now) minutes))
      "once" (when (and (string? run_at) (string? (:iso now)) (pos? (compare run_at (:iso now))))
               {:iso run_at})
      nil)))

(defn due?
  "An active job whose next_run_at has passed. next_run_at strings come from
  one writer (the legacy route, then this one), so lexicographic order is
  time order."
  [job now-iso]
  (and (cron/active? job)
       (string? (get job "next_run_at"))
       (string? now-iso)
       (<= (compare (get job "next_run_at") now-iso) 0)))

(defn tick-plan
  "What one tick would do, without doing it: {:now :due [ids in job order]
  :next {id next-or-nil}}. Advancing next_run_at before running (at-most-once)
  stays the host's job; this is the data it advances to."
  [jobs now]
  {:now (:iso now)
   :due (vec (keep #(when (due? % (:iso now)) (get % "id")) jobs))
   :next (into {} (map (fn [j] [(get j "id") (next-run j now)]) jobs))})
