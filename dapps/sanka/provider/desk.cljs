;; Provider order desk for ADR 0027 V2 (AWAI-3103). One order's key opens exactly one call to a
;; local llama.cpp server; the result is an `awai.work-receipt/1` signed by this node's Ed25519 key.
;;
;; It serves the same receipt format as the V1 Hy gateway (cloud-kotoba-desktop orders.hy, whose
;; GitHub repository now returns 404), so `tools/verify_receipt.lpy` checks it without sharing code.
;; Differences from V1: registration is a command run by the provider operator on this host, not an
;; HTTP route, and the HTTP listener binds loopback only (reach it through an SSH tunnel).
;;
;; No prompt, output or order key is stored. Nothing here moves value; a receipt records that work
;; happened, not that it was good, and proves nothing about what the engine really ran.
;;
;; usage (from dapps/sanka):
;;   nbb -cp src provider/desk.cljs init ROOT PROVIDER-DID ENGINE-FILE ENGINE-VERSION MODEL-FILE MODEL-REVISION UPSTREAM
;;   nbb -cp src provider/desk.cljs register ROOT ORDER.json KEY-SHA256-HEX
;;   nbb -cp src provider/desk.cljs serve ROOT PORT
;;   nbb -cp src provider/desk.cljs receipt ROOT ORDER-CID
(ns desk
  (:require ["node:crypto" :as crypto]
            ["node:fs" :as fs]
            ["node:http" :as http]
            ["node:path" :as path]
            [clojure.string :as str]
            [promesa.core :as p]
            [sanka.core :as core]))

(def order-kind "awai.order/1")
(def receipt-kind "awai.work-receipt/1")
(def max-request-bytes (* 1024 1024))
(def max-upstream-bytes (* 32 1024 1024))
(def upstream-timeout-ms 600000)
(def loopback #{"127.0.0.1" "::1" "localhost"})

;; ---------------------------------------------------------------------------
;; Canonical JSON, CIDs and did:key, matching the Python gateway and verifier byte for byte:
;; sorted keys, no whitespace, non-ASCII kept. Only integers are allowed as numbers, because
;; Python and JavaScript print fractions differently.

(defn canonical-string [value]
  (cond
    (nil? value) "null"
    (boolean? value) (if value "true" "false")
    (string? value) (js/JSON.stringify value)
    (number? value) (if (js/Number.isSafeInteger value)
                      (str value)
                      (throw (ex-info "canonical JSON allows only safe integers" {:value value})))
    (array? value) (str "[" (str/join "," (map canonical-string value)) "]")
    (sequential? value) (str "[" (str/join "," (map canonical-string value)) "]")
    (map? value) (canonical-string (clj->js value))
    (object? value) (let [ks (sort (js/Object.keys value))]
                      (str "{" (str/join "," (map (fn [k] (str (js/JSON.stringify k) ":"
                                                               (canonical-string (aget value k))))
                                                  ks))
                           "}"))
    :else (throw (ex-info "value has no canonical JSON form" {:value value}))))

(defn canonical [value] (js/Buffer.from (canonical-string value) "utf8"))

(def base32-alphabet "abcdefghijklmnopqrstuvwxyz234567")

(defn base32 [bytes]
  (loop [i 0 bits 0 acc 0 out []]
    (if (< i (.-length bytes))
      (let [acc (bit-or (bit-shift-left (bit-and acc 0xff) 8) (aget bytes i))
            bits (+ bits 8)
            [out bits] (loop [out out bits bits]
                         (if (>= bits 5)
                           (recur (conj out (nth base32-alphabet
                                                 (bit-and (unsigned-bit-shift-right acc (- bits 5)) 31)))
                                  (- bits 5))
                           [out bits]))]
        (recur (inc i) bits acc out))
      (apply str (if (pos? bits)
                   (conj out (nth base32-alphabet (bit-and (bit-shift-left acc (- 5 bits)) 31)))
                   out)))))

(def cid-prefix (js/Buffer.from #js [0x01 0xa9 0x02 0x12 0x20]))

(defn sha256 [data] (-> (crypto/createHash "sha256") (.update data) (.digest)))
(defn sha256-hex [data] (-> (crypto/createHash "sha256") (.update data) (.digest "hex")))

(defn cid-of [data] (str "b" (base32 (js/Buffer.concat #js [cid-prefix (sha256 data)]))))

(def base58-alphabet "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

(defn- divmod58
  "Long division of a big-endian byte vector by 58: [quotient-without-leading-zeros remainder]."
  [digits]
  (loop [ds digits rem 0 q []]
    (if (empty? ds)
      [(vec (drop-while zero? q)) rem]
      (let [acc (+ (* rem 256) (first ds))]
        (recur (rest ds) (mod acc 58) (conj q (quot acc 58)))))))

(defn base58 [bytes]
  (let [all (vec (array-seq bytes))
        zeros (count (take-while zero? all))]
    (loop [n (vec (drop-while zero? all)) out ()]
      (if (empty? n)
        (str (apply str (repeat zeros "1")) (apply str out))
        (let [[q r] (divmod58 n)]
          (recur q (cons (nth base58-alphabet r) out)))))))

(defn b64u [buffer] (str/replace (.toString buffer "base64url") #"=+$" ""))

(defn did-of [public-key]
  (let [raw (js/Buffer.from (.-x (.export public-key #js {:format "jwk"})) "base64url")]
    (str "did:key:z" (base58 (js/Buffer.concat #js [(js/Buffer.from #js [0xed 0x01]) raw])))))

(defn sign-document
  "The document plus signer and signature over its canonical form (signature excluded)."
  [private-key did document]
  (let [doc (assoc (dissoc document "signature") "signer" did)]
    (assoc doc "signature" (b64u (crypto/sign nil (canonical doc) private-key)))))

;; ---------------------------------------------------------------------------
;; Files

(defn file-path [root & parts] (apply path/join root parts))
(defn exists? [p] (fs/existsSync p))
(defn read-json [p] (js->clj (js/JSON.parse (fs/readFileSync p "utf8"))))

(defn atomic-write [p data]
  (let [tmp (str p ".tmp")]
    (fs/writeFileSync tmp data #js {:mode 0600})
    (fs/renameSync tmp p)))

(defn create-exclusive
  "Write a new file. false when it already exists."
  [p data]
  (try (fs/writeFileSync p data #js {:flag "wx" :mode 0600}) true
       (catch :default e (if (= "EEXIST" (.-code e)) false (throw e)))))

(defn hash-file [p]
  (let [h (crypto/createHash "sha256") fd (fs/openSync p "r") buf (js/Buffer.alloc (* 1024 1024))]
    (try
      (loop []
        (let [n (fs/readSync fd buf 0 (.-length buf) nil)]
          (when (pos? n) (.update h (.subarray buf 0 n)) (recur))))
      (finally (fs/closeSync fd)))
    (str "sha256:" (.digest h "hex"))))

(defn file-stamp [p] (let [s (fs/statSync p #js {:bigint true})] [(str (.-size s)) (str (.-mtimeNs s))]))

(defn now-s [] (js/Math.floor (/ (js/Date.now) 1000)))

;; ---------------------------------------------------------------------------
;; Init: node key and the serving pins

(defn load-node [root]
  (let [pem (fs/readFileSync (file-path root "node.pem") "utf8")
        private-key (crypto/createPrivateKey pem)]
    {:private private-key :did (did-of (crypto/createPublicKey private-key))}))

(defn init! [root provider engine-file engine-version model-file model-revision upstream]
  (let [url (js/URL. upstream)]
    (when-not (and (contains? #{"http:"} (.-protocol url))
                   (contains? loopback (str/replace (.-hostname url) #"^\[|\]$" "")))
      (throw (ex-info "the upstream must be a local http address" {:upstream upstream}))))
  (when-not (str/starts-with? provider "did:key:z")
    (throw (ex-info "the provider must be a did:key" {:provider provider})))
  (fs/mkdirSync (file-path root "keys") #js {:recursive true :mode 0700})
  (fs/mkdirSync (file-path root "orders") #js {:recursive true :mode 0700})
  (fs/mkdirSync (file-path root "blocks") #js {:recursive true :mode 0700})
  (let [pem-path (file-path root "node.pem")]
    (when-not (exists? pem-path)
      (let [pair (crypto/generateKeyPairSync "ed25519")]
        (when-not (create-exclusive pem-path (.export (.-privateKey pair) #js {:type "pkcs8" :format "pem"}))
          (throw (ex-info "node key appeared while creating it" {}))))))
  (let [node (load-node root)
        model-real (fs/realpathSync model-file)
        config {"provider" provider
                "node" (:did node)
                "upstream" (str/replace upstream #"/+$" "")
                "engine-file" (fs/realpathSync engine-file)
                "engine" {"name" "llama.cpp" "version" engine-version "digest" (hash-file engine-file)}
                "model-file" model-real
                "model" {"revision" model-revision "digest" (hash-file model-real)}
                "engine-stamp" (file-stamp engine-file)
                "model-stamp" (file-stamp model-real)}]
    (when (= provider (:did node))
      (throw (ex-info "the node key cannot be the provider (JUN-28)" {})))
    (atomic-write (file-path root "config.json") (canonical config))
    (select-keys config ["provider" "node" "engine" "model" "upstream"])))

;; ---------------------------------------------------------------------------
;; Register (operator command on this host)

(defn refuse [status code message] (throw (ex-info message {:status status :code code})))

(defn check-binding
  "Refuse an order this node could not honestly serve. sanka.core checks the order's own shape."
  [config order now]
  (when-not (map? order) (refuse 400 "order_invalid" "The order must be a JSON object."))
  (let [checked (core/check-order (into {} (map (fn [[k v]] [(keyword k) (if (map? v) (into {} (map (fn [[a b]] [(keyword a) b]) v)) v)]) order)))]
    (when-not (:ok checked)
      (refuse 400 "order_invalid" (str "The order fails sanka.core: " (str/join ", " (:errors checked))))))
  (when (not= "compute" (get order "work-kind")) (refuse 400 "order_work_kind" "This node serves compute orders only."))
  (when-not (contains? #{"simulation" "devnet"} (get order "value-class"))
    (refuse 400 "order_value_class" "Only simulation and devnet orders are served."))
  (when (not= (get config "provider") (get order "provider")) (refuse 400 "order_provider" "The order names another provider."))
  (when (not= (get config "node") (get order "node")) (refuse 400 "order_node" "The order names another node."))
  (when (not= (get config "model") (get order "model")) (refuse 400 "order_model" "The order pins a model this node does not serve."))
  (when (<= (get order "expires-at") now) (refuse 400 "order_expired" "The order has already expired.")))

(defn register! [root order-file key-hash]
  (let [config (read-json (file-path root "config.json"))
        order (if (= "-" order-file)
                (js->clj (js/JSON.parse (fs/readFileSync 0 "utf8")))
                (read-json order-file))]
    (check-binding config order (now-s))
    (when-not (re-matches #"[0-9a-f]{64}" (str key-hash))
      (refuse 400 "order_key" "The key hash must be 64 lower-case hex digits."))
    (let [cid (cid-of (canonical order))
          dir (file-path root "orders" cid)]
      (try (fs/mkdirSync dir #js {:mode 0700})
           (catch :default e
             (if (= "EEXIST" (.-code e))
               (refuse 409 "order_exists" "This order is already registered.")
               (throw e))))
      (atomic-write (file-path dir "order.json") (canonical order))
      (when-not (create-exclusive (file-path root "keys" key-hash) cid)
        (fs/rmSync dir #js {:recursive true})
        (refuse 409 "order_key_used" "This key already belongs to an order."))
      {"order" cid})))

;; ---------------------------------------------------------------------------
;; Serve

(defn lookup [root key]
  (let [p (file-path root "keys" (sha256-hex (js/Buffer.from key "utf8")))]
    (when (exists? p)
      (let [cid (str (fs/readFileSync p "ascii"))]
        [cid (read-json (file-path root "orders" cid "order.json"))]))))

(defn fetch-json [url opts]
  (let [ctrl (js/AbortController.)
        timer (js/setTimeout #(.abort ctrl) upstream-timeout-ms)]
    (-> (js/fetch url (clj->js (merge opts {:redirect "error" :signal (.-signal ctrl)})))
        (p/then (fn [res]
                  (when-not (.-ok res) (throw (ex-info "upstream status" {:status (.-status res)})))
                  (.arrayBuffer res)))
        (p/then (fn [ab]
                  (when (> (.-byteLength ab) max-upstream-bytes) (throw (ex-info "upstream too large" {})))
                  (js->clj (js/JSON.parse (.toString (js/Buffer.from ab) "utf8")))))
        (p/finally (fn [] (js/clearTimeout timer))))))

(defn check-serving
  "Refuse before spending an order if the receipt could not be true."
  [config]
  (when (or (not= (get config "model-stamp") (file-stamp (get config "model-file")))
            (not= (get config "engine-stamp") (file-stamp (get config "engine-file"))))
    (refuse 503 "serving_changed" "The model or engine file changed after its digest was taken."))
  (-> (fetch-json (str (get config "upstream") "/props") {:method "GET"})
      (p/catch (fn [_] (refuse 502 "upstream_unavailable" "The inference engine did not answer.")))
      (p/then (fn [props]
                (let [serving (get props "model_path")]
                  (when-not (and (string? serving) (exists? serving)
                                 (= (fs/realpathSync serving) (get config "model-file")))
                    (refuse 502 "upstream_model_mismatch" "The inference engine is serving a different model.")))))))

(defn append-ledger!
  "One block per order, chained from nothing, and a head signed by this node. Returns the block CID."
  [root node order-cid entry]
  (let [block (merge {"type" "kotoba.turn" "session" (str "order-" order-cid) "seq" 0 "prev" nil
                      "node" (:did node) "at" (now-s)}
                     entry)
        bytes (canonical block)
        cid (cid-of bytes)]
    (create-exclusive (file-path root "blocks" cid) bytes)
    (atomic-write (file-path root "orders" order-cid "head.json")
                  (canonical (sign-document (:private node) (:did node)
                                            {"type" "kotoba.head" "session" (str "order-" order-cid)
                                             "seq" 0 "cid" cid})))
    cid))

(defn fail! [root cid code message]
  (atomic-write (file-path root "orders" cid "failed.json") (canonical {"code" code}))
  (refuse 502 code message))

(defn serve-order [root config node cid order key raw-body body]
  (when (<= (get order "expires-at") (now-s)) (refuse 403 "order_expired" "This order has expired."))
  (p/let [_ (check-serving config)]
    (when-not (create-exclusive (file-path root "orders" cid "claim") "")
      (refuse 409 "order_used" "This order's key has already been used."))
    (let [cap (get order "max-tokens")
          asked (get body "max_tokens")
          forwarded (-> (dissoc body "stream" "stream_options" "n")
                        (assoc "max_tokens" (if (and (integer? asked) (< 0 asked cap)) asked cap)))
          started (now-s)]
      (-> (fetch-json (str (get config "upstream") "/v1/chat/completions")
                      {:method "POST" :headers {"Content-Type" "application/json"}
                       :body (js/JSON.stringify (clj->js forwarded))})
          (p/catch (fn [_] (fail! root cid "upstream_failed" "The inference engine did not return a result.")))
          (p/then
           (fn [reply]
             (let [message (get-in reply ["choices" 0 "message"])
                   usage (get reply "usage")
                   pt (get usage "prompt_tokens")
                   ct (get usage "completion_tokens")]
               (when-not (and (map? message) (nat-int? pt) (nat-int? ct))
                 (fail! root cid "upstream_failed" "The inference engine returned no measurement."))
               (let [measured {"prompt-tokens" pt "completion-tokens" ct
                               "started-at" started "finished-at" (now-s)}
                     input (str "hmac-sha256:" (-> (crypto/createHmac "sha256" (js/Buffer.from key "utf8"))
                                                   (.update raw-body) (.digest "hex")))
                     output (cid-of (canonical message))
                     head (append-ledger! root node cid {"order" cid "input" input "output" output
                                                         "measured" measured})
                     receipt (sign-document (:private node) (:did node)
                                            {"kind" receipt-kind
                                             "work-kind" (get order "work-kind")
                                             "order" cid
                                             "provider" (get config "provider")
                                             "node" (:did node)
                                             "input" input
                                             "output" output
                                             "engine" (get config "engine")
                                             "model" (get config "model")
                                             "measured" measured
                                             "ledger-head" head
                                             "demand" (get order "demand")
                                             "nonce" (get order "nonce")})
                     receipt-bytes (canonical receipt)]
                 (atomic-write (file-path root "orders" cid "receipt.json") receipt-bytes)
                 {:reply reply :receipt-cid (cid-of receipt-bytes)}))))))))

(defn stored-receipt [root cid]
  (let [dir (file-path root "orders" cid)]
    (cond
      (not (exists? dir)) (refuse 404 "order_unknown" "No such order.")
      (exists? (file-path dir "failed.json")) (refuse 409 "order_failed" "This order failed and has no receipt.")
      (not (exists? (file-path dir "receipt.json"))) (refuse 404 "receipt_pending" "This order has no receipt yet.")
      :else (read-json (file-path dir "receipt.json")))))

(defn send-json
  "JSON response. Plain JSON.stringify, not the canonical form: llama.cpp replies carry fractional
  timings, and the reply is not hashed by the desk (only its message is, in canonical form)."
  [res status value headers]
  (let [body (js/Buffer.from (js/JSON.stringify (clj->js value)) "utf8")]
    (.writeHead res status (clj->js (merge {"Content-Type" "application/json"
                                            "Content-Length" (.-length body)}
                                           headers)))
    (.end res body)))

(defn refusal
  "The refusal in an error's cause chain. nbb's interpreter wraps a thrown ex-info in its own,
  so the :status and :code of `refuse` sit on a cause, not on the outer error."
  [e]
  (loop [e e]
    (when e
      (if (:code (ex-data e)) e (recur (ex-cause e))))))

(defn send-error [res e]
  (let [r (refusal e)
        {:keys [status code]} (ex-data r)]
    ;; Log only the code or the internal error's message: never a body, prompt or key.
    (when-not status (js/console.error "internal error:" (ex-message e)))
    (send-json res (or status 500) {"error" {"code" (or code "internal")
                                             "message" (if status (ex-message r) "Internal error.")}} {})))

(defn read-body [req]
  (js/Promise.
   (fn [resolve reject]
     (let [chunks #js [] size (atom 0)]
       (.on req "data" (fn [c]
                         (swap! size + (.-length c))
                         (if (> @size max-request-bytes)
                           (do (reject (ex-info "too large" {:status 413 :code "request_too_large"})) (.destroy req))
                           (.push chunks c))))
       (.on req "end" #(resolve (js/Buffer.concat chunks)))
       (.on req "error" reject)))))

(defn bearer [req]
  (let [h (aget (.-headers req) "authorization")]
    (when (and (string? h) (str/starts-with? h "Bearer ")) (subs h 7))))

(defn handler [root config node]
  (fn [req res]
    (-> (p/let [method (.-method req)
                url (.-url req)
                key (bearer req)
                found (when key (lookup root key))
                raw (read-body req)]
          (cond
            (nil? found) (refuse 401 "order_key" "No order opens with this key.")
            (and (= method "POST") (= url "/v1/chat/completions"))
            (let [[cid order] found
                  body (try (js->clj (js/JSON.parse (.toString raw "utf8")))
                            (catch :default _ (refuse 400 "request_invalid" "The body must be JSON.")))]
              (when-not (map? body) (refuse 400 "request_invalid" "The body must be a JSON object."))
              (p/let [served (serve-order root config node cid order key raw body)]
                (send-json res 200 (:reply served) {"X-Awai-Order" cid "X-Awai-Receipt" (:receipt-cid served)})))
            (and (= method "GET") (= url (str "/v1/orders/" (first found) "/receipt")))
            (send-json res 200 (stored-receipt root (first found)) {})
            :else (refuse 404 "not_found" "An order's key opens only its own call and receipt.")))
        (p/catch (fn [e] (send-error res e))))))

(defn serve! [root port]
  (let [config (read-json (file-path root "config.json"))
        node (load-node root)]
    (when (not= (:did node) (get config "node")) (throw (ex-info "node key does not match config" {})))
    (when (not= (get-in config ["model" "digest"]) (hash-file (get config "model-file")))
      (throw (ex-info "model digest changed since init" {})))
    (when (not= (get-in config ["engine" "digest"]) (hash-file (get config "engine-file")))
      (throw (ex-info "engine digest changed since init" {})))
    (let [server (http/createServer (handler root config node))]
      (.listen server (js/Number port) "127.0.0.1"
               #(println (canonical-string {"listening" (str "127.0.0.1:" port) "node" (:did node)}))))))

;; ---------------------------------------------------------------------------

(defn -main [[cmd & args]]
  (try
    (case cmd
      "init" (println (canonical-string (apply init! args)))
      "register" (println (canonical-string (apply register! args)))
      "receipt" (println (canonical-string (stored-receipt (first args) (second args))))
      "serve" (apply serve! args)
      (do (println "usage: init | register | receipt | serve") (js/process.exit 2)))
    (catch :default e
      (println (canonical-string {"error" {"code" (or (:code (ex-data (refusal e))) "failed")
                                           "message" (ex-message (or (refusal e) e))}}))
      (js/process.exit 1))))

(-main *command-line-args*)
