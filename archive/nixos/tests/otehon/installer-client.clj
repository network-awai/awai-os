;; Exercise the production client transport against a private local fake peer.
;; Only the fixed endpoint literal is replaced in memory; no GUI/root/disk access.
(require '[clojure.test :refer [deftest is run-tests]])
(import '[java.nio.channels ServerSocketChannel SocketChannel]
        '[java.net UnixDomainSocketAddress StandardProtocolFamily]
        '[java.nio ByteBuffer]
        '[java.nio.file Files Paths])
(def socket-path (str ".agent-output/client-" (System/nanoTime) ".sock"))
(.mkdirs (java.io.File. ".agent-output"))
(load-string (.replace (slurp (first *command-line-args*))
                       "/run/otehon-install/control.sock" socket-path))
(defn with-peer [handler client]
  (with-open [server (ServerSocketChannel/open StandardProtocolFamily/UNIX)]
    (.bind server (UnixDomainSocketAddress/of socket-path))
    (let [worker (future
                   (try
                     (with-open [channel (.accept server)]
                       (let [in (ByteBuffer/allocate 4096)]
                         (.read channel in)
                         (handler channel (String. (.array in) 0 (.position in) "UTF-8"))))
                     (catch Exception _ nil)))]
      (try (client) (finally (deref worker 6000 nil)))))
  (Files/deleteIfExists (Paths/get socket-path (make-array String 0))))
(defn send! [channel text]
  (let [bytes (ByteBuffer/wrap (.getBytes text "UTF-8"))]
    (while (.hasRemaining bytes) (.write channel bytes))))
(deftest fragmented-reply
  (with-peer (fn [channel request]
               (is (= request "STATUS\n"))
               (send! channel "{\"ok\" true \"value\" {")
               (Thread/sleep 30)
               (send! channel "\"phase\" \"idle\" \"message\" \"照合\"}}\n"))
             #(is (= {:phase "idle" :message "照合"} (awai.installer/rpc "STATUS")))))
(deftest refusal
  (with-peer (fn [channel _] (send! channel "{\"ok\" false \"error\" \"approval-stale\"}\n"))
             #(is (thrown-with-msg? clojure.lang.ExceptionInfo #"approval-stale" (awai.installer/rpc "STATUS")))))
(deftest response-bound
  (with-peer (fn [channel _] (send! channel (str (apply str (repeat 262145 "x")) "\n")))
             #(is (thrown-with-msg? clojure.lang.ExceptionInfo #"上限" (awai.installer/rpc "STATUS")))))
(deftest deadline
  (with-peer (fn [_ _] (Thread/sleep 5500))
             #(is (thrown-with-msg? clojure.lang.ExceptionInfo #"タイムアウト" (awai.installer/rpc "STATUS")))))
(let [result (run-tests)]
  (shutdown-agents)
  (System/exit (if (zero? (+ (:fail result) (:error result))) 0 1)))
