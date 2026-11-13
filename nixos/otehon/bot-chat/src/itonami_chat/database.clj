(ns itonami-chat.database
 (:require [cheshire.core :as json] [clojure.java.io :as io]
           [kotobase-peer.core :as k] [ipld.core :as ipld]
           [otehon.pack-store :as pack] [otehon.storage :as store])
 (:import [java.nio.file Files Paths OpenOption StandardOpenOption]
          [java.nio.file.attribute PosixFilePermissions]
          [java.security SecureRandom MessageDigest]
          [javax.crypto Cipher Mac] [javax.crypto.spec SecretKeySpec GCMParameterSpec]))
(defn attrs [mode] (into-array java.nio.file.attribute.FileAttribute [(PosixFilePermissions/asFileAttribute (PosixFilePermissions/fromString mode))]))
(defn private-dir! [p] (Files/createDirectories (Paths/get p (make-array String 0)) (attrs "rwx------")))
(defn sha [s] (apply str (map #(format "%02x" (bit-and 255 %)) (.digest (MessageDigest/getInstance "SHA-256") (.getBytes s "UTF-8")))))
(defn db-key! [root]
 (let [p (Paths/get (str root "/master.key") (make-array String 0))]
  (when-not (Files/exists p (make-array java.nio.file.LinkOption 0))
   (when (seq (file-seq (io/file (str root "/threads"))))
    (when (.exists (io/file (str root "/threads"))) (throw (ex-info "existing database key missing; restore required" {}))))
   (let [key (byte-array 32)] (.nextBytes (SecureRandom.) key)
    (with-open [out (java.nio.channels.FileChannel/open p #{StandardOpenOption/CREATE_NEW StandardOpenOption/WRITE} (attrs "rw-------"))]
      (.write out (java.nio.ByteBuffer/wrap key)) (.force out true))
    (with-open [dir (java.nio.channels.FileChannel/open (Paths/get root (make-array String 0)) (into-array OpenOption [StandardOpenOption/READ]))] (.force dir true))))
  (with-open [dir (java.nio.channels.FileChannel/open (Paths/get root (make-array String 0)) (into-array OpenOption [StandardOpenOption/READ]))] (.force dir true))
  (let [b (Files/readAllBytes p)] (when-not (= 32 (alength b)) (throw (ex-info "invalid database key" {}))) b)))
(defn crypto [key scope]
 (let [secret (SecretKeySpec. key "AES") aad (.getBytes (str "itonami-chat/kotobase-otehon/v1/" scope) "UTF-8")
       crypt (fn [mode nonce bytes] (let [c (Cipher/getInstance "AES/GCM/NoPadding")] (.init c mode secret (GCMParameterSpec. 128 nonce)) (.updateAAD c aad) (.doFinal c bytes)))]
  {:seal (fn [bytes] (let [n (byte-array 12)] (.nextBytes (SecureRandom.) n) (ipld/encode {"v" 1 "n" n "c" (crypt Cipher/ENCRYPT_MODE n bytes)})))
   :open (fn [bytes] (let [e (ipld/decode bytes)] (when-not (= 1 (get e "v")) (throw (ex-info "unsupported private database envelope" {}))) (crypt Cipher/DECRYPT_MODE (byte-array (get e "n")) (byte-array (get e "c")))))
   :blind (fn [s] (let [m (Mac/getInstance "HmacSHA256")] (.init m (SecretKeySpec. key "HmacSHA256")) (apply str (map #(format "%02x" (bit-and 255 %)) (.doFinal m (.getBytes s "UTF-8"))))))}))
(defn operation! [root {:keys [op thread events]}]
 (when-not (and (string? root) (.isAbsolute (io/file root)) (string? thread) (re-matches #"[a-f0-9]{64}" thread) (contains? #{"history" "append"} op)) (throw (ex-info "invalid database operation" {})))
 (private-dir! root)
 (let [key (db-key! root) parent (str root "/threads") _ (private-dir! parent) directory (str parent "/" thread)
       _ (when-not (.exists (io/file directory)) (store/init! directory))
       recovered (store/read-store directory) head (get (:state recovered) "itonami.chat/kotobase-head")
       handle (pack/recover directory) staged (atom {})
       get-block (fn [cid] (or (get @staged cid) (pack/read-data handle (str "kotobase/" cid))))
       put-block (fn [cid bytes] (when-not (= cid (ipld/cid bytes)) (throw (ex-info "Kotobase block CID mismatch" {}))) (pack/put-data! directory (str "kotobase/" cid) bytes) (swap! staged assoc cid bytes) cid)
       {:keys [seal open blind]} (crypto key thread)
       database (k/hydrate-chain get-block head blind open)
       existing (into {} (map (fn [q] [(:s q) (json/parse-string (:o q) true)]) (k/q database [nil "chat/event" nil] (constantly true))))
       _ (when (or (> (count existing) 10000) (> (count events) 4)) (throw (ex-info "bounded conversation store limit" {})))
       _ (doseq [e events] (when-not (and (string? (:id e)) (<= 1 (count (:id e)) 100) (string? (:text e)) (<= (count (:text e)) 32768) (contains? #{"user" "assistant"} (:role e))) (throw (ex-info "invalid conversation event" {}))))
       _ (doseq [e events :let [prior (get existing (:id e))] :when (and prior (not= prior e))] (throw (ex-info "message ID conflict; no overwrite" {})))
       added (vec (remove #(contains? existing (:id %)) events))
       commit (if (seq added) (k/commit! put-block get-block (mapv (fn [e] [(:id e) "chat/event" (json/generate-string e)]) added) head seal blind) head)]
  (when (seq added)
   (store/transact! directory :put {:key "itonami.chat/kotobase-head" :value commit}
    (fn [_ current] (when-not (= head (get current "itonami.chat/kotobase-head")) (throw (ex-info "database basis changed" {})))))
   ;; Recover independently after publication; never acknowledge only a memory update.
   (let [fresh (pack/recover directory) h (get (:state (store/read-store directory)) "itonami.chat/kotobase-head")
         db (k/hydrate-chain #(pack/read-data fresh (str "kotobase/" %)) h blind open)]
    (when-not (every? #(seq (k/q db [(:id %) "chat/event" (json/generate-string %)] (constantly true))) added) (throw (ex-info "conversation readback unconfirmed" {})))))
  {:messages (vec (sort-by (juxt :at :id) (vals (merge existing (into {} (map (juxt :id identity) added))))))
   :store {:owner "itonami-agent" :engine "kotobase-peer" :backend "awai-fs-otehon-pack" :headCid commit :readback true}}))
(defn -main [& [root]]
 (try (println (json/generate-string (operation! root (json/parse-string (slurp *in*) true))))
  (catch Exception e (binding [*out* *err*] (println (.getMessage e))) (System/exit 1))))
