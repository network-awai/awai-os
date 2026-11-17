(ns awai.drive.encrypted
  (:require [cljs.reader :as edn] [clojure.string :as str]
            [awai.drive.domain :as d] [awai.fs.car :as car]
            [envelope.model :as model] [envelope.seal :as seal]
            [envelope.keystore :as keys]))
;; Owner-store object-v2, raw-frame codec 0. Canonical crypto and CAR are pinned
;; owning sources, not a WNFS/private-tree replacement. Bounded snapshot adapter.
(def limit (* 8 1024 1024))
(def pack-limit (* 12 1024 1024))
(defn refuse [] (throw (js/Error. "encrypted-store-refused")))
(defn u8 [v] (js/Uint8Array.from (clj->js v)))
(defn utf8 [s] (.encode (js/TextEncoder.) s))
(defn text [b] (.decode (js/TextDecoder. "utf-8" #js {:fatal true}) b))
(defn hex [b] (apply str (map #(.padStart (.toString % 16) 2 "0") b)))
(defn unhex [s] (when-not (and (string? s) (re-matches #"[0-9a-f]{64}" s)) (refuse))
  (mapv #(js/parseInt (subs s % (+ % 2)) 16) (range 0 64 2)))
(defn sha [b] (-> (js/crypto.subtle.digest "SHA-256" b) (.then #(hex (js/Uint8Array. %)))))
(defn sequence! [rows f] (reduce (fn [p row] (.then p #(f row))) (js/Promise.resolve nil) rows))
(defn wipe! [identity] (doseq [k [:priv :pq-priv]] (when-let [b (get identity k)] (.fill b 0))))
(defn new-record [secret]
  (-> (keys/generate-identity)
      (.then (fn [id] (-> (keys/seal-record id secret)
                         (.then #(pr-str %)) (.finally #(wipe! id)))))))
(defn object! [objects owner bytes]
  (let [size (.-length bytes)
        frames (mapv (fn [at] (let [part (.slice bytes at (min size (+ at 65531)))
                                    out (js/Uint8Array. (+ 5 (.-length part)))
                                    view (js/DataView. (.-buffer out))]
                                (.setUint32 view 1 (.-length part) false) (.set out part 5) out))
                     (if (zero? size) [0] (range 0 size 65531)))]
    (let [env (model/envelope (str "awai:" (js/crypto.randomUUID)) {:chunks (count frames) :envelope/kem model/hybrid-kem :envelope/chunk-bytes 65536})
          key (seal/generate-content-key)]
      (-> (js/Promise.all (clj->js (map-indexed #(seal/seal-chunk env key %1 %2) frames)))
          (.then (fn [chunks] (-> (seal/wrap-for-hybrid env {:id (:recipient-key owner) :pub (:pub owner) :pq-pub (:pq-pub owner)} key)
                                  (.then (fn [entry] {:envelope (model/put-recipient env entry) :chunks (vec chunks)})))))
          (.finally #(.fill key 0))
        (.then (fn [sealed]
                 (let [ids (atom [])]
                   (-> (sequence! (:chunks sealed) (fn [b] (-> (sha b) (.then (fn [id] (swap! objects assoc id b) (swap! ids conj id))))))
                       (.then (fn [_] (let [b (utf8 (pr-str {:schema :awai.owner/object-v2 :envelope (:envelope sealed) :chunks @ids}))]
                                       (-> (sha b) (.then (fn [id] (swap! objects assoc id b) id))))))))))))))
(defn open-object [objects root identity]
  (let [bytes (get objects root)]
    (when-not (and bytes (<= (.-length bytes) 262144)) (refuse))
    (let [{:keys [schema envelope chunks]} (edn/read-string (text bytes))]
      (when-not (and (= schema :awai.owner/object-v2) (model/valid? envelope) (model/hybrid? envelope)
                     (= 65536 (:envelope/chunk-bytes envelope))
                     (= [(:recipient-key identity)] (model/recipient-ids envelope))
                     (vector? chunks) (<= 1 (count chunks) 129) (= (count chunks) (:envelope/chunks envelope))) (refuse))
      (let [entry (seal/entry-for envelope (:recipient-key identity))]
        (-> (seal/unwrap-with envelope entry (:priv identity) (:pq-priv identity))
            (.then (fn [key]
                     (let [parts (atom []) total (atom 0)]
                       (-> (sequence! (map-indexed vector chunks)
                             (fn [[i id]]
                               (let [b (get objects id)] (when-not (and b (<= 16 (.-length b) 65552)) (refuse))
                                 (-> (seal/open-chunk envelope key i b)
                                     (.then (fn [frame]
                                              (when (< (.-length frame) 5) (refuse))
                                              (let [view (js/DataView. (.-buffer frame) (.-byteOffset frame) (.-byteLength frame))
                                                    n (.getUint32 view 1 false)]
                                                (when-not (and (zero? (aget frame 0)) (= n (- (.-length frame) 5)) (<= n 65531)) (refuse))
                                                (when (> (swap! total + n) limit) (refuse))
                                                (swap! parts conj (.slice frame 5)))))))))
                           (.then (fn [_] (let [out (js/Uint8Array. @total) at (atom 0)]
                                            (doseq [p @parts] (.set out p @at) (swap! at + (.-length p))) out)))
                           (.finally #(.fill key 0)))))))))))
(defn seal-snapshot [record secret rows]
  (let [record (edn/read-string record) objects (atom {}) files (atom [])
        total (reduce + (map #(.-length (aget % "bytes")) (array-seq rows)))]
    (when-not (and (<= total limit) (<= (.-length rows) 1000)) (refuse))
    (-> (keys/open-record record secret)
        (.then (fn [opened]
                 (let [owner (assoc opened :pq-pub (:pq-pub record))]
                   (-> (sequence! (array-seq rows)
                         (fn [r] (let [path (aget r "path") bytes (aget r "bytes")]
                                   (when-not (and (d/valid-path? path) (seq path)) (refuse))
                                   (-> (sha bytes)
                                       (.then (fn [h] (-> (object! objects owner bytes)
                                                         (.then #(swap! files conj {:name path :size (.-length bytes) :sha h :object %})))))))))
                       (.then (fn [_] (object! objects owner
                                              (utf8 (pr-str {:schema :awai.owner/private-manifest-v1 :owner (:recipient-key owner)
                                                             :files @files :source-manifest "{\"schema\":\"awai.drive.snapshot.v1\"}"})))))
                       (.then (fn [root]
                                (let [cid #(car/cid-bytes car/codec-raw (unhex %))
                                      bytes (u8 (car/carv1-encode {:roots [(cid root)]
                                                                  :blocks (mapv (fn [[id b]] {:cid (cid id) :bytes (vec b)}) (sort-by key @objects))}))]
                                  (when (> (.-length bytes) pack-limit) (refuse))
                                  #js {:root root :bytes bytes :files (clj->js @files) :owner (:recipient-key owner)})))
                       (.finally #(wipe! opened)))))))))
(defn open-snapshot [record secret root pack]
  (when (> (.-length pack) pack-limit) (refuse))
  (let [{:keys [roots blocks]} (car/carv1-decode (vec pack)) objects (atom {})
        expected (car/cid-bytes car/codec-raw (unhex root))]
    (when-not (and (= [expected] roots) (<= 1 (count blocks) 1200)) (refuse))
    (-> (sequence! blocks (fn [{:keys [cid bytes]}]
                            (let [data (u8 bytes) parsed (car/parse-cid cid) id (hex (:digest parsed))]
                              (when (or (not= car/codec-raw (:codec parsed)) (contains? @objects id)) (refuse))
                              (-> (sha data) (.then (fn [h] (when-not (= h id) (refuse)) (swap! objects assoc id data)))))))
        (.then (fn [_] (keys/open-record (edn/read-string record) secret)))
        (.then (fn [identity]
                 (-> (open-object @objects root identity)
                     (.then (fn [b]
                              (let [m (edn/read-string (text b)) rows (:files m) out (array) total (atom 0)]
                                (when-not (and (= :awai.owner/private-manifest-v1 (:schema m)) (= (:recipient-key identity) (:owner m))
                                               (vector? rows) (<= (count rows) 1000) (= (count rows) (count (set (map :name rows))))) (refuse))
                                (-> (sequence! rows
                                      (fn [r] (when-not (and (d/valid-path? (:name r)) (seq (:name r))
                                                            (js/Number.isSafeInteger (:size r)) (<= 0 (:size r) limit)) (refuse))
                                        (when (> (swap! total + (:size r)) limit) (refuse))
                                        (-> (open-object @objects (:object r) identity)
                                            (.then (fn [b] (when-not (= (:size r) (.-length b)) (refuse))
                                                     (-> (sha b) (.then (fn [h] (when-not (= h (:sha r)) (refuse))
                                                                         (.push out #js {:path (:name r) :bytes b :sha256 h})))))))))
                                    (.then (fn [_] out))))))
                     (.finally #(wipe! identity))))))))
