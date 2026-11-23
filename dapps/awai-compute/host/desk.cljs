;; Awai compute desk for the EN devnet (AWAI-3115). nbb only, HTTPS on loopback.
;;
;; The Itonami app (Android WebView) reaches this desk through the shared consent broker. The
;; provider device signs the Offer (`awai.compute.offer/1`) with a non-exportable P-256 key and the
;; funding payload with the same key; this desk verifies both signatures against the enrolled
;; provider SPKI (trust on first use, devnet only), signs the funding transfer as the bot/acceptor
;; with its own key file, and submits it to the EN devnet node. It never retries a submission
;; without an answer.
;;
;; value-class devnet only. Nothing here is money, revenue or a donation. The work receipt is
;; issued from the node's finality readback, and contains no prompt or output body.
;;
;; usage (from dapps/awai-compute):
;;   nbb -cp src:../en-devnet/src host/desk.cljs init DIR CHAIN BOT.pem PROVIDER.pem NODE-URL ALLOW-ORIGIN ENGINE-URL MODEL-FILE [TTL-MS]
;;   nbb -cp src:../en-devnet/src host/desk.cljs serve DIR PORT CERT.pem KEY.pem
;;
;; BOT.pem and PROVIDER.pem are Ed25519 EN devnet key files (mode 0600, like
;; the support desk's). The provider key signs the funding transfer as
;; receiver; it is separate from the bot key. The offer itself is signed by
;; the device's P-256 provider key, which this desk never holds.
;; ENGINE-URL is a loopback llama.cpp server (real inference, AWAI-3011) and
;; MODEL-FILE is the model it must serve. Receipts carry hashes and measured
;; counters only: never prompt or output text.
;;
;; Routes (JSON):
;;   POST /v1/compute/offers     {}                                             -> {order-id offer-text funding-payload}
;;   POST /v1/compute/orders     {order-id offer-text offer funding-signature}  -> node decision
;;   GET  /v1/compute/receipts/<order-id>                                       -> receipt from node readback
(ns desk
  (:require ["node:crypto" :as crypto]
            ["node:fs" :as fs]
            ["node:https" :as https]
            ["node:path" :as path]
            [awai-compute.core :as c]
            [clojure.string :as str]
            [en-devnet.host :as host]))

(def max-body (* 16 1024))
(def default-ttl-ms (* 10 60 1000))
(def offer-kind "awai.compute.offer/1")
(def max-prompt-bytes 8192)
(def engine-timeout-ms 120000)

(defn read-file [p] (host/from-wire (fs/readFileSync p "utf8")))
(defn write-file! [p v flag] (fs/writeFileSync p (host/canonical (host/enc v)) #js {:flag flag :mode 0600}))
(defn log! [dir v]
  (fs/appendFileSync (path/join dir "requests.jsonl") (str (host/canonical-string (host/enc v)) "\n")))
(defn config [dir] (read-file (path/join dir "desk.json")))
(defn sha256-hex [text] (-> (crypto/createHash "sha256") (.update (js/Buffer.from text "utf8")) (.digest "hex")))
(defn card-path [dir tid] (path/join dir "cards" (str tid ".json")))
(defn result-path [dir tid] (path/join dir "results" (str tid ".json")))
(defn safe-tid? [tid] (and (string? tid) (re-matches #"compute-[0-9a-f]{24}" tid)))

(defn hash-file [p]
  (let [h (crypto/createHash "sha256") fd (fs/openSync p "r") buf (js/Buffer.alloc (* 1024 1024))]
    (try
      (loop []
        (let [n (fs/readSync fd buf 0 (.-length buf) nil)]
          (when (pos? n) (.update h (.subarray buf 0 n)) (recur))))
      (finally (fs/closeSync fd)))
    (str "sha256:" (.digest h "hex"))))

(defn init! [dir chain bot-pem provider-pem node allow-origin engine-url model-file ttl-ms]
  (fs/mkdirSync (path/join dir "cards") #js {:recursive true :mode 0700})
  (fs/mkdirSync (path/join dir "results") #js {:recursive true :mode 0700})
  (let [model-real (fs/realpathSync model-file)
        cfg {:chain-id chain :bot-key bot-pem :provider-key provider-pem
             :bot (:did (host/load-key bot-pem)) :provider (:did (host/load-key provider-pem))
             :node node :allow-origin allow-origin :enrolled-spki nil
             :engine-url engine-url :model-file model-real :model-digest (hash-file model-real)
             :card-ttl-ms (or (when ttl-ms (js/Number ttl-ms)) default-ttl-ms)}]
    (when-not (contains? #{"http:"} (.-protocol (js/URL. engine-url)))
      (throw (ex-info "the engine must be a local http address" {:engine-url engine-url})))
    (when (> (:card-ttl-ms cfg) c/longest-offer-ms)
      (throw (ex-info "the offer lives at most 24 hours (ADR 0051 D5)" {:card-ttl-ms (:card-ttl-ms cfg)})))
    (write-file! (path/join dir "desk.json") cfg "wx")
    (select-keys cfg [:chain-id :bot :provider :node :allow-origin :model-digest :card-ttl-ms])))

;; ---------------------------------------------------------------------------
;; Engine: loopback llama.cpp (real inference, AWAI-3011). The prompt travels
;; to the engine and nowhere else; it is never stored, never logged and never
;; enters the receipt. The receipt carries the input hash, the output CID and
;; measured token counters only.

(defn engine-request [method url body]
  (let [ctrl (js/AbortController.)
        timer (js/setTimeout #(.abort ctrl) engine-timeout-ms)]
    (-> (js/fetch url (clj->js (cond-> {:method method :redirect "error" :signal (.-signal ctrl)}
                                 body (assoc :body (js/JSON.stringify (clj->js body))
                                             :headers {"Content-Type" "application/json"}))))
        (.then (fn [res] (.then (.text res)
                                (fn [text] {:status (.-status res)
                                            :body (when (pos? (count text)) (js->clj (js/JSON.parse text)))}))))
        (.finally (fn [] (js/clearTimeout timer))))))

(defn engine-serving?
  "True when the engine answers and serves the pinned model file."
  [cfg]
  (-> (engine-request "GET" (str (:engine-url cfg) "/props") nil)
      (.then (fn [{:keys [status body]}]
               (let [mp (get body "model_path")]
                 (and (= 200 status)
                      (string? mp)
                      (fs/existsSync mp)
                      (= (fs/realpathSync mp) (:model-file cfg))))))
      (.catch (fn [_] false))))

(defn engine-run
  "Run one order on the engine. Returns a promise of the run map
  {:input :output :measured :engine} or throws. Input is the prompt hash,
  output is the CID of the output message, measured is token counters."
  [cfg prompt]
  (let [started (js/Math.floor (/ (js/Date.now) 1000))]
    (-> (engine-request "POST" (str (:engine-url cfg) "/v1/chat/completions")
                        {"messages" [{"role" "user" "content" prompt}]
                         "max_tokens" 256 "stream" false})
        (.then (fn [{:keys [status body]}]
                 (when-not (= 200 status)
                   (throw (ex-info "engine status" {:status status})))
                 (let [message (get-in body ["choices" 0 "message"])
                       usage (get body "usage")
                       pt (get usage "prompt_tokens")
                       ct (get usage "completion_tokens")]
                   (when-not (and message (nat-int? pt) (nat-int? ct))
                     (throw (ex-info "engine returned no measurement" {})))
                   {:input (str "sha256:" (sha256-hex prompt))
                    :output (host/cid-of (host/canonical (host/enc (js->clj (clj->js message)))))
                    :measured {:prompt-tokens pt :completion-tokens ct
                               :started-at started
                               :finished-at (js/Math.floor (/ (js/Date.now) 1000))}
                    :engine {:name "llama.cpp" :model-digest (:model-digest cfg)}}))))))

(defn http-json [method url body]
  (-> (js/fetch url (clj->js (cond-> {:method method :redirect "error"}
                               body (assoc :body (host/canonical-string (host/enc body))
                                           :headers {"Content-Type" "application/json"}))))
      (.then (fn [res] (.then (.text res) (fn [text] {:status (.-status res) :body (host/from-wire text)}))))))

(defn verify-sig
  "True when the P1363 ECDSA P-256 signature (base64) over the UTF-8 payload verifies with the
  SPKI (base64 DER). WebCrypto signs P1363; Android Keystore would sign DER."
  [spki payload sig]
  (try
    (let [k (crypto/createPublicKey #js {:key (js/Buffer.from spki "base64") :format "der" :type "spki"})]
      (and (= "ec" (.-asymmetricKeyType k))
           (= "prime256v1" (.-namedCurve (.-asymmetricKeyDetails k)))
           (crypto/verify "sha256" (js/Buffer.from payload "utf8")
                          #js {:key k :dsaEncoding "ieee-p1363"} (js/Buffer.from sig "base64"))))
    (catch :default _ false)))

(defn issue-offer! [dir {:keys [provider ttl-ms]}]
  (let [cfg (config dir)
        tid (str "compute-" (.toString (crypto/randomBytes 12) "hex"))
        lifetime (or ttl-ms (:card-ttl-ms cfg))]
    (cond
      (not (and (string? provider) (seq provider)))
      [400 {:refused true :cause :bad-provider}]
      (not (and (integer? lifetime) (pos? lifetime)))
      [400 {:refused true :cause :bad-ttl}]
      ;; ADR 0051 D5: at most 24 hours; anything longer is refused.
      (> lifetime c/longest-offer-ms)
      [400 {:refused true :cause :offer-too-long}]
      :else
      (let [card (c/offer-card {:route :en-devnet :chain-id (:chain-id cfg)
                                :provider provider :consumer (:bot cfg)
                                :amount c/provisional-credit-per-order
                                :order-id tid :expires-ms (+ (js/Date.now) lifetime)})]
        (if (:refused card)
          [400 card]
          (let [text (host/canonical-string (host/enc card))
                d (c/decide card {:approved true :card card} (js/Date.now))
                nonce (.toString (crypto/randomBytes 12) "hex")
                tx (assoc (:funding d) :nonce nonce :order nil :acceptance nil :demand nil)
                payload (.toString (host/payload-bytes tx) "utf8")]
            (if-not (:order? d)
              [409 {:refused true :cause (:cause d)}]
              (do
                (write-file! (card-path dir tid) {:card-text text :funding-payload payload :nonce nonce} "wx")
                [200 {:order-id tid :offer-text text :funding-payload payload}]))))))))

(defn offer-problem
  "First reason the offer signature does not authorize this exact offer, or nil."
  [cfg card-text {:keys [payload sig spki]}]
  (let [expected (str offer-kind "\noffer-sha256=" (sha256-hex card-text) "\ndecision=offer")]
    (cond
      (not (and (string? payload) (string? sig) (string? spki))) :offer-missing
      (not= payload expected) :offer-for-other-content
      (and (:enrolled-spki cfg) (not= spki (:enrolled-spki cfg))) :offer-key-not-enrolled
      (not (verify-sig spki payload sig)) :offer-signature-invalid
      :else nil)))

(defn funding-signature-problem
  "First reason the funding payload signature is invalid, or nil."
  [cfg funding-payload {:keys [payload sig spki]}]
  (cond
    (not (and (string? payload) (string? sig) (string? spki))) :funding-signature-missing
    (not= payload funding-payload) :funding-signature-for-other-content
    (and (:enrolled-spki cfg) (not= spki (:enrolled-spki cfg))) :funding-key-not-enrolled
    (not (verify-sig spki payload sig)) :funding-signature-invalid
    :else nil))

(defn run-order! [dir {:keys [order-id offer-text offer funding-signature prompt]}]
  (let [cfg (config dir)]
    (cond
      (not (safe-tid? order-id)) (js/Promise.resolve [400 {:refused true :cause :bad-order-id}])
      (not (fs/existsSync (card-path dir order-id))) (js/Promise.resolve [404 {:refused true :cause :unknown-offer}])
      (fs/existsSync (result-path dir order-id)) (js/Promise.resolve [409 {:refused true :cause :already-submitted}])
      (not= offer-text (:card-text (read-file (card-path dir order-id))))
      (js/Promise.resolve [409 {:refused true :cause :offer-changed}])
      (not (and (string? prompt) (pos? (count prompt))
                (<= (.-length (js/Buffer.from prompt "utf8")) max-prompt-bytes)))
      (js/Promise.resolve [400 {:refused true :cause :bad-prompt}])
      :else
      (if-let [cause (offer-problem cfg offer-text offer)]
        (js/Promise.resolve [403 {:refused true :cause cause}])
        (let [stored (read-file (card-path dir order-id))]
          (if-let [cause (funding-signature-problem cfg (:funding-payload stored) funding-signature)]
            (js/Promise.resolve [403 {:refused true :cause cause}])
            (let [card (host/from-wire offer-text)
                  d (c/decide card {:approved true :card card} (js/Date.now))]
              (if-not (:order? d)
                (js/Promise.resolve [409 {:refused true :cause (:cause d)}])
                ;; The engine must serve before any credit moves, so an
                ;; order cannot fund work that will never run. A failed
                ;; pre-check sends nothing.
                (-> (engine-serving? cfg)
                    (.then (fn [serving]
                             (if-not serving
                               [503 {:refused true :cause :engine-unavailable}]
                               (do
                                 ;; Trust on first use of the provider key, devnet only.
                                 (when-not (:enrolled-spki cfg)
                                   (write-file! (path/join dir "desk.json") (assoc cfg :enrolled-spki (:spki offer)) "w"))
                                 (let [tx (assoc (:funding d) :nonce (:nonce stored)
                                                :order nil :acceptance nil :demand nil :signatures [])
                                       tx (host/sign-tx (host/load-key (:bot-key cfg)) tx)
                                       tx (host/sign-tx (host/load-key (:provider-key cfg)) tx)
                                       account (str (:node cfg) "/v1/accounts/" (js/encodeURIComponent (:provider card)))]
                                   (-> (http-json "GET" account nil)
                                       (.then (fn [before]
                                                (write-file! (result-path dir order-id)
                                                             {:state :submitted :before (:body before)} "wx")
                                                (-> (http-json "POST" (str (:node cfg) "/v1/transfers") tx)
                                                    (.then (fn [{:keys [status body]}]
                                                             (if-not (:finalized body)
                                                               (do (write-file! (result-path dir order-id)
                                                                                 {:state :refused
                                                                  :before (:body before) :decision body} "w")
                                                                   [409 body])
                                                               ;; Funding finalized: now run the
                                                               ;; engine exactly once. A duplicate
                                                               ;; order is refused at the top and
                                                               ;; never reaches the engine again.
                                                               (-> (engine-run cfg prompt)
                                                                   (.then (fn [run]
                                                                            (write-file! (result-path dir order-id)
                                                                                         {:state :finalized
                                                                                          :before (:body before) :decision body
                                                                                          :run run :engine-calls 1} "w")
                                                                            [(if (:finalized body) 200 409) body]))
                                                                   (.catch (fn [_]
                                                                             (write-file! (result-path dir order-id)
                                                                                         {:state :engine-failed
                                                                                          :before (:body before) :decision body} "w")
                                                                             [502 {:refused true :cause :engine-failed
                                                                                   :transfer-id (:transfer-id body)}]))))))
                                                    (.catch (fn [_]
                                                              (write-file! (result-path dir order-id)
                                                                          {:state :ambiguous :before (:body before)} "w")
                                                              [502 {:ambiguous true :cause :no-answer-from-node}])))))
                                       (.catch (fn [_] [502 {:refused true :cause :balance-unknown}])))))))))))))))))

(defn receipt! [dir tid]
  (let [cfg (config dir)]
    (cond
      (not (safe-tid? tid)) (js/Promise.resolve [400 {:refused true :cause :bad-order-id}])
      (not (fs/existsSync (result-path dir tid))) (js/Promise.resolve [404 {:received false :cause :not-submitted}])
      :else
      (let [card (host/from-wire (:card-text (read-file (card-path dir tid))))
            {:keys [before decision state run engine-calls]} (read-file (result-path dir tid))]
        (if (not= :finalized state)
          (js/Promise.resolve [200 {:received false :cause (or state :unknown)}])
          (-> (js/Promise.all
               #js [(http-json "GET" (str (:node cfg) "/v1/accounts/" (js/encodeURIComponent (:provider card))) nil)
                    (http-json "GET" (str (:node cfg) "/v1/journal") nil)])
              (.then (fn [[after journal]]
                       (let [wr (-> (c/work-receipt (:order-id card) (:provider card)
                                                      (:transfer-id decision) (:height decision)
                                                      (:amount card))
                                    (assoc :input (:input run) :output (:output run)
                                           :measured (:measured run) :engine (:engine run)))]
                         [200 (-> (c/receipt card {:decision decision :before before :after (:body after)
                                                  :journal (:journal (:body journal))})
                                  (assoc :work-receipt wr :engine-calls (or engine-calls 0)))])))
              (.catch (fn [_] [502 {:received false :cause :node-unreachable}]))))))))

(defn send [res cfg status value]
  (.writeHead res status (clj->js (cond-> {"Content-Type" "application/json" "Cache-Control" "no-store"
                                           "Vary" "Origin"}
                                    (:allow-origin cfg) (assoc "Access-Control-Allow-Origin" (:allow-origin cfg)))))
  (.end res (host/canonical-string (host/enc value))))

(defn serve! [dir port cert key]
  (-> (https/createServer
       #js {:cert (fs/readFileSync cert) :key (fs/readFileSync key)}
       (fn [req res]
         (let [chunks #js [] size (atom 0)]
           (.on req "data" (fn [c] (swap! size + (.-length c)) (when (<= @size max-body) (.push chunks c))))
           (.on req "end"
                (fn []
                  (let [cfg (config dir) method (.-method req) url (.-url req)
                        origin (aget (.-headers req) "origin")]
                    (log! dir {:at (js/Date.now) :method method :path (first (str/split url #"\?"))})
                    (try
                      (cond
                        (and origin (not= origin (:allow-origin cfg)))
                        (send res cfg 403 {:refused true :cause :origin-not-allowed})
                        (= "OPTIONS" method)
                        (do (.writeHead res 204 #js {"Access-Control-Allow-Origin" (:allow-origin cfg)
                                                     "Access-Control-Allow-Methods" "GET, POST"
                                                     "Access-Control-Allow-Headers" "content-type"
                                                     "Access-Control-Allow-Private-Network" "true"
                                                     "Access-Control-Max-Age" "0" "Vary" "Origin"})
                            (.end res))
                        (> @size max-body) (send res cfg 413 {:refused true :cause :too-large})
                        :else
                        (let [body (when (= "POST" method)
                                     (host/from-wire (.toString (js/Buffer.concat chunks) "utf8")))
                              answer (fn [p] (-> (js/Promise.resolve p)
                                                 (.then (fn [[status v]] (send res cfg status v)))
                                                 (.catch (fn [_] (send res cfg 500 {:refused true :cause :internal})))))]
                          (cond
                            (and (= "POST" method) (= "/v1/compute/offers" url))
                            (answer (issue-offer! dir body))
                            (and (= "POST" method) (= "/v1/compute/orders" url))
                            (answer (run-order! dir body))
                            (and (= "GET" method) (str/starts-with? url "/v1/compute/receipts/"))
                            (answer (receipt! dir (subs url (count "/v1/compute/receipts/"))))
                            :else (send res cfg 404 {:refused true :cause :not-found}))))
                      (catch :default _ (send res cfg 400 {:refused true :cause :bad-request}))))))))
       )
      (.listen (js/Number port) "127.0.0.1"
                #(println (host/canonical-string (host/enc {:listening (str "127.0.0.1:" port)}))))))

(defn -main [[cmd & args]]
  (case cmd
    "init" (println (host/canonical-string (host/enc (apply init! args))))
    "serve" (apply serve! args)
    (do (println "usage: init DIR CHAIN BOT.pem PROVIDER.pem NODE-URL ALLOW-ORIGIN ENGINE-URL MODEL-FILE [TTL-MS] | serve DIR PORT CERT KEY")
        (set! (.-exitCode js/process) 2))))

(-main *command-line-args*)
