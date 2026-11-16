(ns bot-fleet.vm-client
 "Operator-side transport to the two explicitly pinned fixed-command VM endpoints."
 (:require [bot-fleet.vm-worker :as vm] [itonami.otehon.recurring-host :as d])
 (:import [java.util.concurrent TimeUnit]))
(def hosts {"vm-levi" "levi" "vm-benjamin" "benjamin"})
(defn call! [cfg node packet directory]
 (when-not (and (contains? hosts node) (= 64 (count (:ssh-sha cfg)))
                (= (:ssh-sha cfg) (itonami.otehon.etcd/binary-sha (:ssh cfg))))
  (throw (ex-info "pinned VM endpoint/transport required" {})))
 (d/private-dir! directory)
 (let [input (pr-str packet) out (str directory "/stdout.edn") err (str directory "/stderr.txt")
       args [(:ssh cfg) "-o" "ControlMaster=no" "-o" "ControlPath=none" "-o" "BatchMode=yes"
             "-o" "StrictHostKeyChecking=yes" "-o" (str "HostKeyAlias=awai-bot-" node)
             "-o" (str "UserKnownHostsFile=" (:known-hosts cfg)) "-o" "GlobalKnownHostsFile=/dev/null"
             "-o" "IdentitiesOnly=yes" "-o" "ForwardAgent=no" "-o" "ConnectTimeout=8"
             "-o" "ServerAliveInterval=10" "-o" "ServerAliveCountMax=3"
             "-i" (:identity cfg) "-J" (str "node@" (hosts node)) "-p" "22280" "-T"
             "root@127.0.0.1" "itonami-physics-v1"]
       _ (when (> (count (.getBytes input "UTF-8")) vm/max-packet) (throw (ex-info "VM packet bound" {})))
       _ (d/durable! (str directory "/input.edn") input)
       p (.start (doto (ProcessBuilder. ^java.util.List args)
                   (.redirectOutput (java.io.File. out)) (.redirectError (java.io.File. err))))]
  (with-open [stream (.getOutputStream p)] (.write stream (.getBytes input "UTF-8")))
  (when-not (.waitFor p 150 TimeUnit/SECONDS) (.destroyForcibly p) (throw (ex-info "VM outcome unknown; no redispatch" {})))
  (when-not (and (zero? (.exitValue p)) (<= (.length (java.io.File. out)) vm/max-packet))
    (throw (ex-info "VM transport outcome unknown; reconcile original only" {})))
  (vm/read-data (slurp out))))
