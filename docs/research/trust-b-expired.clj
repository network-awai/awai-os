;; Trust (B) — library expiry rejection probe (isolated, no private data).
;; Target: authority/grant.cljc live? (module-level expiry property, not deployment enforcement).
(require '[clojure.edn :as edn])
(println "trust-b probe start")
;; Probe lives in the test run output: chain-test expiry-boundary + :dango/expired assertions.
(println "see trust-b-output.txt for the recorded run output")
