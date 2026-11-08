(ns d1.core
  "D1 first vertical (ADR 0027) as .cljc Otehon oracle.

  Covers the decidable core only: D1 stage transitions, receipt shape,
  tsukasa declaration check (Otehon accepted 2-class reading of ADR 0010
  S2.1: wasm/container; the microvm bit is refused here and the divergence
  with the tsukasa 3-class mask stays an owner decision), itonami
  annotation/digest checks (only the two reason names the ADR text fixes),
  fune admission bounds, and the shared-node aggregate formula.

  Pure: no I/O, regex, dates or platform numbers. Same shared cases in
  test/cases.json check Basilisp and Babashka. Fund movement, live
  cutover, key custody and real node start (JUN-288/292/296/299/300)
  are out of scope and stay recorded blockers on AWAI-233.")

;; ---------------------------------------------------------------------------
;; D1 stages. Offer/Order/Reservation/Receipt/Acceptance/Settlement ride on
;; these states; each stage maps to at most one forward move, terminal
;; states never move. Redelivery of a stable request id replays, never
;; re-executes (shared-node-operations S5).

(def transitions
  {:proposed  #{:approved :denied}
   :approved  #{:reserved :refused}
   :reserved  #{:executing :expired}
   :executing #{:accepted :failed :expired}
   :accepted  #{:recorded :failed}})

(def terminal-states #{:denied :refused :expired :failed :recorded})

(defn transition
  "The next state, or a refusal map. Anything unlisted is refused."
  [from to]
  (if (contains? (get transitions from #{}) to)
    {:state to}
    {:refused true :from from :to to}))

(defn redeliver
  "A repeated delivery under the same stable request id. Executing work
  replays its current state; anything else is refused, never re-run."
  [state]
  (if (= state :executing)
    {:replay true :state :executing}
    {:refused true :from state :to state}))

;; ---------------------------------------------------------------------------
;; Receipt shape (awai.work-receipt/1, ADR 0027 D4). Prompt, output body
;; and credentials never enter a receipt; the input travels as a keyed
;; hash. Returns nil when the receipt is well-formed.

(def receipt-required
  #{:kind :work-kind :order :provider :node :input
    :output :engine :model :measured :ledger-head :demand :nonce})

(def receipt-forbidden
  #{:body :prompt :credential :output-text})

(def engine-required #{:name :version :digest})
(def model-required #{:revision :digest})
(def measured-required #{:prompt-tokens :completion-tokens :started-at :finished-at})

(defn- missing-keys [m required]
  (vec (filter #(nil? (get m %)) (sort-by name required))))

(defn receipt-problem
  [receipt]
  (let [missing (missing-keys receipt receipt-required)
        forbidden (vec (filter #(contains? receipt %) (sort-by name receipt-forbidden)))
        engine-missing (missing-keys (:engine receipt {}) engine-required)
        model-missing (missing-keys (:model receipt {}) model-required)
        measured-missing (missing-keys (:measured receipt {}) measured-required)]
    (when (or (seq missing) (seq forbidden)
              (seq engine-missing) (seq model-missing) (seq measured-missing))
      {:refused true
       :missing missing
       :forbidden forbidden
       :engine-missing engine-missing
       :model-missing model-missing
       :measured-missing measured-missing})))

;; ---------------------------------------------------------------------------
;; Tsukasa declaration check, Otehon 2-class reading. Reason literals are
;; the exact tsukasa strings; masks carrying the microvm bit are unknown
;; here because ADR 0010 S2.1 accepts only wasm/container. Precedence is
;; id, did, failure-domain, availability, runtime-classes.

(defn- blank? [s]
  (or (nil? s) (and (string? s) (= 0 (count s)))))

(defn- prefix? [s p]
  (and (string? s) (>= (count s) (count p)) (= (subs s 0 (count p)) p)))

(defn runtime-classes-problem
  [mask]
  (cond (or (not (integer? mask)) (< mask 0)) "tsukasa/unknown-runtime-class"
        (= mask 0) "tsukasa/missing-runtime-classes"
        (or (= mask 1) (= mask 2) (= mask 3)) "tsukasa/ok"
        :else "tsukasa/unknown-runtime-class"))

(defn has-runtime-class?
  "Membership by enumeration, mirroring tsukasa. Only the accepted
  classes wasm and container can ever be held; microvm is never held
  under the Otehon 2-class reading."
  [mask class]
  (cond (= class "wasm") (or (= mask 1) (= mask 3))
        (= class "container") (or (= mask 2) (= mask 3))
        :else false))

(defn first-problem
  [id did fd av mask]
  (let [a (if (blank? id) "tsukasa/missing-id" "tsukasa/ok")
        b (if (blank? did) "tsukasa/missing-did"
            (if (prefix? did "did:key:") "tsukasa/ok" "tsukasa/bad-did"))
        c (if (blank? fd) "tsukasa/missing-failure-domain" "tsukasa/ok")
        d (if (blank? av) "tsukasa/missing-availability"
            (if (or (= av "always-on") (= av "intermittent"))
              "tsukasa/ok" "tsukasa/bad-availability"))
        e (runtime-classes-problem mask)]
    (if (= a "tsukasa/ok")
      (if (= b "tsukasa/ok")
        (if (= c "tsukasa/ok") (if (= d "tsukasa/ok") e d) c)
        b)
      a)))

;; ---------------------------------------------------------------------------
;; Itonami annotation and digest checks. Only the two reason names the ADR
;; text fixes are used; grant and digest/CID/signature mismatches have no
;; individual itonami/ names yet (JUN-288), so they stay generic maps.

(defn annotation-problem
  "The L5 manifest class against the OCI annotation class."
  [manifest-class oci-class]
  (when (not= manifest-class oci-class)
    "itonami/runtime-class-mismatch"))

(def ^:private hex-digits "0123456789abcdef")

(defn- hex-char? [c]
  (some? (first (filter #(= % c) (seq hex-digits)))))

(defn- lower-char [c]
  (let [up "ABCDEF" lo "abcdef"]
    (or (first (keep-indexed (fn [i x] (when (= x c) (nth lo i))) (seq up))) c)))

(defn digest-problem
  "sha256:<64 lowercase hex> only, mirroring ADR 0010 S2.4."
  [digest]
  (let [body (when (prefix? digest "sha256:") (subs digest 7))]
    (if (and (some? body) (= 64 (count body))
             (every? hex-char? (map lower-char (seq body))))
      nil
      "itonami/unsupported-digest")))

;; ---------------------------------------------------------------------------
;; Fune admission bounds (fune-mvp-contract-proposal). Hard operator
;; ceilings; an operator may narrow them, never widen silently.

(def fune-bounds
  {:manifest-bytes 1048576
   :config-bytes   1048576
   :layers         32
   :layer-bytes    268435456
   :expanded-bytes 536870912
   :entries        50000
   :path-bytes     4096
   :argv-env-bytes 65536})

(def bound-order
  [:manifest-bytes :config-bytes :layers :layer-bytes
   :expanded-bytes :entries :path-bytes :argv-env-bytes])

(defn bound-problem
  "The first exceeded bound, or nil. Usage maps bound keys to numbers."
  [usage]
  (first
   (keep (fn [k]
           (let [used (get usage k 0) limit (get fune-bounds k)]
             (when (or (not (integer? used)) (< used 0) (> used limit))
               {:refused true :bound k :used used :limit limit})))
         bound-order)))

;; ---------------------------------------------------------------------------
;; Shared-node aggregate admission (shared-node-operations S3). A dry-run
;; answer is never a permit: it reports what would happen and allows
;; nothing.

(defn admission-eval
  "Keys: demand qualified reserve committed unmanaged fresh? dry-run?.
  Returns allow, wait, refused, or a dry-run report."
  [{:keys [demand qualified reserve committed unmanaged fresh? dry-run?]}]
  (let [nums [demand qualified reserve committed unmanaged]]
    (cond (or (some nil? nums) (some #(or (not (integer? %)) (< % 0)) nums))
          {:decision :refused :cause :invalid-amount}
          (not fresh?)
          {:decision :wait :cause :stale-observation}
          :else
          (let [free (- qualified reserve committed unmanaged)
                ok? (and (>= free 0) (<= demand free))]
            (if dry-run?
              {:decision :dry-run :would-allow ok?}
              (if ok?
                {:decision :allow}
                {:decision :wait :cause :insufficient-capacity}))))))
