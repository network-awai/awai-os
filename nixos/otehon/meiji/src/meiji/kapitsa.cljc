(ns meiji.kapitsa
  "Explicit Mac Metal worker. No peer discovery, model switching or remote fallback.
   Secrets travel over private files and child stdin, never argv or environment."
  (:require [meiji.host :as host] [meiji.policy :as policy]
            [babashka.fs :as fs] [clojure.edn :as edn] [clojure.string :as str]
            [cheshire.core :as json])
  (:import [java.security SecureRandom] [java.util Base64]
           [java.nio.channels FileChannel] [java.nio.file StandardOpenOption]))

(def model-id "qwen3.6-35b-a3b:4bit")
(def model-revision "37e804f90e368a4de866bc34650b9dde67a78c8e")
(def draft-revision "51ef7b6923ad6c14cb1bb41c37a9041446496ab6")
(def engine-version "0.2.36")
(def release-sha256 "c88e9eecad73dab17aa300aa6dfab4a4a3370bc06b8f44e04a3e6928c482d1b3")

(defn serve-config [config token]
  (policy/require! (= {:os :macos :arch :aarch64} (host/host-platform)) "kapitsa-requires-apple-silicon")
  (policy/require! (and (integer? (:port config)) (<= 1024 (:port config) 65535)) "invalid-port")
  (policy/require! (and (integer? (:context config)) (<= 512 (:context config) 32768)) "invalid-context")
  (policy/require! (= model-revision (:model-revision config)) "model-revision-mismatch")
  (policy/require! (and (string? (:model-dir config)) (fs/absolute? (:model-dir config))
                        (fs/directory? (:model-dir config))) "model-not-downloaded")
  (policy/require! (and (string? token) (<= 32 (count token) 256)) "invalid-worker-token")
  {:model (:model-dir config) :model_id model-id :host "127.0.0.1" :port (:port config)
   :private true :local true :peer [] :allow_switch false :api_key token
   :context (:context config) :slots 1 :profile "precise" :idle_unload 1})

(defn token! [path]
  (if (fs/exists? path)
    (str/trim (slurp path))
    (let [bytes (byte-array 32)]
      (.nextBytes (SecureRandom.) bytes)
      (let [token (.encodeToString (.withoutPadding (Base64/getUrlEncoder)) bytes)]
        (with-open [out (java.nio.file.Files/newOutputStream (fs/path path)
                         (into-array StandardOpenOption [StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE]))]
          (fs/set-posix-file-permissions path "rw-------")
          (.write out (.getBytes token "UTF-8")))
        token))))

(defn verified-model! [config]
  (policy/require! (and (vector? (:files config)) (<= 5 (count (:files config)) 64)) "model-manifest-required")
  (doseq [{:keys [file sha256]} (:files config)]
    (policy/require! (and (string? file) (re-matches #"[A-Za-z0-9_./-]+" file)
                         (not (str/includes? file "..")) (not (str/starts-with? file "/"))) "invalid-model-file")
    (let [path (str (fs/path (:model-dir config) file))]
      (host/configured-file! path)
      (policy/require! (= sha256 (host/sha256 path)) "model-digest-mismatch"))))

(defn -main [path]
  (let [config (edn/read-string (slurp path))
        _ (host/configured-file! (:executable config))
        _ (policy/require! (= (:executable-sha256 config) (host/sha256 (:executable config))) "engine-digest-mismatch")
        dir (fs/parent path)]
    (with-open [channel (FileChannel/open (fs/path dir "kapitsa.lock")
                         (into-array StandardOpenOption [StandardOpenOption/CREATE StandardOpenOption/WRITE]))]
      (let [lock (.tryLock channel)]
        (policy/require! lock "worker-already-running")
        (try
          (let [token (token! (:token-file config))
                request (serve-config config token)
                _ (verified-model! config)
                ;; stdin carries the API key; only the fixed --config - is visible in ps.
                p (host/process! [(:executable config) "serve" "--config" "-"])]
            (.addShutdownHook (Runtime/getRuntime) (Thread. #(.destroy p)))
            (future (with-open [in (.getInputStream p)] (clojure.java.io/copy in *out*) (flush)))
            (future (with-open [in (.getErrorStream p)] (clojure.java.io/copy in *err*) (flush)))
            (with-open [out (.getOutputStream p)]
              (.write out (.getBytes (json/generate-string request) "UTF-8")))
            (let [exit (.waitFor p)]
              (policy/require! (zero? exit) "kapitsa-exited")))
          ;; The enclosing channel owns and releases the file lock.
          (finally nil))))))
