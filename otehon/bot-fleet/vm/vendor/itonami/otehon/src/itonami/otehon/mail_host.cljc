(ns itonami.otehon.mail-host
 "Read-only Itonami mail protocol connector. No account creation or send path."
 (:require [cheshire.core :as json] [clojure.string :as str] [itonami.otehon.io :as hio])
 (:import [java.nio.file Files Paths] [java.net URI HttpURLConnection]))
(def endpoint "https://relay.itonami.cloud")
(defn account! [path]
 (let [expected (str (System/getProperty "user.home") "/.itonami/profiles/mail-relay/state/relay-account.json")
       anchor (.getCanonicalPath (java.io.File. (str (System/getProperty "user.home") "/.itonami")))
       canonical (str anchor "/profiles/mail-relay/state/relay-account.json")
       p (Paths/get path (make-array String 0))]
  (when-not (= expected path) (throw (ex-info "selected Itonami mail account path required" {})))
  (when-not (Files/exists p (make-array java.nio.file.LinkOption 0))
    (throw (ex-info "mail account unavailable; reconcile owner identity/invite" {})))
  (when-not (and (= canonical (.getCanonicalPath (java.io.File. path)))
                (= #{java.nio.file.attribute.PosixFilePermission/OWNER_READ java.nio.file.attribute.PosixFilePermission/OWNER_WRITE}
                   (set (Files/getPosixFilePermissions p (make-array java.nio.file.LinkOption 0))))
                (<= (Files/size p) 8192))
    (throw (ex-info "private owned mail account required" {})))
  (let [a (json/parse-string (slurp path) true) key (:inbox_key a)]
   (when-not (and (= endpoint (:endpoint a))
                 (string? (:inbox a)) (re-matches #"inbox_[A-Za-z0-9_-]{1,80}" (:inbox a))
                 (string? key) (re-matches #"rk_[A-Za-z0-9_-]{16,128}" key)
                 (= (hio/sha256-utf8 key) (str/replace (str (:inbox_key_digest a)) #"^sha256:" "")))
     (throw (ex-info "mail service/account binding invalid" {}))) a)))
(defn request! [account]
 ;; Must be called with account! output by the operator host; no model tool.
 (let [^HttpURLConnection c (.openConnection (.toURL (URI. (str endpoint "/v1/inboxes/" (:inbox account) "/messages"))))]
  (try
   (.setRequestMethod c "GET") (.setInstanceFollowRedirects c false)
   (.setConnectTimeout c 5000) (.setReadTimeout c 20000)
   (.setRequestProperty c "Authorization" (str "Bearer " (:inbox_key account)))
   (let [status (.getResponseCode c)]
    (if-not (= 200 status) {:http-status status :messages-count nil :received false}
     (let [bytes (with-open [in (.getInputStream c)] (.readNBytes in 1048577))
           _ (when (> (alength bytes) 1048576) (throw (ex-info "mail metadata response limit" {})))
           body (json/parse-string (String. bytes "UTF-8") true)
           messages (:messages body)]
      ;; No sender, address, subject, body or content CID leaves this connector.
      {:http-status status :messages-count (when (vector? messages) (count messages))
       :received (and (true? (:ok body)) (vector? messages))})))
   (finally (.disconnect c)))))
(defn observe! [path]
 (let [account (account! path)]
  (try (assoc (request! account) :schema "itonami.mail-metadata-observation.v1"
                                :service endpoint :data-class "private-mail-count-only" :sent false)
   (catch Exception _ {:schema "itonami.mail-metadata-observation.v1" :service endpoint
                       :state "unknown" :reason "mail-transport-or-response-unconfirmed" :sent false}))))
