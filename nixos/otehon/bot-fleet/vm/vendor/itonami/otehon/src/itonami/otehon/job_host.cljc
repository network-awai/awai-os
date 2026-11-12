(ns itonami.otehon.job-host
  "Bounded original-job host. No shell/model tool execution or inferred grants."
  (:require [clojure.edn :as edn] [clojure.string :as str] [cheshire.core :as json]
            [itonami.otehon.job-contract :as contract] [itonami.otehon.occurrence :as o]
            [itonami.otehon.recurring-host :as durable] [itonami.otehon.io :as hio])
  (:import [java.net URI HttpURLConnection]
           [java.nio.file Files Paths StandardOpenOption]
           [java.nio.file.attribute PosixFilePermissions]
           [java.security SecureRandom]
           [javax.crypto Cipher] [javax.crypto.spec SecretKeySpec GCMParameterSpec]))
(defn get-public!
  "Only the exact public operations in a root-enrolled grant. Redirects and
  caller-controlled queries/headers are unavailable. HTTP errors are evidence."
  [grant operation]
  (when-not (contract/permitted? grant operation) (throw (ex-info "operation not granted" {})))
  (let [^HttpURLConnection c (.openConnection (.toURL (URI. (str (:origin operation) (:path operation)))))
        started (str (java.time.Instant/now))]
    (.setInstanceFollowRedirects c false) (.setRequestMethod c "GET")
    (.setConnectTimeout c 5000) (.setReadTimeout c 15000)
    (try
      (let [status (.getResponseCode c)
            stream (if (< status 400) (.getInputStream c) (.getErrorStream c))
            bytes (when stream (with-open [in stream] (.readNBytes in 262145)))
            text (when bytes (String. bytes "UTF-8"))]
        (when (and bytes (> (alength bytes) 262144)) (throw (ex-info "public response limit" {})))
        {:operation operation :observed-at started :http-status status
         :body-sha (when text (hio/sha256-utf8 text))
         :json (when text
                 (try
                   (let [v (json/parse-string text true)]
                     (cond
                       (= "awai-fleet-observations" (:service operation))
                       (let [payload (:payloadText v)
                             _ (when-not (and (= "awai.fleet-summary-artifact.v1" (:schema v)) (string? payload)
                                              (= (:sha256 v) (hio/sha256-utf8 payload)))
                                 (throw (ex-info "fleet summary digest mismatch" {})))
                             summary (json/parse-string payload true)
                             at (.toEpochMilli (java.time.Instant/parse (:observedAt summary)))
                             age (- (System/currentTimeMillis) at)]
                         (assoc (select-keys summary [:schema :observedAt :totals]) :fresh (<= 0 age 180000)))
                       (str/ends-with? (:path operation) "/metrics")
                       {:tenants (select-keys (:tenants v) [:registryEntries :selfRegisteredOwners :externalTotal])}
                       :else
                       (let [items (or (:bots v) (:entries v) (when (vector? v) v))]
                         (when (vector? items)
                           {:bots (mapv #(if (string? %) {:id %} (select-keys % [:id])) (take 10000 items))}))))
                   (catch Exception _ nil)))
         :outcome (if (<= 200 status 299) "response-observed" "http-error-observed")})
      (catch Exception _ {:operation operation :observed-at started :http-status nil :outcome "transport-unavailable"})
      (finally (.disconnect c)))))
(defn load-storage-key! [path]
  (when-not (.exists (java.io.File. path))
    (let [bytes (byte-array 32)]
      (.nextBytes (SecureRandom.) bytes)
      (Files/createFile (Paths/get path (make-array String 0))
        (into-array java.nio.file.attribute.FileAttribute
          [(PosixFilePermissions/asFileAttribute (PosixFilePermissions/fromString "rw-------"))]))
      (with-open [f (java.io.FileOutputStream. path)] (.write f bytes) (.force (.getChannel f) true))))
  (let [p (Paths/get path (make-array String 0)) bytes (Files/readAllBytes p)]
    (when-not (and (not (Files/isSymbolicLink p)) (= 32 (alength bytes))
                   (= #{java.nio.file.attribute.PosixFilePermission/OWNER_READ java.nio.file.attribute.PosixFilePermission/OWNER_WRITE}
                      (set (Files/getPosixFilePermissions p (make-array java.nio.file.LinkOption 0)))))
      (throw (ex-info "private local storage key required" {}))) bytes))
(defn seal [key request plaintext]
  (let [nonce (byte-array 12) _ (.nextBytes (SecureRandom.) nonce)
        aad (o/digest request) cipher (Cipher/getInstance "AES/GCM/NoPadding")
        b64 #(.encodeToString (java.util.Base64/getEncoder) %)]
    (.init cipher Cipher/ENCRYPT_MODE (SecretKeySpec. key "AES") (GCMParameterSpec. 128 nonce))
    (.updateAAD cipher (.getBytes aad "UTF-8"))
    {:schema "itonami.encrypted-job-result.v1" :algorithm "AES-256-GCM" :aad aad
     :nonce (b64 nonce) :ciphertext (b64 (.doFinal cipher (.getBytes plaintext "UTF-8")))}))
(defn unseal [key request envelope]
  (when-not (and (= "itonami.encrypted-job-result.v1" (:schema envelope)) (= (o/digest request) (:aad envelope)))
    (throw (ex-info "encrypted result binding mismatch" {})))
  (let [decode #(.decode (java.util.Base64/getDecoder) ^String %)
        cipher (Cipher/getInstance "AES/GCM/NoPadding")]
    (.init cipher Cipher/DECRYPT_MODE (SecretKeySpec. key "AES") (GCMParameterSpec. 128 (decode (:nonce envelope))))
    (.updateAAD cipher (.getBytes (:aad envelope) "UTF-8"))
    (String. (.doFinal cipher (decode (:ciphertext envelope))) "UTF-8")))
(defn publish-artifact! [bytes]
  ;; Only this selected Awai service/prefix. The CID makes PUT idempotent;
  ;; a lost acknowledgement is reconciled by exact GET, not another job run.
  (let [cid (itonami.otehon.bundle/cid-raw bytes)
        url (str "http://127.0.0.1:8586/itonami-job-results-AWAI-2795-v1/" cid ".json")
        open (fn [method]
               (doto ^HttpURLConnection (.openConnection (.toURL (URI. url)))
                 (.setRequestMethod method) (.setInstanceFollowRedirects false)
                 (.setConnectTimeout 3000) (.setReadTimeout 30000)))]
    (let [^HttpURLConnection c (open "PUT")]
      (try
        (.setDoOutput c true) (.setRequestProperty c "If-None-Match" "*")
        (.setRequestProperty c "Content-Type" "application/json")
        (with-open [out (.getOutputStream c)] (.write out (.getBytes bytes "UTF-8")))
        (when-not (contains? #{200 201 204 412} (.getResponseCode c)) (throw (ex-info "artifact write unconfirmed" {})))
        (finally (.disconnect c))))
    (let [^HttpURLConnection c (open "GET")]
      (try
        (when-not (= 200 (.getResponseCode c)) (throw (ex-info "artifact readback unavailable" {})))
        (let [actual (with-open [in (.getInputStream c)] (String. (.readNBytes in 1048577) "UTF-8"))]
          (when-not (= actual bytes) (throw (ex-info "artifact readback mismatch" {}))))
        (finally (.disconnect c))))
    {:cid cid :sha256 (hio/sha256-utf8 bytes) :readback true}))
(defn arb-workspace! [job]
 (let [workspace (:workspace job) state (str (System/getProperty "user.home") "/.itonami")
       expected (str state "/profiles/awai-arb/workspace")
       ;; The existing application state directory may itself be an owner-managed
       ;; compatibility link. Resolve that anchor, but reject links below it.
       anchor (.getCanonicalPath (java.io.File. state))
       resolved (str anchor "/profiles/awai-arb/workspace")]
   (when-not (= expected workspace) (throw (ex-info "owned arb workspace required" {})))
   (doseq [suffix ["/profiles" "/profiles/awai-arb" "/profiles/awai-arb/workspace"]]
     (when (Files/isSymbolicLink (Paths/get (str anchor suffix) (make-array String 0)))
       (throw (ex-info "workspace symlinks forbidden" {}))))
   (durable/private-dir! workspace)
   (when-not (= resolved (.getCanonicalPath (java.io.File. workspace)))
     (throw (ex-info "workspace symlinks forbidden" {}))) workspace))
(defn record-public-job!
 ([job request directory]
  (let [grant (:grant job)]
   (record-public-job! job request directory
     {:schema "itonami.public-measurement.v1" :event-id (o/digest request)
      :at (str (java.time.Instant/now)) :data-class "public"
      :observations (mapv #(get-public! grant %) (:operations grant))})))
 ([job request directory measurement]
  (let [grant (:grant job) observations (:observations measurement)
        _ (when-not (and (= (:event-id measurement) (o/digest request))
                         (= (mapv :operation observations) (:operations grant)))
            (throw (ex-info "original measurement/grant required" {})))
        result (case (:job-kind grant)
                 "public-bots-registrar" (contract/public-registry-result observations)
                 "awai-arb" (contract/arb-proposals observations (:slot request))
                 "cron-health" (contract/fleet-health-result observations))]
    (durable/durable! (str directory "/measurement.edn") (pr-str measurement))
    (if (= "cron-health" (:job-kind grant))
      (let [workspace (:workspace job) state (.getCanonicalPath (java.io.File. (str (System/getProperty "user.home") "/.itonami")))
            expected (str (System/getProperty "user.home") "/.itonami/profiles/cron-health/workspace")]
        (when-not (and (= expected workspace)
                       (= (str state "/profiles/cron-health/workspace") (.getCanonicalPath (java.io.File. workspace))))
          (throw (ex-info "owned Itonami health workspace required" {})))
        (durable/private-dir! (str workspace "/measurements"))
        (let [p (str workspace "/measurements/" (:event-id measurement) ".edn") prior (durable/saved p)]
          (when (and prior (not= prior measurement)) (throw (ex-info "health event changed" {})))
          (when-not prior (durable/durable! p (pr-str measurement)))) result)
    (if (= "awai-arb" (:job-kind grant))
      (let [workspace (arb-workspace! job)
            ledger (str workspace "/arb_ledger.jsonl")
            owner-path (str workspace "/arb_ledger.owner.edn")
            owner (durable/saved owner-path)
            _ (when (and (.exists (java.io.File. ledger)) (not= "AWAI-2795-original-arb-v1" (:owner owner)))
                (throw (ex-info "existing ledger needs reconciliation" {})))
            _ (when (and owner (.exists (java.io.File. ledger))
                         (not (contains? (set [(:sha256 owner) (:previous-sha owner)]) (hio/sha256-utf8 (slurp ledger)))))
                (throw (ex-info "ledger changed outside owned writer" {})))
            measurements (str workspace "/measurements")
            _ (durable/private-dir! measurements)
            event-path (str measurements "/" (:event-id measurement) ".edn")
            prior (durable/saved event-path)]
        (when-not prior (durable/durable! event-path (pr-str measurement)))
        ;; The append-only event set is authority; JSONL is a derived projection.
        (let [events (->> (.listFiles (java.io.File. measurements))
                          (filter #(.endsWith (.getName %) ".edn")) (sort-by #(.getName %))
                          (map #(edn/read-string (slurp %))))]
          (when (> (count events) 10000) (throw (ex-info "ledger projection limit" {})))
          (let [text (str (str/join "\n" (map json/generate-string events)) "\n")]
            (durable/durable! owner-path (pr-str {:owner "AWAI-2795-original-arb-v1" :sha256 (hio/sha256-utf8 text)
                                                 :previous-sha (when (.exists (java.io.File. ledger)) (hio/sha256-utf8 (slurp ledger)))}))
            (durable/durable! ledger text)
            (durable/durable! owner-path (pr-str {:owner "AWAI-2795-original-arb-v1" :sha256 (hio/sha256-utf8 text)}))))
        (let [pending (->> (.listFiles (java.io.File. workspace))
                           (filter #(str/starts-with? (.getName %) "pending_proposals_"))
                           (map #(json/parse-string (slurp %) true)))
              seen (set (map :substance-id (mapcat :proposals pending)))
              fresh (filterv #(not (contains? seen (:substance-id %))) (:proposals result))
              draft (assoc result :proposals fresh)]
          (when (seq fresh)
            (durable/durable! (str workspace "/pending_proposals_" (:slot request) ".json") (json/generate-string draft)))
          (assoc result :proposals fresh :already-pending (and (seq (:proposals result)) (empty? fresh)))))
      result)))))
(defn execute! [client job request directory]
  (let [enrollment (:enrollment job) grant (:grant enrollment)]
    (when-not (and (contains? #{"public-bots-registrar" "awai-arb" "cron-health"} (:job-kind grant))
                   (= "bounded-job-v1" (:executor enrollment))
                   (contract/valid-grant? grant)
                   (= (:grant-cid request) (contract/grant-cid grant))
                   (= (o/digest job) (:input-sha request)))
      (throw (ex-info "pinned job/grant binding required" {})))
    (o/dispatch!
      (assoc client :invoke-once
        (fn []
          (durable/private-dir! directory)
          (durable/durable! (str directory "/job.edn") (pr-str job))
          (durable/durable! (str directory "/request.edn") (pr-str request))
          (let [outcome (record-public-job! (assoc job :grant grant) request directory)
                _ (durable/durable! (str directory "/domain-result.edn") (pr-str outcome))
                payload (json/generate-string {:request request :domain-result outcome})
                _ (durable/durable! (str directory "/artifact.json") payload)
                artifact (publish-artifact! payload)
                result {:state "completed" :provider "none" :model "deterministic" :binding request
                        :text (json/generate-string {:domain-result outcome :artifact artifact})}]
            (durable/durable! (str directory "/result.edn") (pr-str result)) result)))
      request (:authenticated-node client) (System/currentTimeMillis))))
(defn recover! [client job request directory]
  (let [claim ((:read client) (:occurrence (o/keys-for (:bot-id request) (:job-id request) (:slot request))))]
    (when-not (and (= request (:request claim)) (= (:authenticated-node client) (:node claim))
                   (= request (durable/saved (str directory "/request.edn")))
                   (= (:input-sha request) (o/digest job)))
      (throw (ex-info "original owner/request/job required" {})))
    (if (= "completed" (:state claim)) {:state "already-completed" :record claim :invoked false}
      (let [saved (or (durable/saved (str directory "/result.edn"))
                     (let [_ (when-not (.exists (java.io.File. (str directory "/artifact.json")))
                               (let [outcome (record-public-job! (assoc job :grant (:grant (:enrollment job))) request directory
                                               (durable/saved (str directory "/measurement.edn")))]
                                 (durable/durable! (str directory "/domain-result.edn") (pr-str outcome))
                                 (durable/durable! (str directory "/artifact.json")
                                   (json/generate-string {:request request :domain-result outcome}))))
                           payload (slurp (str directory "/artifact.json"))
                           content (json/parse-string payload true)
                           _ (when-not (= request (:request content)) (throw (ex-info "artifact request mismatch" {})))
                           artifact (publish-artifact! payload)
                           r {:state "completed" :provider "none" :model "deterministic" :binding request
                              :text (json/generate-string {:domain-result (:domain-result content) :artifact artifact})}]
                       (durable/durable! (str directory "/result.edn") (pr-str r)) r))]
        (when-not (= request (:binding saved)) (throw (ex-info "original result/request required" {})))
        (o/reconcile! client request claim saved)))))
