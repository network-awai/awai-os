;; The buyer against a fake provider and an in-memory mailbox.
;; usage (from dapps/sanka): nbb -cp src:host:test/host test/host/buyer_test.cljs
;; With MAILBOX_LIVE=<origin> the round trip also runs once through that real mailbox.
(ns buyer-test
  (:require [promesa.core :as p]
            [sanka.buyer :as buyer]
            [sanka.wire :as wire]
            [fake-provider :as fake]))

(def failures (atom []))
(def checks (atom 0))
(defn- check [name want got]
  (swap! checks inc)
  (when-not (= want got) (swap! failures conj (str name ": want " (pr-str want) " got " (pr-str got)))))

(def now (js/Date.now))
(def now-seconds (quot now 1000))
(def node (wire/ed25519-key))
(def owner-bot (wire/ed25519-key))
(def origin "https://mailbox.awai.network")

(defn- setup []
  (let [{:keys [offer seal-private]} (fake/make-offer {:node node :buyer owner-bot :origin origin :now-seconds now-seconds})
        order (fake/make-order {:offer offer :buyer owner-bot :now-seconds now-seconds})]
    {:offer offer :seal-private seal-private :order order}))

(defn- round-trip
  "Prepare, let the fake provider serve, and read what comes back."
  [& {:keys [facts tamper output] :or {facts fake/good-facts tamper identity output "Three meetings."}}]
  (let [{:keys [offer seal-private order]} (setup)
        {:keys [post pending]} (buyer/prepare-order {:offer offer :order order :prompt "Summarise the week." :now now})
        result-post (fake/serve {:offer offer :seal-private seal-private :node node :facts facts :output output
                                 :now-seconds now-seconds :tamper tamper}
                                (:body post))]
    {:post post :pending pending :result-post result-post
     :result (buyer/read-result pending (:body result-post))}))

(defn- refused-code [f]
  (try (f) nil (catch :default e (:code (ex-data e)))))

;; --- The order that goes out

(let [{:keys [offer order]} (setup)
      {:keys [post pending]} (buyer/prepare-order {:offer offer :order order :prompt "Summarise the week." :now now})]
  (check "posts to the offer's topic on the offer's origin" (str origin "/" (get-in offer [:mailbox :topic])) (:url post))
  (check "x-expires is the order's expiry when within one hour" (str (:expires-at order)) (get-in post [:headers "x-expires"]))
  (check "the body is base64url only" true (boolean (re-matches #"[A-Za-z0-9_-]+" (:body post))))
  (check "the prompt is not in the body" false (.includes (:body post) "Summarise"))
  (check "the prompt is not in the pending state" false (.includes (pr-str pending) "Summarise"))
  (check "the order does not open with another key" nil
         (wire/open (js/Buffer.alloc 32 7) (wire/order-info (:offer-cid pending)) (:body post)))
  (check "the reply topic differs from the offer topic" true (not= (:reply-topic pending) (get-in offer [:mailbox :topic]))))

(let [{:keys [offer order]} (setup)
      long-order (assoc order :expires-at (+ now-seconds 86400))
      {:keys [post]} (buyer/prepare-order {:offer offer :order long-order :prompt "p" :now now})]
  (check "x-expires is at most one hour" (str (+ now-seconds 3600)) (get-in post [:headers "x-expires"])))

(let [{:keys [offer order]} (setup)
      prepare #(buyer/prepare-order (merge {:offer offer :order order :prompt "p" :now now} %))]
  (check "a buyer not on the offer is refused before sealing" :buyer/not-on-offer
         (refused-code #(prepare {:order (assoc order :buyer (:did (wire/ed25519-key)))})))
  (check "an invalid offer is refused" :buyer/offer-invalid (refused-code #(prepare {:offer (assoc offer :value-class "live")})))
  (check "an expired order is refused" :buyer/order-expired (refused-code #(prepare {:order (assoc order :expires-at now-seconds)})))
  (check "an empty prompt is refused" :buyer/envelope-invalid (refused-code #(prepare {:prompt ""})))
  (check "a live order is refused" :buyer/envelope-invalid (refused-code #(prepare {:order (assoc order :value-class "live")}))))

;; --- What comes back

(let [{:keys [result]} (round-trip)]
  (check "a served order is read back" true (:ok result))
  (check "with the output" "Three meetings." (:output result))
  (check "and the node's signature" (:did node) (get-in result [:receipt :signer])))

(check "a refusal carries only its reason" {:ok true :refused "device/not-charging"}
       (:result (round-trip :facts (assoc fake/good-facts :charging false))))
(check "an order already run is refused by the device" {:ok true :refused "device/already-run"}
       (:result (round-trip :facts (assoc fake/good-facts :already-run true))))

(check "a receipt changed after signing fails the signature" {:ok false :errors ["buyer/signature"]}
       (:result (round-trip :tamper #(assoc-in % [:receipt :measured :completion-tokens] 41))))
(check "an output other than the receipt's fails" {:ok false :errors ["buyer/output"]}
       (:result (round-trip :tamper #(assoc % :output "Four meetings."))))
(let [other (wire/ed25519-key)]
  (check "a receipt signed by another key fails the node check" {:ok false :errors ["receipt/signer"]}
         (:result (round-trip :tamper #(update % :receipt (fn [r] (wire/sign-document other r)))))))

(let [{:keys [pending result-post]} (round-trip)]
  (check "a junk message on the reply topic is skipped" nil (buyer/read-result pending (wire/b64u (js/Buffer.alloc 96 1))))
  (check "a result for another order does not open" nil
         (buyer/read-result (assoc pending :order-cid (str "b" (apply str (repeat 58 "c")))) (:body result-post)))
  (check "a result does not open with the offer's info" nil
         (buyer/read-result (assoc pending :offer-cid (str "b" (apply str (repeat 58 "g")))) (:body result-post))))

(let [{:keys [pending result-post]} (round-trip)
      wrong-input (assoc pending :expected-input "hmac-sha256:00")]
  (check "a receipt whose input is not this prompt's keyed hash fails" {:ok false :errors ["buyer/input"]}
         (buyer/read-result wrong-input (:body result-post))))

;; --- Once through a real mailbox

(defn- live [live-origin]
  (let [{:keys [offer seal-private]} (fake/make-offer {:node node :buyer owner-bot :origin live-origin :now-seconds now-seconds})
        order (fake/make-order {:offer offer :buyer owner-bot :now-seconds now-seconds})
        {:keys [post pending]} (buyer/prepare-order {:offer offer :order order :prompt "Summarise the week." :now now})
        provider (buyer/subscribe! live-origin (get-in offer [:mailbox :topic])
                                   (fn [message]
                                     (fake/serve {:offer offer :seal-private seal-private :node node
                                                  :facts fake/good-facts :output "Three meetings."
                                                  :now-seconds now-seconds}
                                                 message))
                                   30000)]
    (p/let [_ (p/delay 1000)
            status (buyer/post! post)
            served (p/then provider #(some-> % buyer/post!))
            result (buyer/subscribe! live-origin (:reply-topic pending) #(buyer/read-result pending %) 30000)]
      (check "live: the order is accepted by the mailbox" 200 status)
      (check "live: the provider's result is accepted" 200 served)
      (check "live: the buyer reads back a checked result" true (:ok result))
      (check "live: with the output" "Three meetings." (:output result)))))

(p/let [_ (when-let [o (.-MAILBOX_LIVE js/process.env)] (live o))]
  (doseq [f @failures] (println "FAIL" f))
  (println "buyer checks" @checks "failures" (count @failures))
  (js/process.exit (if (seq @failures) 1 0)))
