;; Single-operator EN devnet node (ADR 0027 V3b, AWAI-3121). value-class devnet only.
;;
;; The core decides every transfer. The node verifies Ed25519 signatures over the payload bytes,
;; appends each finalized transfer to a hash-chained log and fsyncs it before answering. On start it
;; verifies the chain and replays every entry through the core; a broken chain, a bad signature or a
;; transfer that no longer finalizes stops the node instead of being skipped.
;;
;; Single-operator append order is not distributed finality. Nothing here is money or revenue.
;;
;; usage (from dapps/en-devnet):
;;   nbb -cp src host/node.cljs init DIR CHAIN-ID OPERATOR-DID SPONSOR-DID BOT-DID PROVIDER-DID
;;   nbb -cp src host/node.cljs serve DIR PORT
;;   nbb -cp src host/node.cljs check DIR
(ns node
  (:require ["node:fs" :as fs]
            ["node:http" :as http]
            ["node:path" :as path]
            [clojure.string :as str]
            [en-devnet.core :as core]
            [en-devnet.host :as host]))

(def genesis-hash (apply str (repeat 64 "0")))
(def max-body (* 64 1024))

(defn entry-hash [{:keys [seq prev now-ms tx]}]
  (host/sha256-hex (host/canonical {:seq seq :prev prev :now-ms now-ms :tx tx})))

(defn read-log [dir]
  (let [p (path/join dir "log.jsonl")]
    (if (fs/existsSync p)
      (->> (str/split-lines (fs/readFileSync p "utf8"))
           (remove str/blank?)
           (mapv host/from-wire))
      [])))

(defn load-state
  "Verify the chain and replay it. Returns {:ledger :head :count} or throws."
  [dir]
  (let [params (host/from-wire (fs/readFileSync (path/join dir "genesis.json") "utf8"))
        g (core/genesis params)]
    (when (:refused g) (throw (ex-info "genesis refused" {:cause (:cause g)})))
    (loop [ledger (:ledger g) prev genesis-hash entries (read-log dir) n 0]
      (if (empty? entries)
        {:ledger ledger :head prev :count n :params params}
        (let [e (first entries)
              tx (:tx e)]
          (when-not (and (= n (:seq e)) (= prev (:prev e)) (= (:hash e) (entry-hash e)))
            (throw (ex-info "log chain broken" {:seq n})))
          (let [step (core/apply-transfer ledger (host/verified-tx tx) (:now-ms e))]
            (when-not (:finalized (second step))
              (throw (ex-info "logged transfer no longer finalizes" {:seq n :decision (second step)})))
            (recur (first step) (:hash e) (rest entries) (inc n))))))))

(defn append! [dir entry]
  (let [fd (fs/openSync (path/join dir "log.jsonl") "a" 0600)]
    (try
      (fs/writeSync fd (str (host/canonical-string (host/enc entry)) "\n"))
      (fs/fsyncSync fd)
      (finally (fs/closeSync fd)))))

(defn init! [dir chain operator sponsor bot provider]
  (fs/mkdirSync dir #js {:recursive true :mode 0700})
  (let [params (core/adr0027-genesis chain operator sponsor bot provider)
        g (core/genesis params)]
    (when (:refused g) (throw (ex-info "genesis refused" {:code (str (:cause g))})))
    (fs/writeFileSync (path/join dir "genesis.json") (host/canonical (host/enc params)) #js {:flag "wx" :mode 0600})
    {:chain-id chain :finality core/finality :value-class :devnet}))

(defn send [res status value]
  (let [body (js/Buffer.from (host/canonical-string (host/enc value)) "utf8")]
    (.writeHead res status #js {"Content-Type" "application/json" "Content-Length" (.-length body)})
    (.end res body)))

(defn serve! [dir port]
  (let [state (atom (load-state dir))]
    (-> (http/createServer
         (fn [req res]
           (let [chunks #js [] size (atom 0)]
             (.on req "data" (fn [c] (swap! size + (.-length c)) (when (<= @size max-body) (.push chunks c))))
             (.on req "end"
                  (fn []
                    (try
                      (let [method (.-method req) url (.-url req) {:keys [ledger head count]} @state]
                        (cond
                          (> @size max-body) (send res 413 {:refused true :cause :too-large})
                          (and (= "GET" method) (= "/v1/head" url))
                          (send res 200 {:chain-id (:chain-id ledger) :height (:height ledger) :head head
                                         :entries count :finality core/finality :value-class :devnet
                                         :net-zero (core/net-zero? ledger)})
                          (and (= "GET" method) (str/starts-with? url "/v1/accounts/"))
                          (send res 200 (core/balance ledger (js/decodeURIComponent (subs url 13))))
                          (and (= "GET" method) (= "/v1/log" url))
                          (send res 200 {:height (:height ledger) :log (:log ledger)})
                          (and (= "GET" method) (= "/v1/journal" url))
                          (send res 200 {:journal (core/journal ledger)
                                         :earned (core/earned-summary (core/journal ledger))})
                          (and (= "POST" method) (= "/v1/transfers" url))
                          (let [tx (host/from-wire (.toString (js/Buffer.concat chunks) "utf8"))
                                now (js/Date.now)
                                [ledger' decision] (core/apply-transfer ledger (host/verified-tx tx) now)]
                            (if (:finalized decision)
                              (let [e {:seq count :prev head :now-ms now :tx tx}
                                    e (assoc e :hash (entry-hash e))]
                                (append! dir e)
                                (reset! state {:ledger ledger' :head (:hash e) :count (inc count)})
                                (send res 200 (assoc decision :entry-hash (:hash e))))
                              (send res 409 decision)))
                          :else (send res 404 {:refused true :cause :not-found})))
                      (catch :default e
                        (js/console.error "internal error:" (ex-message e))
                        (send res 400 {:refused true :cause :bad-request}))))))))
        (.listen (js/Number port) "127.0.0.1"
                 #(println (host/canonical-string (host/enc {:listening (str "127.0.0.1:" port)
                                                             :height (:height (:ledger @state))
                                                             :head (:head @state)})))))))

(defn -main [[cmd & args]]
  (try
    (case cmd
      "init" (println (host/canonical-string (host/enc (apply init! args))))
      "check" (let [{:keys [ledger head count]} (load-state (first args))]
                (println (host/canonical-string
                          (host/enc {:ok true :height (:height ledger) :head head :entries count
                                     :balances (core/balances ledger) :net-zero (core/net-zero? ledger)}))))
      "serve" (apply serve! args)
      (do (println "usage: init | serve | check") (js/process.exit 2)))
    (catch :default e
      (println (host/canonical-string {"refused" true "cause" (ex-message e)}))
      (js/process.exit 1))))

(-main *command-line-args*)
