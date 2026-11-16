(ns meiji.transport (:require [meiji.policy :as policy]))

(defn ssh-argv [provider]
  (let [{:keys [host user tail-ip local-port remote-port]} (:tunnel provider)
        origin (str "http://127.0.0.1:" local-port)]
    (policy/require! (and (= (:node provider) host)
                         (string? host) (re-matches #"[a-z0-9][a-z0-9-]{0,63}" host)
                         (string? user) (re-matches #"[a-z_][a-z0-9_-]{0,31}" user)
                         (string? tail-ip) (re-matches #"100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}" tail-ip)
                         (every? #(and (integer? %) (<= 1024 % 65535)) [local-port remote-port])
                         (= origin (:origin provider))) "invalid-inference-tunnel")
    ["/usr/bin/ssh" "-v" "-N" "-T" "-o" "BatchMode=yes" "-o" "StrictHostKeyChecking=yes"
     "-o" "ExitOnForwardFailure=yes" "-o" "ConnectTimeout=8"
     "-o" "ServerAliveInterval=30" "-o" "ServerAliveCountMax=2"
     "-o" (str "HostName=" tail-ip) "-l" user
     "-L" (str "127.0.0.1:" local-port ":127.0.0.1:" remote-port) host]))
