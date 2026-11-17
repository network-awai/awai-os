;; EN devnet signer (ADR 0027 V3b, AWAI-3121). One key file per role; the key never leaves the host
;; that holds it and is never passed to a model or a bot's prompt.
;;
;; The bot's signer persists a reservation before it signs, refuses when the node cannot tell it the
;; balance (unknown is not zero), and holds a policy: a per-order maximum and a receiver allowlist.
;; A submission that gets no answer is recorded as ambiguous and is never resubmitted; `reconcile`
;; settles it against the node.
;;
;; usage (from dapps/en-devnet):
;;   nbb -cp src host/signer.cljs keygen KEY-FILE
;;   nbb -cp src host/signer.cljs funding CHAIN SPONSOR BOT TRANSFER-ID NONCE TTL-MS     (prints a tx)
;;   nbb -cp src host/signer.cljs sign KEY-FILE < tx.json                               (adds one signature)
;;   nbb -cp src host/signer.cljs init DIR KEY-FILE CHAIN MAX-AMOUNT RECEIVER...         (bot signer)
;;   nbb -cp src host/signer.cljs reserve DIR NODE-URL ORDER-CID AMOUNT
;;   nbb -cp src host/signer.cljs propose DIR ORDER-CID ACCEPTANCE-CID RECEIVER TTL-MS
;;   nbb -cp src host/signer.cljs submit DIR-OR-- NODE-URL < tx.json
;;   nbb -cp src host/signer.cljs reconcile DIR NODE-URL
;;   nbb -cp src host/signer.cljs enroll DIR OWNER-SPKI-BASE64                         (V4: owner key)
;;   nbb -cp src host/signer.cljs reserve-approved DIR NODE-URL ORDER.json APPROVAL.json
;;   nbb -cp src host/signer.cljs settle-accepted DIR RECEIPT.json ACCEPTANCE.json TTL-MS
(ns signer
  (:require ["node:crypto" :as crypto]
            ["node:fs" :as fs]
            ["node:path" :as path]
            [clojure.string :as str]
            [en-devnet.core :as core]
            [en-devnet.host :as host]
            [promesa.core :as p]))

(defn refuse [cause & [data]] (throw (ex-info (name cause) (merge {:cause cause} data))))

(defn out [v] (println (host/canonical-string (host/enc v))))
(defn stdin-tx
  "A promise of the tx on stdin. Read asynchronously: a synchronous read of a pipe can fail with EAGAIN."
  []
  (js/Promise.
   (fn [resolve reject]
     (let [chunks #js []]
       (.on js/process.stdin "data" #(.push chunks %))
       (.on js/process.stdin "end" #(resolve (host/from-wire (.toString (js/Buffer.concat chunks) "utf8"))))
       (.on js/process.stdin "error" reject)))))
(defn read-file [p] (host/from-wire (fs/readFileSync p "utf8")))
(defn write-file! [p v flag] (fs/writeFileSync p (host/canonical (host/enc v)) #js {:flag flag :mode 0600}))
(defn now-ms [] (js/Date.now))
(defn nonce [] (.toString (crypto/randomBytes 12) "hex"))

(defn http-json [method url body]
  (-> (js/fetch url (clj->js (cond-> {:method method :redirect "error"}
                               body (assoc :body (host/canonical-string (host/enc body))
                                           :headers {"Content-Type" "application/json"}))))
      (p/then (fn [res] (p/let [text (.text res)] {:status (.-status res) :body (host/from-wire text)})))))

;; ---------------------------------------------------------------------------
;; Bot signer state: DIR/{signer.json, reservations/<order-cid>.json}

(defn config [dir] (read-file (path/join dir "signer.json")))
(defn res-path [dir order] (path/join dir "reservations" (str order ".json")))
(defn reservation [dir order] (when (fs/existsSync (res-path dir order)) (read-file (res-path dir order))))
(defn save-reservation! [dir r] (write-file! (res-path dir (:order r)) r "w"))

(defn reservations [dir]
  (->> (fs/readdirSync (path/join dir "reservations"))
       (filter #(str/ends-with? % ".json"))
       (mapv #(read-file (path/join dir "reservations" %)))))

(def live-states #{:reserved :signed :ambiguous})

(defn init! [dir key-file chain max-amount & receivers]
  (let [{:keys [did]} (host/load-key key-file)]
    (fs/mkdirSync (path/join dir "reservations") #js {:recursive true :mode 0700})
    (write-file! (path/join dir "signer.json")
                 {:key-file (fs/realpathSync key-file) :did did :chain-id chain
                  :max-amount (js/parseInt max-amount 10) :allowlist (vec receivers)}
                 "wx")
    {:did did :chain-id chain :max-amount (js/parseInt max-amount 10) :allowlist (vec receivers)}))

(defn reserve! [dir node order amount]
  (let [{:keys [did max-amount]} (config dir)
        amount (js/parseInt amount 10)]
    (when-not (and (pos-int? amount) (<= amount max-amount)) (refuse :over-policy {:max max-amount}))
    (when (reservation dir order) (refuse :already-reserved))
    (-> (http-json "GET" (str node "/v1/accounts/" (js/encodeURIComponent did)) nil)
        (p/catch (fn [_] {:status 0 :body {:known? false}}))
        (p/then
         (fn [{:keys [body]}]
           (when-not (true? (:known? body)) (refuse :balance-unknown))
           (let [held (reduce + 0 (map :amount (filter #(live-states (:state %)) (reservations dir))))
                 available (- (:balance body) (:floor body) held)]
             (when (> amount available) (refuse :insufficient {:available available}))
             (let [r {:order order :amount amount :state :reserved :at (now-ms)}]
               ;; Persist before anything is signed. Exclusive: one reservation per order.
               (write-file! (res-path dir order) r "wx")
               r)))))))

(defn propose! [dir order acceptance receiver ttl-ms]
  (let [{:keys [did chain-id allowlist key-file]} (config dir)
        r (reservation dir order)]
    (when-not r (refuse :no-reservation))
    (when-not (= :reserved (:state r)) (refuse :not-reserved {:state (:state r)}))
    (when-not (some #(= receiver %) allowlist) (refuse :receiver-not-allowlisted))
    (let [tx {:chain-id chain-id :value-class :devnet :kind :settlement
              :transfer-id (str "settle-" (subs order 0 (min 24 (count order))) "-" (nonce))
              :nonce (nonce) :spender did :receiver receiver :amount (:amount r) :fee 0
              :reserved (:amount r) :order order :acceptance acceptance :demand :owner-internal
              :expires-ms (+ (now-ms) (js/parseInt ttl-ms 10)) :signatures []}
          signed (host/sign-tx (host/load-key key-file) tx)]
      (save-reservation! dir (assoc r :state :signed :transfer-id (:transfer-id tx) :nonce (:nonce tx)))
      signed)))

(defn submit! [dir node tx]
  (let [r (when (and (not= "-" dir) (:order tx)) (reservation dir (:order tx)))]
    (when (and r (not= :signed (:state r))) (refuse :not-submittable {:state (:state r)}))
    (-> (http-json "POST" (str node "/v1/transfers") tx)
        (p/then (fn [{:keys [body]}]
                  (when r
                    (save-reservation! dir (assoc r :state (if (:finalized body) :finalized :released)
                                                  :decision body)))
                  body))
        (p/catch (fn [e]
                   ;; No answer: the transfer may or may not be on the node. Hold the reservation.
                   (when r (save-reservation! dir (assoc r :state :ambiguous)))
                   (if (:cause (ex-data e)) (throw e) {:ambiguous true :transfer-id (:transfer-id tx)}))))))

(defn reconcile! [dir node]
  (p/let [log (http-json "GET" (str node "/v1/log") nil)
          journal (http-json "GET" (str node "/v1/journal") nil)]
    (let [rs (reservations dir)
          on-ledger (set (map :transfer-id (get-in log [:body :log])))
          ;; An ambiguous submission resolves from the node's log, never by resubmitting.
          rs (mapv (fn [r]
                     (if (= :ambiguous (:state r))
                       (let [r' (assoc r :state (if (on-ledger (:transfer-id r)) :finalized :released))]
                         (save-reservation! dir r') r')
                       r))
                   rs)
          signer-records (mapv (fn [r] {:transfer-id (:transfer-id r) :amount (:amount r) :state (:state r)})
                               (filter :transfer-id rs))]
      (core/reconcile signer-records {:log (get-in log [:body :log]) :height (get-in log [:body :height])}
                      (get-in journal [:body :journal])))))

;; ---------------------------------------------------------------------------
;; Owner approval and acceptance (ADR 0027 V4, AWAI-3123). Once an owner key is enrolled, the
;; signer reserves only for an order the owner approved on the native card, and proposes a
;; settlement only for a receipt the owner accepted. A rejection releases the reservation and pays
;; nothing. The statements are signed by the owner's P-256 key on the Android device.

(def approval-max-age-ms (* 15 60 1000))

(defn owner-spki [dir] (:owner-spki (config dir)))

(defn enroll! [dir spki]
  (let [c (config dir)]
    (when (:owner-spki c) (refuse :owner-already-enrolled))
    (when-not (try (let [k (crypto/createPublicKey #js {:key (js/Buffer.from spki "base64") :format "der" :type "spki"})]
                     (= "prime256v1" (.-namedCurve (.-asymmetricKeyDetails k))))
                   (catch :default _ false))
      (refuse :owner-key-not-p256))
    (write-file! (path/join dir "signer.json.tmp") (assoc c :owner-spki spki) "w")
    (fs/renameSync (path/join dir "signer.json.tmp") (path/join dir "signer.json"))
    {:enrolled true :owner-spki-sha256 (host/sha256-hex (js/Buffer.from spki "base64"))}))

(defn statement [dir file kind]
  (let [s (host/owner-statement (owner-spki dir) (read-file file))]
    (when-not s (refuse :owner-signature-invalid))
    (when-not (= kind (:kind s)) (refuse :wrong-statement-kind {:kind (:kind s)}))
    s))

(defn reserve-approved! [dir node order-file approval-file]
  (when-not (owner-spki dir) (refuse :no-owner-enrolled))
  (let [order (read-file order-file)
        cid (host/cid-of (host/canonical order))
        s (statement dir approval-file "awai.sanka.approval/1")
        at (js/parseInt (:at s) 10)
        now (now-ms)]
    (when-not (= cid (:order s)) (refuse :approval-for-another-order))
    (when (= "deny" (:verdict s)) (refuse :owner-denied))
    (when-not (= "approve" (:verdict s)) (refuse :no-approval))
    (when-not (< (- now approval-max-age-ms) at (+ now 60000)) (refuse :approval-stale))
    (when-not (= "devnet" (:value-class order)) (refuse :not-devnet))
    (when-not (> (* 1000 (:expires-at order)) now) (refuse :order-expired))
    (when-not (some #(= (:provider order) %) (:allowlist (config dir))) (refuse :receiver-not-allowlisted))
    (reserve! dir node cid (:amount order))))

(defn settle-accepted! [dir receipt-file acceptance-file ttl-ms]
  (when-not (owner-spki dir) (refuse :no-owner-enrolled))
  (let [receipt (read-file receipt-file)
        receipt-cid (host/cid-of (host/canonical receipt))
        s (statement dir acceptance-file "awai.sanka.acceptance/1")
        r (reservation dir (:order s))]
    (when-not r (refuse :no-reservation))
    (when-not (= receipt-cid (:receipt s)) (refuse :acceptance-for-another-receipt))
    (when-not (= (:order s) (:order receipt)) (refuse :receipt-for-another-order))
    (case (:verdict s)
      "reject" (do (when-not (= :reserved (:state r)) (refuse :not-reserved {:state (:state r)}))
                   (save-reservation! dir (assoc r :state :released :rejected-receipt receipt-cid))
                   {:released true :cause :rejected-by-owner :order (:order s) :paid 0})
      "accept" (propose! dir (:order s) (host/cid-of (host/canonical (read-file acceptance-file)))
                         (:provider receipt) ttl-ms)
      (refuse :no-acceptance))))

(defn -main [[cmd & args]]
  (-> (p/do
        (case cmd
          "keygen" {:did (host/keygen! (first args))}
          "funding" (let [[chain sponsor bot tid n ttl] args]
                      {:chain-id chain :value-class :devnet :kind :funding :transfer-id tid :nonce n
                       :spender sponsor :receiver bot :amount 1 :fee 0 :order nil :acceptance nil
                       :demand :owner-internal :expires-ms (+ (now-ms) (js/parseInt ttl 10)) :signatures []})
          "sign" (p/let [tx (stdin-tx)] (host/sign-tx (host/load-key (first args)) tx))
          "init" (apply init! args)
          "reserve" (if (owner-spki (first args)) (refuse :owner-approval-required) (apply reserve! args))
          "propose" (if (owner-spki (first args)) (refuse :owner-acceptance-required) (apply propose! args))
          "enroll" (apply enroll! args)
          "reserve-approved" (apply reserve-approved! args)
          "settle-accepted" (apply settle-accepted! args)
          "submit" (p/let [tx (stdin-tx)] (submit! (first args) (second args) tx))
          "reconcile" (apply reconcile! args)
          (refuse :usage)))
      (p/then out)
      (p/catch (fn [e]
                 (let [c (loop [e e] (when e (if (:cause (ex-data e)) e (recur (ex-cause e)))))]
                   (out {:refused true :cause (or (:cause (ex-data c)) :failed)
                         :message (ex-message (or c e))})
                   (js/process.exit 1))))))

(-main *command-line-args*)
