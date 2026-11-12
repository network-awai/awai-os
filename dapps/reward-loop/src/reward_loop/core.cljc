(ns reward-loop.core
  "Reward-loop stock-flow (AWAI-2812) as .cljc Otehon oracle.

  A decidable model of the D1 first vertical's economy loop (ADR 0027):
  demand is injected, admitted to providers, executed, accepted on a
  signed receipt, then settled against prefunded pools. Units are plain
  integer counts; verification verdicts arrive as explicit inputs, never
  as self-report. Refusals use the exact reward-loop/* reason literals.

  Pure: no I/O, randomness, dates or platform numbers. Same shared cases
  in test/cases.json check Basilisp and Babashka. Lending, AMM/liquidity,
  real funds, live cutover and production wiring are out of scope and
  stay recorded blockers on AWAI-234/AWAI-499.")

;; ---------------------------------------------------------------------------
;; State. Six unit stocks plus the funding envelope. :dropped is a terminal
;; sink: failed-verdict units leave the loop and can never be paid.

(defn fresh
  "The empty loop: no demand, no funding."
  []
  {:backlog 0 :leased 0 :pending 0 :payable 0 :paid 0 :dropped 0
   :funded 0 :spent 0})

(defn- count-problem
  "nil when n is a usable unit count, else the refusal reason."
  [n reason]
  (when (or (not (integer? n)) (< n 1)) reason))

(defn fund
  "Prefund the settlement pool. The only way value enters the loop."
  [state amount]
  (if-let [problem (count-problem amount "reward-loop/non-positive-funding")]
    {:refused true :reason problem :amount amount}
    (update state :funded + amount)))

(defn inject
  "New demand arrives and waits for admission."
  [state n]
  (if-let [problem (count-problem n "reward-loop/non-positive-demand")]
    {:refused true :reason problem :n n}
    (update state :backlog + n)))

(defn assign
  "Admit up to n backlog units to providers. Capped by the policy
  admit-max and by the backlog itself; capping is reported, never refused."
  [state n policy]
  (let [cap (:admit-max policy)]
    (cond (count-problem n "reward-loop/non-positive-count")
          {:refused true :reason "reward-loop/non-positive-count" :n n}
          (or (not (integer? cap)) (< cap 1))
          {:refused true :reason "reward-loop/bad-policy" :policy policy}
          :else
          (let [k (min n cap (:backlog state))]
            (-> state
                (update :backlog - k)
                (update :leased + k)
                (assoc :assigned k))))))

(defn execute
  "Providers run leased work; receipts await acceptance. Capped by the
  leased stock, never over it."
  [state n]
  (if (count-problem n "reward-loop/non-positive-count")
    {:refused true :reason "reward-loop/non-positive-count" :n n}
    (let [k (min n (:leased state))]
      (-> state
          (update :leased - k)
          (update :pending + k)
          (assoc :executed k)))))

(defn accept
  "Accept ok receipts for settlement, drop bad ones. ok and bad must
  be integers, at least one unit moves, and both must fit inside the
  pending stock together. All-bad acceptance is legal: those units are
  dropped and can never be paid."
  [state ok bad]
  (cond (or (not (integer? ok)) (not (integer? bad)))
        {:refused true :reason "reward-loop/bad-count" :ok ok :bad bad}
        (or (< ok 0) (< bad 0) (= (+ ok bad) 0))
        {:refused true :reason "reward-loop/non-positive-count" :ok ok :bad bad}
        (> (+ ok bad) (:pending state))
        {:refused true :reason "reward-loop/over-accept"
         :ok ok :bad bad :pending (:pending state)}
        :else
        (-> state
            (update :pending - (+ ok bad))
            (update :payable + ok)
            (update :dropped + bad))))

(defn settle
  "Settle n payable units against prefunded pools. Never beyond the
  payable stock, never beyond the unspent funding."
  [state n]
  (cond (count-problem n "reward-loop/non-positive-count")
        {:refused true :reason "reward-loop/non-positive-count" :n n}
        (> n (:payable state))
        {:refused true :reason "reward-loop/over-settle"
         :n n :payable (:payable state)}
        (> (+ (:spent state) n) (:funded state))
        {:refused true :reason "reward-loop/underfunded-settlement"
         :n n :funded (:funded state) :spent (:spent state)}
        :else
        (-> state
            (update :payable - n)
            (update :paid + n)
            (update :spent + n))))

(defn totals
  "Loop audit: every unit sits in exactly one stock, paid never
  exceeds funded."
  [state]
  (let [units (+ (:backlog state) (:leased state) (:pending state)
                 (:payable state) (:paid state) (:dropped state))]
    {:units units
     :paid (:paid state)
     :funded (:funded state)
     :within-funding (<= (:paid state) (:funded state))
     :funding-left (- (:funded state) (:spent state))}))

(def bottleneck-order [:admit :execute :verify-ok :settle-funds])

(defn bottleneck
  "The binding constraint on steady-state throughput: the slowest
  verified stage. Ties break by the fixed order above, so the answer
  is deterministic."
  [rates]
  (let [nums (map #(get rates %) bottleneck-order)]
    (cond (or (some nil? nums)
              (some #(or (not (number? %)) (< % 0)) nums))
          {:refused true :reason "reward-loop/bad-rates" :rates rates}
          :else
          (let [floor (apply min nums)]
            {:binding (first (filter #(= (get rates %) floor) bottleneck-order))
             :throughput floor}))))
