(ns otehon-c1.run-plan-test
  (:require [clojure.test :refer [deftest is run-tests]]
            [cheshire.core :as json])
  (:import [java.time Instant]
           [java.nio.file Files Paths]
           [java.nio.file.attribute FileAttribute]))
(load-file "scripts/otehon-c1/run_plan.clj")
(load-file "scripts/otehon-c1/preflight.clj")
(require '[otehon-c1.run-plan :as r] '[otehon-c1.preflight :as p])

;; These are explicit metadata fixtures, not signed evidence or real services.
(def digest (apply str (repeat 64 "a")))
(def revision (apply str (repeat 40 "b")))
(def now (Instant/parse "2026-11-11T00:00:01Z"))
(def inventory
  {:schema "awai.otehon.c1-preflight/1" :evidence-class "host-inventory-only"
   :operational-ready false :collection-status "collected" :observed-at "2026-11-11T00:00:00Z"
   :nodes (mapv (fn [n] {:node n :observation {:status "observed" :facts
                     {:cpu-count 2 :physical-memory-bytes 4096 :home-filesystem-available-kib 100}}}) ["a" "b"])})
(def binding
  {:qualification :real-adapter :reference "fixture:metadata-only"
   :source-revision revision :readback-digest digest})
(def complete-plan
  {:schema "awai.otehon.c1-run-plan/1" :run-id "fixture-metadata-only"
   :inventory-max-age-ms 5000 :source-pins [{:repository "fixture/repo" :revision revision :path "fixture.nix"}]
   :nodes (mapv (fn [a] {:alias a :verified-identity (str "fixture-host-" a)
                         :failure-domain (str "fixture-domain-" a)
                         :guest-digest digest :guest-readback-digest digest}) ["a" "b"])
   :resource-ceilings {:cpu 1 :ram-bytes 1024 :disk-bytes 1024 :network 1 :deadline-ms 1000}
   :resource-units r/resource-units
   :resource-readbacks {"a" digest "b" digest}
   :operators {:accountable-owner "fixture-owner" :run-operator "fixture-operator" :reviewer "fixture-reviewer"}
   :public-fixture {:input-digest digest :expected-output-or-quality-contract "fixture:quality-v1"}
   :artifacts {:oci-digest digest :engine-digest digest :model-digest digest :model-revision revision}
   :adapters (zipmap r/adapter-keys (repeat binding))
   :slo {:success-rate-min 1 :latency-p95-ms-max 10 :rpo-ms-max 0 :rto-ms-max 10
         :foreground-latency-impact-max 0 :revocation-stop-ms-max 10}
   :soak {:proposed-duration-hours 24 :approved-protocol-digest digest}
   :failure-matrix (vec (sort r/required-failures)) :evidence {:preflight {:sha256 digest}}})
(defn checked
  ([plan] (r/check-plan plan inventory digest now))
  ([plan inv] (r/check-plan plan inv digest now)))
(defn blocked? [report id]
  (= "blocked" (:status (first (filter #(= id (:id %)) (:checks report))))))

(deftest complete-metadata-is-never-permission
  (let [report (checked complete-plan)]
    (is (= "inputs-complete" (:status report)))
    (is (zero? (:blocker-count report)))
    (is (every? false? (map report [:executable :operational-ready :execution-authorized])))))
(deftest committed-draft-is-blocked
  (let [draft (r/read-plan (r/bounded-bytes "scripts/otehon-c1/run-plan.edn"))
        report (checked draft)]
    (is (= "blocked" (:status report)))
    (is (pos? (:blocker-count report)))
    (is (false? (:execution-authorized report)))))
(deftest bind-exact-fresh-observation
  (doseq [inv [(assoc inventory :schema "unknown") (assoc inventory :operational-ready true)
               (assoc inventory :evidence-class "fixture") (assoc inventory :collection-status "incomplete")
               (assoc inventory :observed-at "2026-11-10T00:00:00Z")
               (assoc inventory :observed-at "2026-11-12T00:00:00Z")
               (assoc-in inventory [:nodes 1 :node] "c")
               (update-in inventory [:nodes 0 :observation] dissoc :facts)]]
    (is (blocked? (checked complete-plan inv) "host-observation")))
  (is (blocked? (r/check-plan complete-plan inventory (apply str (repeat 64 "c")) now) "host-observation")))
(deftest names-are-not-independent-nodes
  (doseq [path [[:nodes 1 :verified-identity] [:nodes 1 :failure-domain]]]
    (is (blocked? (checked (assoc-in complete-plan path (get-in complete-plan (assoc path 1 0)))) "independent-nodes")))
  (is (blocked? (checked (assoc-in complete-plan [:nodes 1 :alias] "a")) "host-observation"))
  (is (blocked? (checked (assoc-in complete-plan [:nodes 0 :verified-identity] "unknown")) "independent-nodes")))
(deftest resource-observations-are-not-enforcement
  (doseq [[path value] [[[:resource-ceilings :cpu] 0] [[:resource-ceilings :cpu] 3]
                        [[:resource-ceilings :cpu] 1.5] [[:resource-ceilings :ram-bytes] 4097]
                        [[:resource-ceilings :disk-bytes] 102401] [[:resource-ceilings :network] -1]
                        [[:resource-readbacks "a"] nil] [[:resource-units :network] :bits-per-second]]]
    (is (blocked? (checked (assoc-in complete-plan path value)) "resources")))
  (is (blocked? (checked (assoc-in complete-plan [:nodes 0 :guest-readback-digest] nil)) "dedicated-guests")))
(deftest every-real-adapter-needs-a-bound-readback
  (doseq [[k group] [[:consent-verifier "contribution-adapters"] [:authenticated-revocation "contribution-adapters"]
                    [:reservation-authority "contribution-adapters"] [:effect-fence "contribution-adapters"]
                    [:oci-executor "contribution-adapters"] [:witness "contribution-adapters"]
                    [:inference "inference-adapter"] [:encrypted-storage "storage-adapters"]
                    [:key-custody "storage-adapters"] [:backup-restore "storage-adapters"]]]
    (is (blocked? (checked (assoc-in complete-plan [:adapters k :qualification] :fixture)) group))
    (is (blocked? (checked (assoc-in complete-plan [:adapters k :readback-digest] nil)) group)))
  (is (blocked? (checked (assoc-in complete-plan [:adapters :witness :source-revision] "main")) "contribution-adapters")))
(deftest source-operators-and-protocol-are-not-implicit
  (doseq [[path value group] [[[:schema] "awai.otehon.c1-run-plan/2" "plan-and-source"]
                              [[:source-pins 0 :revision] "HEAD" "plan-and-source"]
                              [[:operators :run-operator] nil "operators"]
                              [[:public-fixture :input-digest] nil "fixture-and-artifacts"]
                              [[:slo :success-rate-min] 1.1 "experiment-protocol"]
                              [[:slo :rpo-ms-max] -1 "experiment-protocol"]
                              [[:soak :approved-protocol-digest] nil "experiment-protocol"]
                              [[:failure-matrix] [:timeout] "experiment-protocol"]]]
    (is (blocked? (checked (assoc-in complete-plan path value)) group))))
(defn temp-dir []
  (Files/createDirectories (Paths/get ".agent-output" (make-array String 0)) (make-array FileAttribute 0))
  (Files/createTempDirectory (Paths/get ".agent-output" (make-array String 0)) "run-plan-test-" (make-array FileAttribute 0)))
(deftest local-input-is-bounded-and-one-edn-map
  (doseq [s ["{} {}" "nil" "{} trailing" "#=(System/exit 0)" "#custom/secret {}"]]
    (is (thrown? Exception (r/read-plan (.getBytes s "UTF-8")))))
  (doseq [s ["{} {}" "null" "[]" "{} trailing"]]
    (is (thrown? Exception (r/read-inventory (.getBytes s "UTF-8")))))
  (let [dir (temp-dir) p (.resolve dir "large.edn") link (.resolve dir "linked.edn")]
    (spit (str p) (apply str (repeat 65537 "x")))
    (is (thrown? Exception (r/bounded-bytes (str p))))
    (Files/createSymbolicLink link (.getFileName p) (make-array FileAttribute 0))
    (is (thrown? Exception (r/bounded-bytes (str link))))))
(deftest cli-binds-actual-inventory-bytes-and-never-authorizes
  (let [dir (temp-dir) plan-path (str (.resolve dir "plan.edn")) inv-path (str (.resolve dir "inventory.json"))
        inv (assoc inventory :observed-at (str (Instant/now)))
        bytes (.getBytes (json/generate-string inv) "UTF-8")
        plan (-> complete-plan (assoc :inventory-max-age-ms 60000)
                 (assoc-in [:evidence :preflight :sha256] (r/sha256 bytes)))
        command ["bb" "scripts/otehon-c1/run_plan.clj" plan-path inv-path]]
    (spit inv-path (String. bytes "UTF-8")) (spit plan-path (pr-str plan))
    (let [result (p/run-probe-process command "" 10000)
          report (json/parse-string (:out result) true)]
      (is (zero? (:exit result)))
      (is (= "inputs-complete" (:status report)))
      (is (false? (:execution-authorized report))))
    (spit inv-path " ":append true)
    (let [result (p/run-probe-process command "" 10000)
          report (json/parse-string (:out result) true)]
      (is (= 2 (:exit result))) (is (blocked? report "host-observation")))
    (spit plan-path "#=(private-credential)")
    (let [result (p/run-probe-process command "" 10000)]
      (is (= 2 (:exit result))) (is (not (.contains (:out result) "private-credential"))))))

(let [result (run-tests)]
  (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
