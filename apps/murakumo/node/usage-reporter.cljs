(ns usage-reporter
  "Murakumo node usage reporter (AWAI-3377, stage 5 of AWAI-3203). Runs on a Mac node with nbb, the
  execution path of the Sanka desk (ADR 0026 D3).

  It reads this Mac's RAM, CPU, GPU and disk, and asks a loopback llama-server which model it
  serves. The result is an `awai.murakumo.device-usage.v1` snapshot signed with a usage-report key
  of its own (not a receipt or wallet key). It is read only: it never loads a model, starts
  inference or accepts a request body.

    nbb usage-reporter.cljs init ROOT DEVICE [--upstream http://127.0.0.1:PORT] [--model ID=PATH]... [--origin ORIGIN]...
    nbb usage-reporter.cljs public-key ROOT
    nbb usage-reporter.cljs report ROOT
    nbb usage-reporter.cljs serve ROOT PORT        # 127.0.0.1 only; GET /v1/murakumo/usage

  A phone reaches `serve` through an authenticated tailnet HTTPS route (Tailscale Serve), never an
  open port."
  (:require ["node:crypto" :as crypto]
            ["node:fs" :as fs]
            ["node:path" :as path]
            ["node:http" :as http]
            ["node:child_process" :as cp]
            [clojure.string :as str]
            [nbb.core :refer [*file*]]
            [promesa.core :as p]))

(def report-schema "awai.murakumo.device-usage-report.v1")
(def usage-schema "awai.murakumo.device-usage.v1")
(def route "/v1/murakumo/usage")

(defn- die [& msg] (binding [*print-fn* *print-err-fn*] (apply println msg)) (js/process.exit 2))
(defn- read-json [f] (js->clj (js/JSON.parse (fs/readFileSync f "utf8")) :keywordize-keys true))
(defn- write-json [f x] (fs/writeFileSync f (str (js/JSON.stringify (clj->js x) nil 2) "\n") #js {:mode 0600}))
(defn- int-of [s] (when s (let [n (js/parseInt s 10)] (when (js/Number.isSafeInteger n) n))))
(defn- clamp-percent [x] (when (number? x) (max 0 (min 100 (js/Math.round x)))))

;; ---------------------------------------------------------------------------
;; Parsers (pure; covered by test/reporter.test.mjs through `selftest`)

(defn vm-used-bytes
  "Memory in use, as Activity Monitor counts it: app memory (anonymous minus purgeable), wired and
  compressed. nil when a field is missing."
  [text]
  (let [page (int-of (second (re-find #"page size of (\d+) bytes" (or text ""))))
        field (fn [k] (int-of (second (re-find (re-pattern (str k ":\\s+(\\d+)\\.")) (or text "")))))
        [anon purgeable wired compressed :as xs] (map field ["Anonymous pages" "Pages purgeable" "Pages wired down" "Pages occupied by compressor"])]
    (when (and page (every? some? xs))
      (* page (+ (max 0 (- anon purgeable)) wired compressed)))))

(defn cpu-percent
  "Busy share of all cores from the last `top` sample (user + sys). The first sample of `top -l 2`
  covers time since boot, so only the last line is used."
  [text]
  (when-let [[_ user sys] (last (re-seq #"CPU usage: ([0-9.]+)% user, ([0-9.]+)% sys" (or text "")))]
    (clamp-percent (+ (js/parseFloat user) (js/parseFloat sys)))))

(defn gpu-percent
  "Apple GPU utilization from IOAccelerator's performance statistics, readable without root. nil when
  the key is absent (unknown, not 0)."
  [text]
  (some-> (re-find #"\"Device Utilization %\"=(\d+)" (or text "")) second int-of clamp-percent))

(defn df-bytes
  "Free and total bytes of the filesystem holding a path, from `df -k`."
  [text]
  (let [cols (some-> text str/trim str/split-lines last (str/split #"\s+"))
        total (some-> (get cols 1) int-of) avail (some-> (get cols 3) int-of)]
    (when (and total avail (pos? total) (<= avail total)) {:free (* 1024 avail) :total (* 1024 total)})))

;; ---------------------------------------------------------------------------
;; Keys and signing

(defn- b64url [buf] (.toString (js/Buffer.from buf) "base64url"))
(defn public-key-b64 [private-key]
  (let [der (.export (crypto/createPublicKey private-key) #js {:type "spki" :format "der"})]
    (b64url (.subarray der (- (.-length der) 32)))))

(defn signed-report
  "Sign the exact payload bytes, prefixed with the schema and a newline (domain separation)."
  [private-key usage]
  (let [payload (js/JSON.stringify (clj->js usage))
        message (js/Buffer.from (str report-schema "\n" payload) "utf8")]
    {:schema report-schema :payload payload :key (public-key-b64 private-key)
     :signature (b64url (crypto/sign nil message private-key))}))

;; ---------------------------------------------------------------------------
;; Measurement

(defn- sh [cmd & args]
  (try (str (cp/execFileSync cmd (clj->js args) #js {:encoding "utf8" :timeout 10000 :stdio #js ["ignore" "pipe" "ignore"]}))
       (catch :default _ nil)))

(defn- file-stamp [f] (let [s (fs/statSync f)] {:size (.-size s) :mtime-ms (js/Math.trunc (.-mtimeMs s))}))

(defn- fetch-json [url]
  (-> (js/fetch url #js {:signal (js/AbortSignal.timeout 2000)})
      (.then (fn [r] (if (.-ok r) (.then (.json r) #(js->clj % :keywordize-keys true)) {:http-status (.-status r)})))
      (.catch (fn [_] nil))))

(defn- engine-state
  "What the loopback llama-server serves: {:engine \"serving\" :loaded {...}}, or only :engine
  (\"none\", \"loading\", \"not-configured\", \"unknown\") when no model can be named. A model whose path and file stamp
  are not a configured catalog file is reported as \"unrecognized\". since-ms is when this reporter
  first saw that model served, kept in ROOT/seen.json."
  [root {:keys [upstream models]}]
  (if-not upstream
    (p/resolved {:engine "not-configured"})
    (p/let [health (fetch-json (str upstream "/health"))]
      (cond
        (nil? health) {:engine "none"}
        ;; While a model loads, llama-server answers 503 and tells neither the model nor its context.
        (= 503 (:http-status health)) {:engine "loading"}
        (:http-status health) {:engine "unknown"}
        :else
        (p/let [props (fetch-json (str upstream "/props")) slots (fetch-json (str upstream "/slots"))]
          (let [model-path (:model_path props)
                ctx (or (get-in props [:default_generation_settings :n_ctx]) (:n_ctx props))
                known (some (fn [m] (when (and (= (:path m) model-path) (fs/existsSync model-path)
                                               (= (select-keys m [:size :mtime-ms]) (file-stamp model-path)))
                                      (:id m))) models)
                busy? (and (sequential? slots) (some :is_processing slots))
                seen-file (path/join root "seen.json")
                seen (when (fs/existsSync seen-file) (read-json seen-file))
                since (if (and (= (:path seen) model-path) (int? (:since-ms seen))) (:since-ms seen) (js/Date.now))]
            (if (and (string? model-path) (int? ctx) (pos? ctx) (sequential? slots))
              (do (when-not (= (:path seen) model-path) (write-json seen-file {:path model-path :since-ms since}))
                  {:engine "serving"
                   :loaded {:model (or known "unrecognized") :context ctx :state (if busy? "busy" "idle") :since-ms since}})
              {:engine "unknown"})))))))

(defn measure [root config]
  (p/let [{:keys [engine loaded]} (engine-state root config)]
    (let [total (int-of (some-> (sh "sysctl" "-n" "hw.memsize") str/trim))
          used (vm-used-bytes (sh "vm_stat"))
          disk (df-bytes (sh "df" "-k" root))]
      {:schema usage-schema :device (:device config) :kind "mac"
       :model-name (some-> (sh "sysctl" "-n" "hw.model") str/trim)
       :observed-at-ms (js/Date.now)
       :ram {:total total :used (when (and total used) (min used total))}
       :cpu-percent (cpu-percent (sh "top" "-l" "2" "-n" "0" "-s" "1"))
       :gpu-percent (gpu-percent (sh "ioreg" "-r" "-d" "1" "-w" "0" "-c" "IOAccelerator"))
       :disk (or disk {:free nil :total nil})
       :engine engine
       :loaded loaded})))

;; ---------------------------------------------------------------------------
;; Commands

(defn- key-file [root] (path/join root "usage-key.pem"))
(defn- private-key [root] (crypto/createPrivateKey (fs/readFileSync (key-file root))))
(defn- config [root] (read-json (path/join root "config.json")))
(def catalog-file (path/join (path/dirname *file*) ".." "catalog.json"))

(defn- sha256-file [f]
  (let [h (crypto/createHash "sha256") fd (fs/openSync f "r") buf (js/Buffer.alloc (* 1024 1024))]
    (loop [] (let [n (fs/readSync fd buf 0 (.-length buf) nil)] (when (pos? n) (.update h (.subarray buf 0 n)) (recur))))
    (fs/closeSync fd) (.digest h "hex")))

(defn- loopback-url? [u]
  (try (let [x (js/URL. u)] (and (= "http:" (.-protocol x)) (= "127.0.0.1" (.-hostname x)) (= "/" (.-pathname x)) (= "" (.-search x))))
       (catch :default _ false)))

(defn init [root device opts]
  (when-not (re-matches #"[a-z0-9][a-z0-9-]{0,31}" (or device "")) (die "device: lowercase letters, digits and -"))
  (let [{:keys [upstream models origins]} opts
        catalog (:models (read-json catalog-file))]
    (when (and upstream (not (loopback-url? upstream))) (die "upstream must be http://127.0.0.1:PORT"))
    (fs/mkdirSync root #js {:recursive true :mode 0700})
    (when-not (fs/existsSync (key-file root))
      (let [pair (crypto/generateKeyPairSync "ed25519")]
        (fs/writeFileSync (key-file root) (.export (.-privateKey pair) #js {:type "pkcs8" :format "pem"}) #js {:mode 0600})))
    (let [pinned (vec (for [[id f] models]
                        (let [e (some #(when (= id (:id %)) %) catalog) f (path/resolve f)]
                          (when-not e (die "unknown catalog model" id))
                          (when-not (= (:bytes e) (.-size (fs/statSync f))) (die "size differs from the catalog" id))
                          (when-not (= (:sha256 e) (sha256-file f)) (die "SHA-256 differs from the catalog" id))
                          (merge {:id id :path f} (file-stamp f)))))]
      (write-json (path/join root "config.json")
                  {:device device :upstream upstream :models pinned
                   :origins (if (seq origins) (vec origins) ["https://tauri.localhost"])})
      (println (public-key-b64 (private-key root))))))

(defn- parse-opts [args]
  (loop [[a b & more :as xs] args acc {:models [] :origins []}]
    (cond
      (empty? xs) acc
      (= a "--upstream") (recur more (assoc acc :upstream b))
      (= a "--model") (let [[id f] (str/split (or b "") #"=" 2)] (recur more (update acc :models conj [id f])))
      (= a "--origin") (recur more (update acc :origins conj b))
      :else (die "unknown option" a))))

(defn report [root] (p/let [u (measure root (config root))] (signed-report (private-key root) u)))

(defn serve [root port]
  (let [cfg (config root) key (private-key root) origins (set (:origins cfg))
        cache (atom nil)
        fresh-report (fn [] (let [[at r] @cache now (js/Date.now)]
                              (if (and r (< (- now at) 2000)) (p/resolved r)
                                  (p/let [u (measure root cfg) r (signed-report key u)] (reset! cache [now r]) r))))
        server (http/createServer
                (fn [req res]
                  (let [origin (aget (.-headers req) "origin")
                        cors (when (contains? origins origin) {"access-control-allow-origin" origin "vary" "Origin"})
                        send (fn [status headers body]
                               ;; One line per request: time, method, path, status. No headers, body or address.
                               (println (.toISOString (js/Date.)) (.-method req) (.-url req) status)
                               (.writeHead res status (clj->js (merge {"cache-control" "no-store" "x-content-type-options" "nosniff"} cors headers)))
                               (.end res body))]
                    (cond
                      (not= route (.-url req)) (send 404 {"content-type" "text/plain"} "not_found")
                      (= "OPTIONS" (.-method req)) (send 204 (when cors {"access-control-allow-methods" "GET" "access-control-max-age" "600"}) "")
                      (not= "GET" (.-method req)) (send 405 {"content-type" "text/plain" "allow" "GET"} "method_not_allowed")
                      :else (-> (fresh-report)
                                (.then #(send 200 {"content-type" "application/json"} (js/JSON.stringify (clj->js %))))
                                (.catch (fn [_] (send 500 {"content-type" "text/plain"} "measure_failed"))))))))]
    (.listen server (int-of port) "127.0.0.1" #(println "serving" route "on 127.0.0.1:" port))))

(defn selftest
  "Print the parsers' results for fixture files (used by the tests)."
  [vm top ioreg df]
  (println (js/JSON.stringify (clj->js {:ram-used (vm-used-bytes (fs/readFileSync vm "utf8"))
                                        :cpu (cpu-percent (fs/readFileSync top "utf8"))
                                        :gpu (gpu-percent (fs/readFileSync ioreg "utf8"))
                                        :disk (df-bytes (fs/readFileSync df "utf8"))}))))

(let [[cmd root & args] *command-line-args*]
  (case cmd
    "init" (init root (first args) (parse-opts (rest args)))
    "public-key" (println (public-key-b64 (private-key root)))
    "report" (-> (report root) (.then #(println (js/JSON.stringify (clj->js %))))
                 (.catch #(die "report failed" (str %))))
    "serve" (serve root (first args))
    "selftest" (apply selftest root args)
    (die "usage: init | public-key | report | serve | selftest")))
