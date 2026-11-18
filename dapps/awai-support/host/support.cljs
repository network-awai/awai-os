(ns support
  "Host commands around awai-support.core for the EN devnet run (AWAI-3169). nbb only.

  usage (from dapps/awai-support):
    nbb -cp src:../en-devnet/src host/support.cljs card ROUTE CHAIN SPONSOR BOT AMOUNT TRANSFER-ID TTL-MS
    nbb -cp src:../en-devnet/src host/support.cljs decide CARD.json ANSWER.json
    nbb -cp src:../en-devnet/src host/support.cljs receipt CARD.json DECISION.json BEFORE.json AFTER.json JOURNAL.json

  `decide` prints an unsigned funding tx with a fresh nonce only when ANSWER approves the same card;
  otherwise it prints the refusal and exits 3, so a pipeline sends nothing. The sponsor and the bot
  sign with en-devnet's `signer.cljs sign`, each with its own key file."
  (:require ["node:crypto" :as crypto]
            ["node:fs" :as fs]
            [awai-support.core :as s]
            [en-devnet.host :as host]))

(defn read-file [p] (host/from-wire (fs/readFileSync p "utf8")))
(defn out [v] (println (host/canonical-string (host/enc v))))

(defn -main [[cmd & args]]
  (case cmd
    "card" (let [[route chain sponsor bot amount tid ttl] args]
             (out (s/consent-card {:route (keyword route) :chain-id chain :sponsor sponsor :bot bot
                                   :amount (js/parseInt amount 10) :transfer-id tid
                                   :expires-ms (+ (js/Date.now) (js/parseInt ttl 10))})))
    "decide" (let [[card-file answer-file] args
                   d (s/decide (read-file card-file) (read-file answer-file) (js/Date.now))]
               (if (:send? d)
                 (out (assoc (:funding d) :nonce (.toString (crypto/randomBytes 12) "hex")
                             :order nil :acceptance nil :demand nil :signatures []))
                 (do (out {:refused true :cause (:cause d)}) (set! (.-exitCode js/process) 3))))
    "receipt" (let [[card decision before after journal] (map read-file args)]
                (out (s/receipt card {:decision decision :before before :after after
                                      :journal (:journal journal)})))
    (do (out {:refused true :cause :usage}) (set! (.-exitCode js/process) 2))))

(-main *command-line-args*)
