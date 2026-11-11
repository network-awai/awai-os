(ns otehon-c1.run-plan
  "Operator-only input completeness checks; never permission or readiness."
  (:require [clojure.edn :as edn]
            [clojure.string :as str]
            [cheshire.core :as json])
  (:import [java.io PushbackReader StringReader]
           [java.nio.file Files Paths LinkOption]
           [java.security MessageDigest]
           [java.time Instant]))

(def adapter-keys
  [:consent-verifier :authenticated-revocation :reservation-authority :effect-fence
   :oci-executor :witness :inference :encrypted-storage :key-custody :backup-restore])
(def required-failures
  #{:missing-consent :revoked-consent :capacity-exceeded :tampered-digest :replay
    :duplicate-request :timeout :partition :restart :stale-writer :corrupt-replica
    :provider-loss :backup-restore})
(def resource-units
  {:cpu :vcpus :ram-bytes :bytes :disk-bytes :bytes
   :network :bytes-per-second :deadline-ms :milliseconds})
(defn positive-int? [n] (and (integer? n) (<= 1 n Long/MAX_VALUE)))
(defn nonnegative-int? [n] (and (integer? n) (<= 0 n Long/MAX_VALUE)))
(defn identifier? [s]
  (and (string? s) (boolean (re-matches #"[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}" s))
       (not (#{"unknown" "unset" "todo" "nil"} (str/lower-case s)))))
(defn digest? [s]
  (and (string? s) (boolean (re-matches #"(?:sha256:)?[0-9a-f]{64}" s))))
(defn revision? [s] (and (string? s) (boolean (re-matches #"[0-9a-f]{40}" s))))
(defn sha256 [bytes]
  (apply str (map #(format "%02x" (bit-and 255 %))
                 (.digest (MessageDigest/getInstance "SHA-256") bytes))))
(defn bounded-bytes [path]
  (let [p (Paths/get path (make-array String 0))]
    (when (or (Files/isSymbolicLink p)
              (not (Files/isRegularFile p (make-array LinkOption 0))))
      (throw (ex-info "Input must be a regular file" {})))
    (with-open [in (Files/newInputStream p (make-array java.nio.file.OpenOption 0))]
      (let [b (.readNBytes in 65537)]
        (when (> (alength b) 65536) (throw (ex-info "Input size limit" {}))) b))))
(defn read-plan [bytes]
  (with-open [r (PushbackReader. (StringReader. (String. bytes "UTF-8")))]
    (let [eof (Object.) p (edn/read {:eof eof} r)]
      (when-not (and (map? p) (identical? eof (edn/read {:eof eof} r)))
        (throw (ex-info "Expected one plan map" {}))) p)))
(defn read-inventory [bytes]
  (with-open [r (PushbackReader. (StringReader. (String. bytes "UTF-8")))]
    (let [values (doall (take 2 (json/parsed-seq r true)))]
      (when-not (and (= 1 (count values)) (map? (first values)))
        (throw (ex-info "Expected one inventory object" {})))
      (first values))))
(defn check-row [id issue problems]
  {:id id :owner-issue issue :status (if (empty? problems) "complete" "blocked")
   :missing-or-invalid (vec problems)})
(defn instant [s] (try (Instant/parse s) (catch Exception _ nil)))

(defn check-plan [plan inventory inventory-digest now]
  (let [nodes (:nodes plan) aliases (mapv :alias nodes)
        observed (:nodes inventory)
        valid-nodes? (and (vector? nodes) (= 2 (count nodes))
                          (every? #(and (string? %) (re-matches #"[A-Za-z][A-Za-z0-9-]{0,62}" %)) aliases)
                          (= 2 (count (set aliases))))
        inventory-ok? (and (= "awai.otehon.c1-preflight/1" (:schema inventory))
                           (= "host-inventory-only" (:evidence-class inventory))
                           (false? (:operational-ready inventory))
                           (= "collected" (:collection-status inventory))
                           (vector? observed) (= 2 (count observed))
                           (= (set aliases) (set (map :node observed)))
                           (every? #(and (= "observed" (get-in % [:observation :status]))
                                         (every? positive-int?
                                           (map (get-in % [:observation :facts] {})
                                                [:cpu-count :physical-memory-bytes :home-filesystem-available-kib]))) observed))
        at (instant (:observed-at inventory)) max-age (:inventory-max-age-ms plan)
        fresh? (and at (positive-int? max-age) (not (.isAfter at now))
                    (<= (- (.toEpochMilli now) (.toEpochMilli at)) max-age))
        identities (mapv :verified-identity nodes) domains (mapv :failure-domain nodes)
        ceilings (or (:resource-ceilings plan) {})
        capacity-ok? (and inventory-ok?
                          (every? positive-int? (map ceilings [:cpu :ram-bytes :disk-bytes :network :deadline-ms]))
                          (every? (fn [node]
                                    (let [facts (get-in node [:observation :facts])]
                                      (and (<= (:cpu ceilings) (:cpu-count facts))
                                           (<= (:ram-bytes ceilings) (:physical-memory-bytes facts))
                                           (<= (:disk-bytes ceilings) (*' 1024 (:home-filesystem-available-kib facts)))))) observed))
        binding? (fn [b] (and (map? b) (= :real-adapter (:qualification b))
                              (identifier? (:reference b)) (revision? (:source-revision b))
                              (digest? (:readback-digest b))))
        source-pins (:source-pins plan)
        row (fn [id issue & conditions]
              (check-row id issue (vec (keep (fn [[ok problem]] (when-not ok problem)) conditions))))
        checks [(row "plan-and-source" "AWAI-2773"
                  [(= "awai.otehon.c1-run-plan/1" (:schema plan)) "schema"]
                  [(identifier? (:run-id plan)) "run-id"]
                  [(and (vector? source-pins) (seq source-pins)
                        (every? #(and (identifier? (:repository %)) (revision? (:revision %))
                                      (identifier? (:path %))) source-pins)) "source-pins"])
                (row "host-observation" "AWAI-2773"
                  [valid-nodes? "exactly-two-distinct-aliases"] [inventory-ok? "complete-matching-inventory"]
                  [(and (digest? inventory-digest)
                        (= inventory-digest (get-in plan [:evidence :preflight :sha256]))) "inventory-sha256"]
                  [fresh? "inventory-age-and-clock"])
                (row "independent-nodes" "AWAI-2773"
                  [(and valid-nodes? (every? identifier? identities) (= 2 (count (set identities)))) "distinct-verified-identities"]
                  [(and valid-nodes? (every? identifier? domains) (= 2 (count (set domains)))) "distinct-failure-domains"])
                (row "dedicated-guests" "AWAI-2773"
                  [(and valid-nodes? (every? #(digest? (:guest-digest %)) nodes)) "guest-digests"]
                  [(and valid-nodes? (every? #(digest? (:guest-readback-digest %)) nodes)) "guest-readbacks"])
                (row "resources" "AWAI-2773"
                  [(= resource-units (:resource-units plan)) "explicit-resource-units"]
                  [capacity-ok? "positive-per-provider-ceilings-within-observed-physical-bounds"]
                  [(and valid-nodes? (every? #(digest? (get-in plan [:resource-readbacks %])) aliases)) "per-provider-enforcement-readbacks"])
                (row "operators" "AWAI-94"
                  [(every? identifier? (map (or (:operators plan) {}) [:accountable-owner :run-operator :reviewer])) "named-operators-and-reviewer"])
                (row "fixture-and-artifacts" "AWAI-2775"
                  [(digest? (get-in plan [:public-fixture :input-digest])) "public-fixture-input-digest"]
                  [(identifier? (get-in plan [:public-fixture :expected-output-or-quality-contract])) "quality-contract"]
                  [(every? digest? (map (or (:artifacts plan) {}) [:oci-digest :engine-digest :model-digest])) "artifact-digests"]
                  [(revision? (get-in plan [:artifacts :model-revision])) "model-revision"])
                (row "contribution-adapters" "AWAI-2774"
                  [(every? #(binding? (get-in plan [:adapters %])) (take 6 adapter-keys)) "real-consent-revocation-reservation-fence-oci-witness-readbacks"])
                (row "inference-adapter" "AWAI-2775"
                  [(binding? (get-in plan [:adapters :inference])) "real-authenticated-inference-readback"])
                (row "storage-adapters" "AWAI-2776"
                  [(every? #(binding? (get-in plan [:adapters %])) [:encrypted-storage :key-custody :backup-restore]) "real-encrypted-storage-key-custody-backup-readbacks"])
                (row "experiment-protocol" "AWAI-2777"
                  [(and (number? (get-in plan [:slo :success-rate-min]))
                        (<= 0 (get-in plan [:slo :success-rate-min]) 1)) "success-rate-min"]
                  [(every? nonnegative-int? (map (or (:slo plan) {}) [:latency-p95-ms-max :rpo-ms-max :rto-ms-max :foreground-latency-impact-max :revocation-stop-ms-max])) "predeclared-slo-bounds"]
                  [(positive-int? (get-in plan [:soak :proposed-duration-hours])) "soak-duration"]
                  [(digest? (get-in plan [:soak :approved-protocol-digest])) "protocol-evidence-digest"]
                  [(and (vector? (:failure-matrix plan))
                        (= (count (:failure-matrix plan)) (count (set (:failure-matrix plan))))
                        (every? (set (:failure-matrix plan)) required-failures)) "required-failure-matrix"])]
        blockers (filterv #(= "blocked" (:status %)) checks)]
    {:schema "awai.otehon.c1-plan-check/1" :checked-at (str now)
     :status (if (empty? blockers) "inputs-complete" "blocked")
     :evidence-class "operator-input-completeness-only"
     :operational-ready false :execution-authorized false :executable false
     :inventory-sha256 inventory-digest :checks checks
     :blocker-count (count blockers)
     :limits ["Complete metadata does not verify truth, signatures, permissions, independent hardware or service readiness."
              "Physical bounds are only upper bounds; reservations and enforced resource limits remain separate."
              "Draft/source pins and fixture results cannot substitute for real adapter readbacks."
              "This tool never contacts providers or starts guests, workloads, containers or services."]}))

(defn -main [& args]
  (when-not (= 2 (count args)) (throw (ex-info "Expected PLAN INVENTORY" {})))
  (let [[plan-file inventory-file] args
        plan (read-plan (bounded-bytes plan-file)) bytes (bounded-bytes inventory-file)
        inventory (read-inventory bytes)
        report (check-plan plan inventory (sha256 bytes) (Instant/now))]
    (println (json/generate-string report {:pretty true}))
    (when (= "blocked" (:status report)) (System/exit 2))))
(when (= *file* (System/getProperty "babashka.file"))
  (try (apply -main *command-line-args*)
       (catch Exception _
         (binding [*out* *err*] (println "C1_PLAN_REFUSED: invalid/bounded input; expected PLAN.edn INVENTORY.json"))
         (System/exit 2))))
