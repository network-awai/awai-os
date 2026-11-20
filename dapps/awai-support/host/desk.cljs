;; Awai support desk for the EN devnet (AWAI-3170). nbb only, HTTPS on loopback.
;;
;; The Itonami app (Android WebView) reaches this desk through the shared consent broker. The desk
;; issues consent cards, accepts a support only with the sponsor device's P-256 approval of the exact
;; card text, signs the funding transfer as the sponsor, has the awai-support bot counter-sign with its
;; own key file, and submits it to the EN devnet node. It never retries a submission without an answer.
;;
;; value-class devnet only. Nothing here is money, revenue or a donation. The sponsor's EN key is a
;; devnet key file on this host, used only after the device's approval: a stand-in for a sponsor
;; wallet, not key custody.
;;
;; usage (from dapps/awai-support):
;;   nbb -cp src:../en-devnet/src host/desk.cljs init DIR CHAIN SPONSOR.pem BOT.pem NODE-URL ALLOW-ORIGIN
;;   nbb -cp src:../en-devnet/src host/desk.cljs serve DIR PORT CERT.pem KEY.pem
;;
;; Routes (JSON):
;;   POST /v1/support/cards     {amount}                                -> {transfer-id card-text}
;;   POST /v1/support/funds     {transfer-id card-text approval}        -> node decision
;;   GET  /v1/support/receipts/<transfer-id>                            -> receipt from node readback
(ns desk
  (:require ["node:crypto" :as crypto]
            ["node:fs" :as fs]
            ["node:https" :as https]
            ["node:path" :as path]
            [awai-support.core :as s]
            [clojure.string :as str]
            [en-devnet.host :as host]))

(def max-body (* 16 1024))
(def card-ttl-ms (* 10 60 1000))
(def approval-kind "awai.support.approval/1")

(defn read-file [p] (host/from-wire (fs/readFileSync p "utf8")))
(defn write-file! [p v flag] (fs/writeFileSync p (host/canonical (host/enc v)) #js {:flag flag :mode 0600}))
(defn log! [dir v]
  (fs/appendFileSync (path/join dir "requests.jsonl") (str (host/canonical-string (host/enc v)) "\n")))
(defn config [dir] (read-file (path/join dir "desk.json")))
(defn sha256-hex [text] (-> (crypto/createHash "sha256") (.update (js/Buffer.from text "utf8")) (.digest "hex")))
(defn card-path [dir tid] (path/join dir "cards" (str tid ".json")))
(defn result-path [dir tid] (path/join dir "results" (str tid ".json")))
(defn safe-tid? [tid] (and (string? tid) (re-matches #"support-[0-9a-f]{24}" tid)))

(defn init! [dir chain sponsor-pem bot-pem node allow-origin]
  (fs/mkdirSync (path/join dir "cards") #js {:recursive true :mode 0700})
  (fs/mkdirSync (path/join dir "results") #js {:recursive true :mode 0700})
  (let [cfg {:chain-id chain :sponsor-key sponsor-pem :bot-key bot-pem
             :sponsor (:did (host/load-key sponsor-pem)) :bot (:did (host/load-key bot-pem))
             :node node :allow-origin allow-origin :enrolled-spki nil}]
    (write-file! (path/join dir "desk.json") cfg "wx")
    (select-keys cfg [:chain-id :sponsor :bot :node :allow-origin])))

(defn http-json [method url body]
  (-> (js/fetch url (clj->js (cond-> {:method method :redirect "error"}
                               body (assoc :body (host/canonical-string (host/enc body))
                                           :headers {"Content-Type" "application/json"}))))
      (.then (fn [res] (.then (.text res) (fn [text] {:status (.-status res) :body (host/from-wire text)}))))))

(defn verify-approval
  "True when the P1363 ECDSA P-256 signature (base64) over the UTF-8 payload verifies with the SPKI
  (base64 DER). WebCrypto signs P1363; Android Keystore would sign DER."
  [spki payload sig]
  (try
    (let [k (crypto/createPublicKey #js {:key (js/Buffer.from spki "base64") :format "der" :type "spki"})]
      (and (= "ec" (.-asymmetricKeyType k))
           (= "prime256v1" (.-namedCurve (.-asymmetricKeyDetails k)))
           (crypto/verify "sha256" (js/Buffer.from payload "utf8")
                          #js {:key k :dsaEncoding "ieee-p1363"} (js/Buffer.from sig "base64"))))
    (catch :default _ false)))

(defn issue-card! [dir {:keys [amount]}]
  (let [cfg (config dir)
        tid (str "support-" (.toString (crypto/randomBytes 12) "hex"))
        card (s/consent-card {:route :en-devnet :chain-id (:chain-id cfg) :sponsor (:sponsor cfg)
                              :bot (:bot cfg) :amount amount :transfer-id tid
                              :expires-ms (+ (js/Date.now) card-ttl-ms)})]
    (if (:refused card)
      [400 card]
      (let [text (host/canonical-string (host/enc card))]
        (write-file! (card-path dir tid) {:card-text text} "wx")
        [200 {:transfer-id tid :card-text text}]))))

(defn approval-problem
  "First reason the approval does not authorize this exact card, or nil."
  [cfg card-text {:keys [payload sig spki]}]
  (let [expected (str approval-kind "\ncard-sha256=" (sha256-hex card-text) "\ndecision=approve")]
    (cond
      (not (and (string? payload) (string? sig) (string? spki))) :approval-missing
      (not= payload expected) :approval-for-other-content
      (and (:enrolled-spki cfg) (not= spki (:enrolled-spki cfg))) :approval-key-not-enrolled
      (not (verify-approval spki payload sig)) :approval-signature-invalid
      :else nil)))

(defn fund! [dir {:keys [transfer-id card-text approval]}]
  (let [cfg (config dir)]
    (cond
      (not (safe-tid? transfer-id)) (js/Promise.resolve [400 {:refused true :cause :bad-transfer-id}])
      (not (fs/existsSync (card-path dir transfer-id))) (js/Promise.resolve [404 {:refused true :cause :unknown-card}])
      (fs/existsSync (result-path dir transfer-id)) (js/Promise.resolve [409 {:refused true :cause :already-submitted}])
      (not= card-text (:card-text (read-file (card-path dir transfer-id))))
      (js/Promise.resolve [409 {:refused true :cause :card-changed}])
      :else
      (if-let [cause (approval-problem cfg card-text approval)]
        (js/Promise.resolve [403 {:refused true :cause cause}])
        (let [card (host/from-wire card-text)
              d (s/decide card {:approved true :card card} (js/Date.now))]
          (if-not (:send? d)
            (js/Promise.resolve [409 {:refused true :cause (:cause d)}])
            (do
              ;; Trust on first use of the device's approval key, devnet only.
              (when-not (:enrolled-spki cfg)
                (write-file! (path/join dir "desk.json") (assoc cfg :enrolled-spki (:spki approval)) "w"))
              (let [tx (assoc (:funding d) :nonce (.toString (crypto/randomBytes 12) "hex")
                              :order nil :acceptance nil :demand nil :signatures [])
                    tx (host/sign-tx (host/load-key (:sponsor-key cfg)) tx)
                    tx (host/sign-tx (host/load-key (:bot-key cfg)) tx)
                    account (str (:node cfg) "/v1/accounts/" (js/encodeURIComponent (:bot cfg)))]
                (-> (http-json "GET" account nil)
                    (.then (fn [before]
                             (write-file! (result-path dir transfer-id)
                                          {:state :submitted :before (:body before)} "wx")
                             (-> (http-json "POST" (str (:node cfg) "/v1/transfers") tx)
                                 (.then (fn [{:keys [status body]}]
                                          (write-file! (result-path dir transfer-id)
                                                       {:state (if (:finalized body) :finalized :refused)
                                                        :before (:body before) :decision body} "w")
                                          [(if (:finalized body) 200 409) body]))
                                 (.catch (fn [_]
                                           (write-file! (result-path dir transfer-id)
                                                        {:state :ambiguous :before (:body before)} "w")
                                           [502 {:ambiguous true :cause :no-answer-from-node}])))))
                    (.catch (fn [_] [502 {:refused true :cause :balance-unknown}])))))))))))

(defn receipt! [dir tid]
  (let [cfg (config dir)]
    (cond
      (not (safe-tid? tid)) (js/Promise.resolve [400 {:refused true :cause :bad-transfer-id}])
      (not (fs/existsSync (result-path dir tid))) (js/Promise.resolve [404 {:received false :cause :not-submitted}])
      :else
      (let [card (host/from-wire (:card-text (read-file (card-path dir tid))))
            {:keys [before decision state]} (read-file (result-path dir tid))]
        (if (not= :finalized state)
          (js/Promise.resolve [200 {:received false :cause (or state :unknown)}])
          (-> (js/Promise.all
               #js [(http-json "GET" (str (:node cfg) "/v1/accounts/" (js/encodeURIComponent (:bot cfg))) nil)
                    (http-json "GET" (str (:node cfg) "/v1/journal") nil)])
              (.then (fn [[after journal]]
                       [200 (s/receipt card {:decision decision :before before :after (:body after)
                                             :journal (:journal (:body journal))})]))
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
                            (and (= "POST" method) (= "/v1/support/cards" url))
                            (answer (issue-card! dir body))
                            (and (= "POST" method) (= "/v1/support/funds" url))
                            (answer (fund! dir body))
                            (and (= "GET" method) (str/starts-with? url "/v1/support/receipts/"))
                            (answer (receipt! dir (subs url (count "/v1/support/receipts/"))))
                            :else (send res cfg 404 {:refused true :cause :not-found}))))
                      (catch :default _ (send res cfg 400 {:refused true :cause :bad-request}))))))))
       )
      (.listen (js/Number port) "127.0.0.1"
               #(println (host/canonical-string (host/enc {:listening (str "127.0.0.1:" port)}))))))

(defn -main [[cmd & args]]
  (case cmd
    "init" (println (host/canonical-string (host/enc (apply init! args))))
    "serve" (apply serve! args)
    (do (println "usage: init DIR CHAIN SPONSOR.pem BOT.pem NODE-URL ALLOW-ORIGIN | serve DIR PORT CERT KEY")
        (set! (.-exitCode js/process) 2))))

(-main *command-line-args*)
