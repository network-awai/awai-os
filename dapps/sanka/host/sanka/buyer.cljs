(ns sanka.buyer
  "The buyer's side of a compute order through the mailbox (ADR 0051, C1b-4): an owner's bot seals
  one order to a device's offer and checks the sealed result it gets back. nbb only.

  `prepare-order` and `read-result` decide everything and do no I/O. `post!` and `subscribe!` are
  the only network calls, and both go to the offer's own mailbox origin."
  (:require ["node:crypto" :as crypto]
            [promesa.core :as p]
            [sanka.device :as device]
            [sanka.hpke :as hpke]
            [sanka.wire :as wire]))

(def ^:private most-life-seconds 3600)

(defn- refuse [code & [data]] (throw (ex-info (name code) (merge {:code code} data))))

(defn prepare-order
  "Checks the offer and the order and seals the order to the offer. Returns {:post {...} :pending {...}}.
  :pending holds the reply's private key: keep it only as long as the order can be answered."
  [{:keys [offer order prompt now]}]
  (let [offer-check (device/check-offer offer)
        offer-cid (wire/cid-of (wire/canonical offer))
        order-cid (wire/cid-of (wire/canonical order))
        now-seconds (quot now 1000)]
    (when-not (:ok offer-check) (refuse :buyer/offer-invalid {:errors (:errors offer-check)}))
    (when-not (some #(= % (:buyer order)) (:buyers offer)) (refuse :buyer/not-on-offer))
    (when-not (> (:expires-at order) now-seconds) (refuse :buyer/order-expired))
    (when-not (> (:expires-at offer) now-seconds) (refuse :buyer/offer-expired))
    (let [reply-private (hpke/generate-private)
          reply {:topic (.toString (crypto/randomBytes 16) "hex")
                 :seal-key (wire/seal-key-text (hpke/raw-public (hpke/private-key reply-private)))}
          envelope {:kind wire/order-kind :offer offer-cid :order order :order-cid order-cid
                    :prompt prompt :reply reply}
          envelope-check (device/check-order-envelope offer offer-cid envelope)]
      (when-not (:ok envelope-check) (refuse :buyer/envelope-invalid {:errors (:errors envelope-check)}))
      (let [{:keys [message context]} (wire/seal (:seal-key offer) (wire/order-info offer-cid) envelope)
            origin (get-in offer [:mailbox :origin])
            expires (min (:expires-at order) (+ now-seconds most-life-seconds))]
        {:post {:url (str origin "/" (get-in offer [:mailbox :topic]))
                :headers {"content-type" "text/plain" "x-expires" (str expires)}
                :body message}
         :pending {:offer-cid offer-cid
                   :order-cid order-cid
                   :mailbox origin
                   :reply-topic (:topic reply)
                   :reply-private (.toString reply-private "hex")
                   :expected-input (wire/input-hash (wire/input-key context) prompt)
                   :expires-at expires
                   :pins {:provider (:provider order)
                          :node (:node order)
                          :model-digest (get-in order [:model :digest])
                          :demand (:demand order)
                          :nonce (:nonce order)}}}))))

(defn read-result
  "nil when the message does not open for this order's reply key (anyone can post to a topic).
  Otherwise {:ok true :refused reason}, {:ok true :output text :receipt signed-receipt}, or
  {:ok false :errors [...]} for a result that opened but does not hold up."
  [{:keys [offer-cid order-cid reply-private expected-input pins]} message]
  (when-let [{:keys [document]} (wire/open (js/Buffer.from reply-private "hex")
                                           (wire/result-info offer-cid order-cid) message)]
    (let [checked (device/check-result-envelope offer-cid order-cid pins document)
          receipt (:receipt document)]
      (cond
        (not (:ok checked)) checked
        (:refused checked) checked
        :else (let [errors (cond-> []
                             (not (wire/signature-ok? receipt)) (conj "buyer/signature")
                             (not= (wire/output-cid (:output document)) (:output receipt)) (conj "buyer/output")
                             (not= expected-input (:input receipt)) (conj "buyer/input"))]
                (if (seq errors)
                  {:ok false :errors errors}
                  {:ok true :output (:output document) :receipt receipt}))))))

;; ---------------------------------------------------------------------------
;; The mailbox over HTTPS

(defn post!
  "POSTs one sealed message. Resolves to the HTTP status."
  [{:keys [url headers body]}]
  (p/let [response (js/fetch url #js {:method "POST" :headers (clj->js headers) :body body :redirect "error"})]
    (.-status response)))

(defn subscribe!
  "Reads the topic's stream and calls (on-message text) for each message until it returns a value
  other than nil, or the time runs out. Resolves to that value, or nil."
  [origin topic on-message timeout-ms]
  (let [control (js/AbortController.)
        timer (js/setTimeout #(.abort control) timeout-ms)]
    (-> (p/let [response (js/fetch (str origin "/" topic "/json") #js {:signal (.-signal control) :redirect "error"})
                reader (.getReader (.pipeThrough (.-body response) (js/TextDecoderStream.)))]
          (p/loop [buffer ""]
            (p/let [{:keys [done value]} (p/then (.read reader) #(js->clj % :keywordize-keys true))]
              (if done
                nil
                (let [lines (.split (str buffer value) "\n")
                      found (some (fn [text]
                                    (let [event (js->clj (js/JSON.parse text) :keywordize-keys true)]
                                      (when (= "message" (:event event)) (on-message (:message event)))))
                                  (butlast lines))]
                  (if (some? found) found (p/recur (last lines))))))))
        (p/catch (fn [_] nil))
        (p/finally (fn [] (js/clearTimeout timer) (.abort control))))))
