(ns manimani.service
  "The always-on Manimani service. It listens on loopback only, and systemd denies it every other
  address, so a prompt cannot leave the machine. One worker runs turns in order."
  (:require [cheshire.core :as json]
            [clojure.edn :as edn]
            [clojure.string :as str]
            [manimani.core :as core]
            [org.httpkit.client :as http]
            [org.httpkit.server :as server])
  (:import [java.nio.file Files Paths StandardCopyOption]
           [java.util.concurrent LinkedBlockingQueue]))

(defn- env [name fallback] (or (System/getenv name) fallback))

(def port (parse-long (env "MANIMANI_PORT" "8771")))
(def state-file (env "MANIMANI_STATE" "/var/lib/otehon-manimani/state.edn"))
(def llm-url (env "MANIMANI_LLM" "http://127.0.0.1:8772"))
(def agents-file (System/getenv "MANIMANI_AGENTS"))
(def tick-ms (parse-long (env "MANIMANI_TICK_MS" "30000")))
(def llm-timeout-ms (parse-long (env "MANIMANI_LLM_TIMEOUT_MS" "600000")))
;; A file:// page sends the origin "null". No other page may use this service.
(def allowed-origins #{"null"})
(def max-body 65536)

(defn- load-agents []
  (let [agents (if agents-file (json/parse-string (slurp agents-file) true) [])]
    (doseq [{:keys [id url]} agents]
      (when-not (core/loopback-url? url)
        (throw (ex-info "an agent must be on loopback" {:agent id}))))
    (mapv #(update % :approval keyword) agents)))

(def agents (load-agents))

(defn- read-state []
  (try
    (merge core/initial (edn/read-string (slurp state-file)))
    (catch java.io.FileNotFoundException _ core/initial)))

(defonce state (atom nil))
(defonce model-up (atom false))
(def jobs (LinkedBlockingQueue.))

(defn- now [] (System/currentTimeMillis))

(defn- save! [value]
  (let [target (Paths/get state-file (make-array String 0))
        temporary (Paths/get (str state-file ".tmp") (make-array String 0))]
    (Files/writeString temporary (pr-str value) (make-array java.nio.file.OpenOption 0))
    (Files/move temporary target
                (into-array java.nio.file.CopyOption
                            [StandardCopyOption/ATOMIC_MOVE StandardCopyOption/REPLACE_EXISTING]))))

(defn- change! [f & args]
  (let [value (apply swap! state f args)]
    (save! value)
    value))

(defn- post-json [url body timeout]
  (let [{:keys [status body error]} @(http/post url {:headers {"content-type" "application/json"}
                                                     :body (json/generate-string body)
                                                     :timeout timeout
                                                     :as :text
                                                     :follow-redirects false})]
    (when (or error (not= 200 status))
      (throw (ex-info "local call failed" {:status status})))
    (json/parse-string body true)))

(defn- ask-model [messages]
  (-> (post-json (str llm-url "/v1/chat/completions")
                 {:messages messages :tools core/tools :temperature 0.3 :stream false}
                 llm-timeout-ms)
      :choices first :message))

(defn- tool-call [{:keys [function]}]
  {:name (:name function)
   :arguments (try (json/parse-string (:arguments function) true)
                   (catch Exception _ {}))})

(defn- run-delegate [agent-id prompt]
  (let [agent (first (filter #(= agent-id (:id %)) agents))]
    (try
      (let [reply (post-json (:url agent)
                             {:model (:model agent "default")
                              :messages [{:role "user" :content prompt}]
                              :stream false}
                             llm-timeout-ms)
            text (-> reply :choices first :message :content)]
        (change! core/add-message (now) "agent" (str (:name agent) ": " (str/trim (str text))))
        (change! core/log-activity (now) "agent-replied" (:name agent))
        (.put jobs [:turn]))
      (catch Exception _
        (change! core/log-activity (now) "agent-failed" (:name agent))
        (change! core/add-message (now) "notice" (str (:name agent) " did not answer."))))))

(defn- run-effects [effects]
  (doseq [[kind a b] effects]
    (when (= kind :delegate)
      (.put jobs [:delegate a b]))))

(defn- run-turn []
  (try
    (loop [extra [] round 0]
      (let [message (ask-model (into (core/chat-messages @state agents) extra))
            calls (:tool_calls message)]
        (if (and (seq calls) (< round core/max-tool-rounds))
          (let [replies
                (mapv (fn [call]
                        (let [{:keys [state reply effects]}
                              (core/apply-tool @state (now) agents (tool-call call))]
                          (reset! manimani.service/state state)
                          (save! state)
                          (run-effects effects)
                          {:role "tool" :tool_call_id (:id call) :content reply}))
                      calls)]
            (recur (-> extra (conj message) (into replies)) (inc round)))
          (when-let [text (core/clean-text (:content message))]
            (change! core/add-message (now) "assistant" text)))))
    (catch Exception _
      ;; There is no remote to fall back to. The person is told, and nothing is made up.
      (change! core/add-message (now) "notice" "The local model did not answer.")
      (change! core/log-activity (now) "model-failed" ""))))

(defn- worker []
  (loop []
    (let [[kind a b] (.take jobs)]
      (case kind
        :turn (run-turn)
        :delegate (run-delegate a b)))
    (recur)))

(defn- tick []
  (loop []
    (reset! model-up (try
                       (= 200 (:status @(http/get (str llm-url "/health") {:timeout 3000})))
                       (catch Exception _ false)))
    (let [{:keys [state due]} (core/take-due-tasks @manimani.service/state (now))]
      (when (seq due)
        (reset! manimani.service/state state)
        (save! state)
        (doseq [{:keys [title prompt]} due]
          (change! core/add-message (now) "task" (str title ": " prompt))
          (change! core/log-activity (now) "task-ran" title)
          (.put jobs [:turn]))))
    (Thread/sleep tick-ms)
    (recur)))

(defn- cors [headers origin]
  (cond-> (assoc headers "x-content-type-options" "nosniff" "cache-control" "no-store")
    (contains? allowed-origins origin)
    (assoc "access-control-allow-origin" origin
           "access-control-allow-methods" "GET, POST"
           "access-control-allow-headers" "content-type")))

(defn- reply [origin status body]
  {:status status
   :headers (cors {"content-type" "application/json"} origin)
   :body (json/generate-string body)})

(defn- read-body [request]
  (let [text (some-> (:body request) slurp)]
    (cond
      (nil? text) {}
      (> (count text) max-body) ::too-long
      :else (try (json/parse-string text true) (catch Exception _ ::bad)))))

(defn- route [origin request body]
  (let [uri (:uri request)
        method (:request-method request)
        ok #(reply origin 200 {:ok true})]
    (cond
      (and (= :get method) (= "/v1/state" uri))
      (reply origin 200 (core/view @state (if @model-up "ready" "model-unavailable") agents))

      (and (= :post method) (= "/v1/messages" uri))
      (if-let [text (core/clean-text (:text body))]
        (do (change! core/add-message (now) "user" text)
            (.put jobs [:turn])
            (reply origin 202 {:ok true}))
        (reply origin 400 {:error "bad-text"}))

      (and (= :post method) (= "/v1/pause" uri))
      (do (change! core/set-paused (now) (:paused body)) (ok))

      (and (= :post method) (= "/v1/memory/clear" uri))
      (do (change! core/clear-memory (now)) (ok))

      (and (= :post method) (= "/v1/tasks" uri))
      (let [{:keys [error state]} (core/add-task @manimani.service/state (now) body)]
        (if error
          (reply origin 400 {:error error})
          (do (reset! manimani.service/state state) (save! state) (ok))))

      (and (= :post method) (re-matches #"/v1/tasks/[0-9]+/delete" uri))
      (do (change! core/remove-task (now) (nth (str/split uri #"/") 3)) (ok))

      (and (= :post method) (re-matches #"/v1/approvals/[0-9]+" uri))
      (let [{:keys [state effects]} (core/decide-approval @manimani.service/state (now)
                                                          (last (str/split uri #"/"))
                                                          (:approve body))]
        (reset! manimani.service/state state)
        (save! state)
        (run-effects effects)
        (ok))

      :else (reply origin 404 {:error "not-found"}))))

(defn- handler [request]
  (let [origin (get-in request [:headers "origin"])
        host (get-in request [:headers "host"])]
    (cond
      ;; The Host check stops a web page from reaching this port through DNS rebinding.
      (not= host (str "127.0.0.1:" port)) (reply nil 403 {:error "bad-host"})
      (and origin (not (contains? allowed-origins origin))) (reply nil 403 {:error "bad-origin"})
      (= :options (:request-method request)) {:status 204 :headers (cors {} origin)}
      :else
      (let [body (read-body request)]
        (case body
          ::too-long (reply origin 413 {:error "too-long"})
          ::bad (reply origin 400 {:error "bad-json"})
          (route origin request body))))))

(defn -main [& _]
  (when-not (core/loopback-url? llm-url)
    (throw (ex-info "inference must be on loopback" {})))
  (reset! state (read-state))
  (save! @state)
  (doto (Thread. ^Runnable worker) (.setDaemon true) (.start))
  (doto (Thread. ^Runnable tick) (.setDaemon true) (.start))
  (server/run-server handler {:ip "127.0.0.1" :port port})
  @(promise))
