;; The owner's bot sends one compute order to a device through its offer's mailbox, and waits for
;; the result (ADR 0051, C1b-4, AWAI-3781). Nothing here moves value or approves an order: the
;; owner's approval and the en-devnet acceptance stay with ADR 0027's flow.
;;
;; usage (from dapps/sanka):
;;   nbb -cp src:host buyer/cli.cljs order ROOT OFFER.json ORDER.json PROMPT.txt
;;   nbb -cp src:host buyer/cli.cljs wait ROOT ORDER-CID [SECONDS]
;;
;; ROOT keeps <order-cid>.pending.json (mode 0600: it holds the reply's private key until the
;; result is read) and <order-cid>.result.json. Neither holds the prompt.
(ns buyer-cli
  (:require ["node:fs" :as fs]
            ["node:path" :as path]
            [promesa.core :as p]
            [sanka.buyer :as buyer]
            [sanka.wire :as wire]))

(defn- read-json [file] (wire/from-json (fs/readFileSync file "utf8")))
(defn- pending-file [root cid] (path/join root (str cid ".pending.json")))
(defn- write-new! [file data] (fs/writeFileSync file (wire/canonical-string data) #js {:flag "wx" :mode 0600}))
(defn- out [data] (println (wire/canonical-string data)))

(defn order! [root offer-file order-file prompt-file]
  (let [{:keys [post pending]} (buyer/prepare-order {:offer (read-json offer-file) :order (read-json order-file)
                                                     :prompt (fs/readFileSync prompt-file "utf8")
                                                     :now (js/Date.now)})]
    (fs/mkdirSync root #js {:recursive true :mode 0700})
    (write-new! (pending-file root (:order-cid pending)) pending)
    (p/let [status (buyer/post! post)]
      (out {:order-cid (:order-cid pending) :mailbox-status status :reply-topic (:reply-topic pending)})
      (when-not (= 200 status) (js/process.exit 1)))))

(defn wait! [root order-cid & [seconds]]
  (let [file (pending-file root order-cid)
        pending (read-json file)]
    (p/let [result (buyer/subscribe! (:mailbox pending) (:reply-topic pending) #(buyer/read-result pending %)
                                     (* 1000 (js/Number (or seconds 300))))]
      (if (nil? result)
        (do (out {:order-cid order-cid :result "none"}) (js/process.exit 1))
        (do
          (write-new! (path/join root (str order-cid ".result.json")) result)
          ;; The reply key has done its work.
          (fs/writeFileSync file (wire/canonical-string (dissoc pending :reply-private)) #js {:mode 0600})
          (out (cond-> {:order-cid order-cid :ok (:ok result)}
                 (:refused result) (assoc :refused (:refused result))
                 (:errors result) (assoc :errors (:errors result))))
          (when-not (:ok result) (js/process.exit 1)))))))

(defn -main [[cmd & args]]
  (-> (p/do (case cmd
              "order" (apply order! args)
              "wait" (apply wait! args)
              (do (println "usage: order ROOT OFFER.json ORDER.json PROMPT.txt | wait ROOT ORDER-CID [SECONDS]")
                  (js/process.exit 2))))
      (p/catch (fn [e]
                 (out {:error {:code (str (or (:code (ex-data e)) "failed")) :message (ex-message e)}})
                 (js/process.exit 1)))))

(-main *command-line-args*)
