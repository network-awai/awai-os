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
(def jacob-model-id "qwen3.6-35b-a3b:16gb")
(def jacob-model-revision "a483e9e6cbd595906af30beda3187c2663a1118c")
(def jacob-source-sha256 "2e8f5f705355c56311432d0a8a5d14a696dbb7e4b197d05c75ba805fc1857bef")
(def required-model-files
  #{"config.json" "tokenizer.json" "tokenizer_config.json" "generation_config.json"
    "chat_template.jinja" "model.safetensors.index.json" "mtp.safetensors"
    "model-00001-of-00004.safetensors" "model-00002-of-00004.safetensors"
    "model-00003-of-00004.safetensors" "model-00004-of-00004.safetensors"
    "dflash2/config.json" "dflash2/model.safetensors"})

(defn enabled! [config]
  (policy/require! (true? (:enabled config)) "kapitsa-execution-disabled"))

(defn model! [config]
  (let [id (:model-id config model-id)]
    (policy/require! (contains? #{model-id jacob-model-id} id) "unapproved-model")
    (policy/require! (= (:model-revision config)
                         (if (= id jacob-model-id) jacob-model-revision model-revision)) "model-revision-mismatch")
    (when (= id jacob-model-id)
      (policy/require! (= jacob-source-sha256 (:source-sha256 config)) "model-source-mismatch"))
    id))

(defn serve-config [config token]
  (policy/require! (= {:os :macos :arch :aarch64} (host/host-platform)) "kapitsa-requires-apple-silicon")
  (policy/require! (and (integer? (:port config)) (<= 1024 (:port config) 65535)) "invalid-port")
  (policy/require! (and (integer? (:context config)) (<= 512 (:context config) 32768)) "invalid-context")
  (model! config)
  (policy/require! (and (string? (:model-dir config)) (fs/absolute? (:model-dir config))
                        (fs/directory? (:model-dir config))) "model-not-downloaded")
  (policy/require! (and (string? token) (<= 32 (count token) 256)) "invalid-worker-token")
  {:model (:model-dir config) :model_id (:model-id config model-id) :host "127.0.0.1" :port (:port config)
   :private true :local true :peer [] :allow_switch false :api_key token
   :context (:context config) :slots 1 :profile "precise" :idle_unload "auto" :disk_cache "0"})

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

(defn model-sha256
  "Use the macOS system crypto tool for multi-GB artifacts. The digest decision
   stays here; paths are owner configuration and no shell is involved."
  [path]
  (host/configured-file! (str path))
  (let [p (host/process! ["/usr/bin/openssl" "dgst" "-sha256" "-r" (str path)])
        output (future (slurp (.getInputStream p)))
        error (future (slurp (.getErrorStream p)))]
    (when-not (.waitFor p 180 java.util.concurrent.TimeUnit/SECONDS)
      (.destroyForcibly p) (policy/fail "model-hash-timeout"))
    (policy/require! (zero? (.exitValue p)) "model-hash-failed")
    (let [digest (second (re-find #"^([a-f0-9]{64}) " @output))]
      (policy/require! digest "model-hash-invalid")
      digest)))

(defn verified-model! [config]
  (policy/require! (and (vector? (:files config)) (<= 5 (count (:files config)) 64)) "model-manifest-required")
  (let [files (set (map :file (:files config)))]
    (policy/require! (and (= (count files) (count (:files config)))
                          (every? files (if (= jacob-model-id (model! config))
                                           #{"config.json" "tokenizer.json" "tokenizer_config.json"
                                             "experts.safetensors" ".kapitsa/manifest.json"}
                                           required-model-files))) "model-manifest-incomplete"))
  (doseq [{:keys [file sha256]} (:files config)]
    (policy/require! (and (string? file) (re-matches #"[A-Za-z0-9_./-]+" file)
                         (not (str/includes? file "..")) (not (str/starts-with? file "/"))) "invalid-model-file")
    (let [path (str (fs/path (:model-dir config) file))]
      (host/configured-file! path)
      (policy/require! (= sha256 (model-sha256 path)) "model-digest-mismatch"))))

(defn -main [path]
  (let [config (edn/read-string (slurp path))
        _ (enabled! config)
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
