;; AWAI-3115: fund the bot once (sponsor -> bot, the support path) so the bot
;; (floor 0) can pay one compute order. nbb only.
;; usage: nbb -cp src:../en-devnet/src test/fund.cljs SPONSOR.pem BOT.pem NODE-URL CHAIN TRANSFER-ID AMOUNT
(ns fund
  (:require ["node:crypto" :as crypto]
            [en-devnet.host :as host]))

(defn -main [[sponsor-pem bot-pem node chain tid amount]]
  (let [sponsor (host/load-key sponsor-pem)
        bot (host/load-key bot-pem)
        tx {:chain-id chain :value-class :devnet :kind :funding
            :transfer-id tid :spender (:did sponsor) :receiver (:did bot)
            :amount (js/Number amount) :fee 0
            :nonce (.toString (crypto/randomBytes 12) "hex")
            :order nil :acceptance nil :demand nil :signatures []
            :expires-ms (+ (js/Date.now) 600000)}
        tx (host/sign-tx sponsor tx)
        tx (host/sign-tx bot tx)]
    (-> (js/fetch (str node "/v1/transfers")
                  #js {:method "POST"
                       :body (host/canonical-string (host/enc tx))})
        (.then (fn [res] (.then (.text res)
                                (fn [text] (println text)
                                            (when-not (.-ok res) (set! (.-exitCode js/process) 1)))))))))

(-main *command-line-args*)
