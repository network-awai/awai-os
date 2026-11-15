(ns itonami-identity.custody
 (:require [clojure.string :as str] [itonami-identity.mail :as m]
  #?(:clj [clojure.java.io :as io]) #?(:clj [clojure.java.shell :as sh]) #?(:clj [cheshire.core :as j])
  #?(:clj [itonami-chat.database :as db]))
 #?(:clj (:import [java.nio.file Files Paths StandardOpenOption StandardCopyOption OpenOption LinkOption]
                 [java.nio.channels FileChannel] [java.security SecureRandom MessageDigest])))
#?(:clj
 (do
  (defn random-bytes [n] (let [b (byte-array n)] (.nextBytes (SecureRandom.) b) b))
  (defn hex [b] (apply str (map #(format "%02x" (bit-and 255 %)) b)))
  (defn unhex [s] (m/require! (and (string? s) (re-matches #"[a-f0-9]{64}" s)) "identity-key-invalid") (byte-array (map #(unchecked-byte (Integer/parseInt (apply str %) 16)) (partition 2 s))))
  (defn sha-bytes [b] (.digest (MessageDigest/getInstance "SHA-256") b))
  (defn file! [p b replace?]
   (let [file (io/file p) tmp (str p "." (java.util.UUID/randomUUID))]
    (db/private-dir! (.getParent file))
    (with-open [out (FileChannel/open (Paths/get tmp (make-array String 0)) #{StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE} (db/attrs "rw-------"))]
     (.write out (java.nio.ByteBuffer/wrap b)) (.force out true))
    (if replace?
     (Files/move (Paths/get tmp (make-array String 0)) (Paths/get p (make-array String 0)) (into-array java.nio.file.CopyOption [StandardCopyOption/ATOMIC_MOVE StandardCopyOption/REPLACE_EXISTING]))
     (try (Files/createLink (Paths/get p (make-array String 0)) (Paths/get tmp (make-array String 0))) (finally (Files/deleteIfExists (Paths/get tmp (make-array String 0))))))
    (with-open [dir (FileChannel/open (Paths/get (.getParent file) (make-array String 0)) (into-array OpenOption [StandardOpenOption/READ]))] (.force dir true))))
  (defn private-bytes [p]
   (let [v (Paths/get p (make-array String 0))]
    (m/require! (and (not (Files/isSymbolicLink v)) (Files/isRegularFile v (make-array LinkOption 0))
                     (= "rw-------" (java.nio.file.attribute.PosixFilePermissions/toString (Files/getPosixFilePermissions v (make-array LinkOption 0))))) "identity-private-file-required")
    (Files/readAllBytes v)))
  (defn credential [cfg kind value replace?]
   (let [namespace (:identityNamespace cfg) mode (get-in cfg [:identityCustody :type])]
    (m/require! (and (string? namespace) (re-matches #"[a-zA-Z0-9_-]{8,100}" namespace)) "identity-namespace-required")
    (case mode
     "fixture" (let [p (str (get-in cfg [:identityCustody :root]) "/" namespace "-" kind ".key")]
                 (m/require! (true? (:identityFixture cfg)) "fixture-custody-not-enabled")
                 (if value (file! p value replace?) (when (.exists (io/file p)) (private-bytes p))))
     "macos-keychain"
     (let [service (str "network.awai.itonami.identity." namespace "." kind)]
      (m/require! (= "Mac OS X" (System/getProperty "os.name")) "keychain-unavailable")
      (if value
       ;; Hex and namespace have bounded alphabets. Secret bytes only enter private stdin,
       ;; never argv/env/logs. No generic signing API or secret return to the HTTP host.
       (let [r (sh/sh "/usr/bin/security" "-i" :in (str "add-generic-password " (when replace? "-U ") "-a " namespace " -s " service " -w " (hex value) "\n"))]
        (m/require! (zero? (:exit r)) "keychain-write-unconfirmed")
        (m/require! (= (seq value) (seq (credential cfg kind nil false))) "keychain-write-unconfirmed"))
       (let [r (sh/sh "/usr/bin/security" "find-generic-password" "-a" namespace "-s" service "-w")]
        (cond (zero? (:exit r)) (unhex (str/trim (:out r))) (= 44 (:exit r)) nil :else (throw (ex-info "keychain-unavailable" {}))))))
     (throw (ex-info "identity-custody-required" {})))))
  (defn locked [cfg f]
   (let [root (:identityRoot cfg)]
    (m/require! (and (string? root) (.isAbsolute (io/file root)) (not (Files/isSymbolicLink (Paths/get root (make-array String 0))))) "identity-root-required")
    (db/private-dir! root)
    (with-open [channel (FileChannel/open (Paths/get (str root "/custody.lock") (make-array String 0)) #{StandardOpenOption/CREATE StandardOpenOption/WRITE} (db/attrs "rw-------"))]
     (.lock channel) (f))))
  (defn marker [cfg] (let [p (str (:identityRoot cfg) "/namespace.json")] (when (.exists (io/file p)) (j/parse-string (String. (private-bytes p) "UTF-8") true))))
  (defn initialize! [cfg]
   (let [root (:identityRoot cfg) mark (str root "/namespace.json")]
    (when-not (marker cfg)
     (m/require! (and (:identityAutoEnroll cfg) (not (.exists (io/file (str root "/private-db"))))
                      (nil? (credential cfg "primary" nil false)) (nil? (credential cfg "recovery" nil false))) "identity-recovery-required")
     (let [key (random-bytes 32) recovery (random-bytes 32) seed (random-bytes 32)
           pending {:schema "itonami.identity-custody.v1" :namespace (:identityNamespace cfg) :state "enrollment-pending" :keySha256 (hex (sha-bytes key))}]
      (file! mark (.getBytes (j/generate-string pending) "UTF-8") false)
      (try
       (credential cfg "primary" key false) (credential cfg "recovery" recovery false)
       (file! (str root "/fleet.sealed") ((:seal (db/crypto key (str "identity/fleet/" (:identityNamespace cfg)))) seed) false)
       (file! (str root "/recovery.sealed") ((:seal (db/crypto recovery (str "identity/recovery/" (:identityNamespace cfg)))) key) false)
       (file! mark (.getBytes (j/generate-string (assoc pending :state "verified")) "UTF-8") true)
       (finally (java.util.Arrays/fill key (byte 0)) (java.util.Arrays/fill recovery (byte 0)) (java.util.Arrays/fill seed (byte 0))))))))
  (defn unlock! [cfg]
   (let [mark (marker cfg) key (credential cfg "primary" nil false)]
    (m/require! (and (= "verified" (:state mark)) (= (:namespace mark) (:identityNamespace cfg)) key
                     (= (:keySha256 mark) (hex (sha-bytes key)))) "identity-recovery-required")
    (try {:key key :seed ((:open (db/crypto key (str "identity/fleet/" (:identityNamespace cfg)))) (private-bytes (str (:identityRoot cfg) "/fleet.sealed")))}
     (catch Exception _ (java.util.Arrays/fill key (byte 0)) (throw (ex-info "identity-recovery-required" {}))))))
  (defn recover! [cfg]
   (let [mark (marker cfg) recovery (credential cfg "recovery" nil false)]
    (m/require! (and (= "verified" (:state mark)) (= (:namespace mark) (:identityNamespace cfg)) recovery) "identity-recovery-required")
    (try
     (let [key ((:open (db/crypto recovery (str "identity/recovery/" (:identityNamespace cfg)))) (private-bytes (str (:identityRoot cfg) "/recovery.sealed")))]
      (try (m/require! (= (:keySha256 mark) (hex (sha-bytes key))) "identity-recovery-required")
           (credential cfg "primary" key true)
           (finally (java.util.Arrays/fill key (byte 0)))))
     (finally (java.util.Arrays/fill recovery (byte 0))))))
  (defn copy-ciphertext! [source target]
   (let [base (.toPath (io/file source)) files (filter #(.isFile %) (file-seq (io/file source))) total (reduce + (map #(.length %) files))]
    (m/require! (and (.isDirectory (io/file source)) (< total (* 128 1024 1024)) (< (count files) 50000)) "identity-backup-limit")
    (doseq [file files :let [relative (str (.relativize base (.toPath file)))]]
     (m/require! (and (not (Files/isSymbolicLink (.toPath file)))
                      (or (contains? #{"namespace.json" "fleet.sealed" "recovery.sealed"} relative) (str/starts-with? relative "private-db/"))) "identity-backup-scope")
     (file! (str target "/" relative) (Files/readAllBytes (.toPath file)) false))))
  (defn export-recovery! [cfg output]
   ;; Native owner command only; no HTTP route exposes this operation or the secret.
   (m/require! (and (string? output) (.isAbsolute (io/file output)) (not (.exists (io/file output)))) "identity-new-backup-required")
   (let [recovery (credential cfg "recovery" nil false) source (str (:identityRoot cfg) "/export-" (java.util.UUID/randomUUID))]
    (m/require! recovery "identity-recovery-required")
    (try
     (doseq [name ["namespace.json" "fleet.sealed" "recovery.sealed"]] (file! (str source "/" name) (private-bytes (str (:identityRoot cfg) "/" name)) false))
     (let [db (io/file (str (:identityRoot cfg) "/private-db"))]
      (when (.exists db)
       (doseq [file (file-seq db) :when (.isFile file)]
        (m/require! (not (Files/isSymbolicLink (.toPath file))) "identity-backup-scope")
        (file! (str source "/private-db/" (.relativize (.toPath db) (.toPath file))) (Files/readAllBytes (.toPath file)) false))))
     (copy-ciphertext! source (str output "/ciphertext"))
     (file! (str output "/owner-recovery.key") recovery false)
     {:schema "itonami.identity-recovery-export.v1" :bundle (str output "/ciphertext") :ownerKeyFile (str output "/owner-recovery.key") :separateOwnerKey true}
     ;; Preserve generated ciphertext snapshot as recovery evidence; no unique WIP deletion.
     (finally (java.util.Arrays/fill recovery (byte 0))))))
  (defn restore-recovery! [cfg bundle owner-key-file]
   (m/require! (nil? (marker cfg)) "identity-existing-target-refused")
   (let [recovery (private-bytes owner-key-file) namespace (:identityNamespace cfg)
         mark (j/parse-string (String. (private-bytes (str bundle "/namespace.json")) "UTF-8") true)]
    (m/require! (and (= 32 (count recovery)) (= namespace (:namespace mark)) (= "verified" (:state mark))) "identity-recovery-required")
    (try
     ;; Authenticate the primary before publishing any imported state/credential.
     (let [key ((:open (db/crypto recovery (str "identity/recovery/" namespace))) (private-bytes (str bundle "/recovery.sealed")))]
      (try
       (m/require! (= (:keySha256 mark) (hex (sha-bytes key))) "identity-recovery-required")
       ((:open (db/crypto key (str "identity/fleet/" namespace))) (private-bytes (str bundle "/fleet.sealed")))
       (m/require! (and (nil? (credential cfg "primary" nil false)) (nil? (credential cfg "recovery" nil false))) "identity-existing-target-refused")
       (copy-ciphertext! bundle (:identityRoot cfg))
       (credential cfg "recovery" recovery false) (credential cfg "primary" key false)
       (finally (java.util.Arrays/fill key (byte 0)))))
     (finally (java.util.Arrays/fill recovery (byte 0))))))
  (defn with-custody [cfg f] (let [{:keys [key seed]} (unlock! cfg)] (try (f key seed) (finally (java.util.Arrays/fill key (byte 0)) (java.util.Arrays/fill seed (byte 0))))))))
