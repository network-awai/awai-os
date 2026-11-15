(ns awai.fs.b2
  "Backblaze B2 wire adapter for the awai.fs remote backend contract.

  Pure request builders (auth headers, endpoint URLs, upload/download/
  list/delete shapes) plus `b2-backend`, which implements the
  awai.fs.remote backend fn-map over an injected `http` map:

    :request [{:method :url :headers :body}] -> {:status :headers :body}

  Bodies are byte-vecs on the way out and whatever the http fn returns
  on the way in (JSON strings for B2 API calls, byte-vecs for object
  downloads). Auth, endpoint selection, retry, and byte verification
  stay here; the executor in awai.fs.remote owns idempotency.

  B2 mapping: packs/manifests are B2 objects under the same keys the
  tier planner emits (packs/pack-N.car, manifests/<snap>.json). Small
  objects go through b2_upload_file; larger ones use b2_start_large_file
  / b2_upload_part per the backend's :max-part. Reads are download-by-name
  with an HTTP Range; deletes resolve fileId via list then call
  b2_delete_file_version.

  No credentials in this file. `b2-backend` takes {:key-id :app-key
  :bucket-id :bucket-name} plus the injected http fns; awaivol reads
  those from AWAI_B2_* env vars. An optional third arg {:prefix p}
  namespaces every key under \"p/\" so volumes sharing one bucket
  cannot overwrite each other; \"\" (default) keeps the flat layout.
  Prefix math lives in awai.fs.remote (the contract owner)."
  (:require [clojure.string :as str]
            [awai.fs.remote :as rm]))

;; Request shapes carry :response :json (B2 API calls, parsed by the http
;; layer) or :bytes (object downloads, byte-vecs).

(def ^:const authorize-url
  "B2 account authorization endpoint (fixed host, Basic auth).
  v4: v2 answers this account's keys with 400 (observed 2026-11-09;
  rclone authorizes on v4 and succeeds with the same key)."
  "https://api.backblazeb2.com/b2api/v4/b2_authorize_account")

(def ^:const default-max-part
  "Single-shot upload ceiling before multipart kicks in. B2 allows up
  to 5GB per b2_upload_file; 100MB keeps retries cheap and matches
  the recommended part size band."
  (* 100 1024 1024))

(defn- fail!
  [type message data]
  (throw (ex-info message (assoc data :type type))))

(defn basic-token
  "Base64(keyId:appKey) for the authorize call."
  [key-id app-key]
  #?(:clj (let [enc (java.util.Base64/getEncoder)]
            (.encodeToString enc (.getBytes (str key-id ":" app-key) "UTF-8")))
     :cljs (let [b (js/Buffer.from (str key-id ":" app-key) "utf8")]
              (.toString b "base64"))))

(defn authorize-request
  "GET request shape for b2_authorize_account."
  [key-id app-key]
  (when (or (not (string? key-id)) (empty? key-id)
            (not (string? app-key)) (empty? app-key))
    (fail! :awai.fs/invalid-b2-auth "awai fs: B2 key id and app key required" {}))
  {:method :get
   :url authorize-url
   :headers {"Authorization" (str "Basic " (basic-token key-id app-key))}
   :body nil})

(defn- encode-segment
  [segment]
  (let [raw #?(:clj (java.net.URLEncoder/encode ^String segment "UTF-8")
               :cljs (js/encodeURIComponent segment))]
    ;; URLEncoder emits + for space; B2 wants %20. encodeURIComponent
    ;; leaves !'()* unescaped — escape those too.
    (-> raw
        (str/replace "+" "%20")
        (str/replace "!" "%21")
        (str/replace "'" "%27")
        (str/replace "(" "%28")
        (str/replace ")" "%29")
        (str/replace "*" "%2A"))))

(defn encode-file-name
  "URL-encode a B2 file name segment-wise: `/` separators survive so
  pack keys (packs/pack-0.car) keep listing under their prefix."
  [file-name]
  (str/join "/" (map encode-segment (str/split file-name #"/" -1))))

(defn api-request
  "POST request shape for an authed B2 API call."
  [api-url auth-token method-name body]
  {:method :post
   :url (str api-url "/b2api/v2/" method-name)
   :headers {"Authorization" auth-token
             "Content-Type" "application/json"}
   :body body
   :response :json})

(defn upload-file-request
  "POST shape for b2_upload_file. sha1-hex is the hex SHA-1 of the bytes
  (or \"do_not_verify\" when the caller hashes per part only)."
  [upload-url upload-token file-name content-length sha1-hex content-type]
  {:method :post
   :url upload-url
   :headers {"Authorization" upload-token
             "X-Bz-File-Name" (encode-file-name file-name)
             "Content-Type" (or content-type "b2/x-auto")
             "Content-Length" (str content-length)
             "X-Bz-Content-Sha1" sha1-hex}
   :body :bytes
   :response :json})

(defn download-request
  "GET shape for download-by-name, with an optional inclusive Range."
  ([download-url download-token bucket file-name]
   (download-request download-url download-token bucket file-name nil nil))
  ([download-url download-token bucket file-name offset length]
   {:method :get
    :url (str download-url "/file/" bucket "/" (encode-file-name file-name))
    :headers (cond-> {"Authorization" download-token}
               (and (some? offset) (some? length))
               (assoc "Range" (str "bytes=" offset "-" (+ offset length -1))))
    :body nil
    :response :bytes}))

(defn list-request
  "POST shape for b2_list_file_names under prefix."
  [api-url auth-token bucket-id prefix max-count start-file-name]
  (api-request api-url auth-token "b2_list_file_names"
               (cond-> {"bucketId" bucket-id
                        "maxFileCount" (or max-count 1000)}
                 (some? prefix) (assoc "prefix" prefix)
                 (some? start-file-name) (assoc "startFileName" start-file-name))))

(defn delete-request
  "POST shape for b2_delete_file_version."
  [api-url auth-token file-id file-name]
  (api-request api-url auth-token "b2_delete_file_version"
               {"fileId" file-id "fileName" file-name}))

(defn start-large-file-request
  [api-url auth-token bucket-id file-name content-type]
  (api-request api-url auth-token "b2_start_large_file"
               {"bucketId" bucket-id
                "fileName" file-name
                "contentType" (or content-type "b2/x-auto")}))

(defn get-upload-part-url-request
  [api-url auth-token file-id]
  (api-request api-url auth-token "b2_get_upload_part_url"
               {"fileId" file-id}))

(defn upload-part-request
  "POST shape for one b2_upload_part."
  [part-upload-url part-token part-number content-length sha1-hex]
  {:method :post
   :url part-upload-url
   :headers {"Authorization" part-token
             "X-Bz-Part-Number" (str part-number)
             "Content-Length" (str content-length)
             "X-Bz-Content-Sha1" sha1-hex}
   :body :bytes
   :response :json})

(defn finish-large-file-request
  [api-url auth-token file-id part-sha1s]
  (api-request api-url auth-token "b2_finish_large_file"
               {"fileId" file-id "partSha1Array" part-sha1s}))

(defn- byte-count
  "Length of an upload value (byte-vec or, on :cljs, Node Buffer)."
  [v]
  #?(:clj (count v)
     :cljs (if (js/Buffer.isBuffer v) (.-length v) (count v))))

(defn sha1-hex
  "Hex SHA-1 of a byte-vec (B2's per-file/part checksum). On :cljs a
  Node Buffer passes straight to the hasher with no conversion."
  [value]
  #?(:clj (let [md (java.security.MessageDigest/getInstance "SHA-1")]
            (.update md ^bytes (byte-array (map unchecked-byte value)))
            (apply str (map #(format "%02x" (bit-and % 0xff))
                            (.digest md))))
     :cljs (let [h (.createHash (js/require "crypto") "sha1")]
              (.update h (if (js/Buffer.isBuffer value)
                           value
                           (js/Buffer.from (clj->js value))))
              (.digest h "hex"))))

(defn- api!
  "Run one authed B2 API call through (:post http). The http layer
  returns API bodies already parsed to keyword-keyed maps (JSON.parse
  on node, a JSON lib on the JVM); download bodies stay byte-vecs."
  [http api-url token method-name body]
  (let [res ((:post http) (api-request api-url token method-name body))]
    (when (not= 200 (:status res))
      (fail! :awai.fs/b2-api "awai fs: B2 API call failed"
             {:method method-name :status (:status res)}))
    (:body res)))

(defn b2-backend
  "Build the awai.fs.remote backend map over B2.

  `auth` is {:key-id :app-key :bucket-id :bucket-name}.
  `http` is {:get :post} with (:post http) and (:get http) taking a
  request shape (with :response :json or :bytes) and returning
  {:status :headers :body}: API-call bodies
  are keyword-keyed maps (the http layer parses JSON), download bodies
  are byte-vecs. Upload bytes ride on the request's :bytes-value key —
  the value execute-uploads attaches from the action (on :cljs a Node
  Buffer is accepted as-is, with no vec round-trip)."
  ([http auth] (b2-backend http auth {}))
  ([http auth opts]
  (doseq [k [:key-id :app-key :bucket-id :bucket-name]]
    (when (or (not (string? (get auth k))) (empty? (get auth k)))
      (fail! :awai.fs/invalid-b2-auth "awai fs: B2 auth field missing"
             {:field k})))
  (let [prefix (rm/normalize-prefix (:prefix opts))
        qk (fn [object-key] (rm/qualify-key prefix object-key))
        unqk (fn [storage-key] (rm/strip-prefix prefix storage-key))
        session (atom nil)
        large (atom {})
        ensure-session (fn []
                         (or @session
                             (let [res ((:get http)
                                        (authorize-request (:key-id auth)
                                                           (:app-key auth)))]
                               (when (not= 200 (:status res))
                                 (fail! :awai.fs/b2-auth
                                        "awai fs: B2 authorize failed"
                                        {:status (:status res)}))
                               (let [s (:body res)
                                     api (or (:storageApi (:apiInfo s)) s)]
                                 (reset! session
                                         {:api-url (:apiUrl api)
                                          :download-url (:downloadUrl api)
                                          :token (:authorizationToken s)
                                          :bucket-id (:bucketId s)})
                                 @session))))]
    {:kind :b2
     :identity (str "b2:" (:bucket-id auth) "/" prefix)
     :max-part default-max-part
     :put-object (fn [object-key value]
                   (let [{:keys [api-url token bucket-id]} (ensure-session)
                         total (byte-count value)
                         skey (qk object-key)
                         up (api! http api-url token "b2_get_upload_url"
                                  {"bucketId" (or (:bucket-id auth) bucket-id)})]
                     (if (<= total default-max-part)
                       (let [req (upload-file-request
                                  (:uploadUrl up) (:authorizationToken up)
                                  skey total (sha1-hex value) nil)
                             res ((:post http) (assoc req :bytes-value value))]
                         (when (not= 200 (:status res))
                           (fail! :awai.fs/b2-upload "awai fs: B2 upload failed"
                                  {:object skey :status (:status res)}))
                         {:etag (str "b2-" skey) :bytes total})
                       (fail! :awai.fs/no-multipart
                              "awai fs: use :put-part for large B2 objects"
                              {:object skey :bytes total}))))
     :put-part (fn [object-key n bytes]
                 ;; B2 part upload URLs are single-use: start the large file
                 ;; once per object (tracked in `large`), fetch a fresh part
                 ;; URL per part, upload, and record the part sha1 for finish.
                 (let [{:keys [api-url token]} (ensure-session)
                       skey (qk object-key)
                       lf (or (get @large skey)
                              (let [started (api! http api-url token
                                                  "b2_start_large_file"
                                                  {"bucketId" (:bucket-id auth)
                                                   "fileName" skey
                                                   "contentType" "b2/x-auto"})]
                                (get (swap! large assoc skey
                                            {:file-id (:fileId started)
                                             :parts (sorted-map)})
                                     skey)))
                       pu (api! http api-url token "b2_get_upload_part_url"
                                {"fileId" (:file-id lf)})
                       sha (sha1-hex bytes)
                       req (upload-part-request (:uploadUrl pu)
                                                (:authorizationToken pu)
                                                (inc n) (byte-count bytes) sha)
                       res ((:post http) (assoc req :bytes-value bytes))]
                   (when (not= 200 (:status res))
                     (fail! :awai.fs/b2-upload "awai fs: B2 part upload failed"
                            {:object skey :part (inc n)
                             :status (:status res)}))
                   (swap! large assoc-in [skey :parts (inc n)] sha)
                   {:etag (str "b2-part-" (inc n)) :bytes (byte-count bytes)}))
     :complete-multipart (fn [object-key nparts]
                           (let [{:keys [api-url token]} (ensure-session)
                                 lf (get @large (qk object-key))]
                             (when (nil? lf)
                               (fail! :awai.fs/no-multipart
                                      "awai fs: no started B2 large file"
                                      {:object object-key}))
                             (let [shas (mapv #(get (:parts lf) %)
                                              (range 1 (inc nparts)))
                                   res ((:post http)
                                        (assoc (finish-large-file-request
                                                api-url token
                                                (:file-id lf) shas)
                                               :bytes-value nil))]
                               (when (not= 200 (:status res))
                                 (fail! :awai.fs/b2-upload
                                        "awai fs: B2 finish large file failed"
                                        {:object object-key
                                         :status (:status res)}))
                               (swap! large dissoc (qk object-key))
                               (let [done (:body res)]
                                 {:etag (str "b2-large-" (qk object-key))
                                  :bytes (or (:contentLength done) 0)
                                  :parts nparts}))))
     :get-object (fn [object-key]
                   (let [{:keys [download-url token]} (ensure-session)
                         res ((:get http)
                              (download-request download-url token
                                                (:bucket-name auth) (qk object-key)))]
                     (case (:status res)
                       200 (:body res)
                       404 nil
                       (fail! :awai.fs/b2-download "B2 download failed; absence is unverified" {:status (:status res)}))))
     :get-range (fn [object-key offset length]
                  (let [{:keys [download-url token]} (ensure-session)
                        res ((:get http)
                             (download-request download-url token
                                               (:bucket-name auth)
                                               (qk object-key) offset length))]
                    (cond
                      (= 404 (:status res)) nil
                      (and (or (= 206 (:status res)) (and (= 200 (:status res)) (zero? offset)))
                           (= length (byte-count (:body res)))) (:body res)
                      :else (fail! :awai.fs/b2-download "B2 range status or byte count differs" {:status (:status res)}))))
     :delete-object (fn [object-key]
                      (let [{:keys [api-url token]} (ensure-session)
                            skey (qk object-key)
                            listed (api! http api-url token "b2_list_file_names"
                                         {"bucketId" (:bucket-id auth)
                                          "prefix" skey
                                          "maxFileCount" 1000})
                            match (first (filter #(= (:fileName %) skey)
                                                (:files listed)))]
                        (if (nil? match)
                          true
                          (do (api! http api-url token "b2_delete_file_version"
                                    {"fileId" (:fileId match)
                                     "fileName" (:fileName match)})
                              true))))
     :list-objects (fn [requested-prefix]
                     (let [{:keys [api-url token]} (ensure-session)]
                       (loop [start nil acc [] seen #{} pages 0]
                         (do (when (>= pages 64) (fail! :awai.fs/b2-list-limit "B2 listing page bound exceeded" {}))
                         (let [listed (api! http api-url token
                                            "b2_list_file_names"
                                            (cond-> {"bucketId" (:bucket-id auth)
                                                     "maxFileCount" 1000}
                                              true (assoc "prefix" (if (empty? (or requested-prefix ""))
                                                                      prefix (qk requested-prefix)))
                                              (some? start) (assoc "startFileName" start)))
                               names (into []
                                           (keep unqk)
                                           (mapv :fileName (:files listed)))]
                           (if-let [nxt (:nextFileName listed)]
                             (do (when (contains? seen nxt) (fail! :awai.fs/b2-list-limit "B2 listing cursor repeated" {}))
                                 (recur nxt (into acc names) (conj seen nxt) (inc pages)))
                             (into acc names)))))))
     :head-object (fn [object-key]
                    (let [{:keys [api-url token]} (ensure-session)
                          skey (qk object-key)
                          listed (api! http api-url token "b2_list_file_names"
                                       {"bucketId" (:bucket-id auth)
                                        "prefix" skey
                                        "maxFileCount" 1000})
                          match (first (filter #(= (:fileName %) skey)
                                              (:files listed)))]
                      (when match {:bytes (:contentLength match)})))})))
