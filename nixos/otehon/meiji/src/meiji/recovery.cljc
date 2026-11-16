(ns meiji.recovery
  "Otehon recovery envelopes. Only ciphertext goes to AwaiVol; the wrapping
   key stays in macOS Keychain. No replacement of existing credentials."
  (:require [babashka.fs :as fs] [cheshire.core :as json]
            [clojure.java.shell :as sh] [clojure.string :as str]
            [meiji.policy :as policy])
  (:import [java.security SecureRandom] [java.util Base64]
           [javax.crypto Cipher] [javax.crypto.spec SecretKeySpec GCMParameterSpec]))

(defn random-bytes [size]
  (let [value (byte-array size)] (.nextBytes (SecureRandom.) value) value))
(defn b64 [value] (.encodeToString (Base64/getEncoder) value))
(defn unb64 [value] (.decode (Base64/getDecoder) ^String value))
(defn hex [value] (apply str (map #(format "%02x" (bit-and 255 %)) value)))
(defn unhex [value]
  (policy/require! (boolean (re-matches #"[a-f0-9]{64}" value)) "recovery-key-invalid")
  (byte-array (map #(unchecked-byte (Integer/parseInt (apply str %) 16)) (partition 2 value))))

(defn seal [key binding plaintext]
  (policy/require! (= 32 (count key)) "recovery-key-invalid")
  (policy/require! (and (string? binding) (<= 1 (count binding) 300)
                        (<= (count plaintext) (* 16 1024 1024))) "recovery-payload-invalid")
  (let [nonce (random-bytes 12) cipher (Cipher/getInstance "AES/GCM/NoPadding")]
    (.init cipher Cipher/ENCRYPT_MODE (SecretKeySpec. key "AES") (GCMParameterSpec. 128 nonce))
    (.updateAAD cipher (.getBytes binding "UTF-8"))
    {:schema "meiji.recovery-envelope.v1" :algorithm "AES-256-GCM"
     :binding binding :nonce (b64 nonce) :ciphertext (b64 (.doFinal cipher plaintext))}))

(defn open-envelope [key binding envelope]
  (policy/require! (and (= "meiji.recovery-envelope.v1" (:schema envelope))
                        (= "AES-256-GCM" (:algorithm envelope)) (= binding (:binding envelope))
                        (= 32 (count key))) "recovery-binding-invalid")
  (let [nonce (unb64 (:nonce envelope)) ciphertext (unb64 (:ciphertext envelope))
        _ (policy/require! (and (= 12 (count nonce)) (<= 16 (count ciphertext) (+ 16 (* 16 1024 1024))))
                           "recovery-envelope-invalid")
        cipher (Cipher/getInstance "AES/GCM/NoPadding")]
    (.init cipher Cipher/DECRYPT_MODE (SecretKeySpec. key "AES") (GCMParameterSpec. 128 nonce))
    (.updateAAD cipher (.getBytes binding "UTF-8"))
    (.doFinal cipher ciphertext)))

(defn keychain-key! [account]
  (policy/require! (= "Mac OS X" (System/getProperty "os.name")) "recovery-custody-unavailable")
  (policy/require! (boolean (re-matches #"[a-zA-Z0-9_-]{8,80}" account)) "recovery-account-invalid")
  (let [service "network.awai.meiji.recovery.v1"
        read-key (fn [] (sh/sh "/usr/bin/security" "find-generic-password" "-a" account "-s" service "-w"))
        previous (read-key)]
    (cond
      (zero? (:exit previous)) (unhex (str/trim (:out previous)))
      (= 44 (:exit previous))
      (let [key (random-bytes 32)
            write (sh/sh "/usr/bin/security" "-i" :in
                         (str "add-generic-password -a " account " -s " service " -w " (hex key) "\n"))
            _ (policy/require! (zero? (:exit write)) "recovery-custody-write-unconfirmed")
            check (read-key)]
        (policy/require! (and (zero? (:exit check)) (= (hex key) (str/trim (:out check))))
                         "recovery-custody-readback-unconfirmed")
        key)
      :else (policy/fail "recovery-custody-read-unconfirmed"))))

(defn private-dir! [directory]
  (policy/require! (and (fs/absolute? directory) (not (fs/sym-link? directory))) "recovery-directory-invalid")
  (when-not (fs/exists? directory) (fs/create-dirs directory))
  (fs/set-posix-file-permissions directory "rwx------") directory)

(defn private-write! [path text]
  (policy/require! (not (fs/exists? path)) "preserve-existing-recovery-file")
  (fs/create-file path)
  (fs/set-posix-file-permissions path "rw-------")
  (spit (str path) text)
  path)

(defn snapshot-files [directory names]
  (into {} (map (fn [name]
                 (policy/require! (boolean (re-matches #"[A-Za-z0-9_.-]+" name)) "recovery-name-invalid")
                 (let [path (fs/path directory name)]
                   (policy/require! (and (fs/regular-file? path) (not (fs/sym-link? path))
                                         (<= (fs/size path) (* 8 1024 1024))) "recovery-file-invalid")
                   [name (b64 (java.nio.file.Files/readAllBytes path))])) names)))
