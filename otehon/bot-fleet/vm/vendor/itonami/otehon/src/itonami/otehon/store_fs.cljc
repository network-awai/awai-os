(ns itonami.otehon.store-fs
  "Awai fs placement decisions: hot stays local, warm/cold go to awai fs.

  Pure decision half of the `fs` routes (docs/awai-fs-design.md section 7,
  Native route). The host performs every effect (mounts, eviction, pins,
  snapshots, the free-space watermark) and reads itonami.edn `:storage`.
  Hermes never reads itonami.edn, so `:storage` is itonami-agent only,
  exactly like `:inference` today. An absent `:storage` means local-only.

  Verdict strings for storage and fs routes are the pinned contract of
  kotoba/itonami/storage.kotoba (JUN-1061): storage-verdict and
  fs-route-code answer the same strings and codes here so the Otehon
  oracle and the Native core agree. Tier and placement verdicts are new
  in this namespace and pinned here.

  Evict contract (host-enforced, not modelled here): evict removes only
  local cached copies after verifying the B2 object; deleting at the
  mount performs remote deletion. A missing mount is a hard error, never
  an empty local dir standing in for it."
  (:require [clojure.string :as str]))

(defn storage-verdict
  "The :storage backend an itonami profile declares, or \"\" when absent."
  [backend]
  (cond (= (str backend) "awai-fs") "storage/ok"
        (= (str backend) "") "storage/local-only"
        :else "storage/unknown-backend"))

(defn fs-route-code
  "fs subcommand codes (pinned contract, same as storage.kotoba):
     0 unknown subcommand (the host dies 2)
     1 usage (bare `fs`)
     2 status   3 mount   4 evict   5 pin   6 snapshot"
  [sub]
  (cond (= (str sub) "") 1
        (= (str sub) "status") 2
        (= (str sub) "mount") 3
        (= (str sub) "evict") 4
        (= (str sub) "pin") 5
        (= (str sub) "snapshot") 6
        :else 0))

(defn fs-usage-line-count
  "The usage block lists the five subcommands; any other route prints its
  own refusal line instead, so those count 0 here."
  [route]
  (if (= route 1) 5 0))

(defn tier-for
  "Hot stays local SSD (worktree, git-common, build). Warm is read-mostly
  awai fs capacity (evidence, models, cache, cron-output, runs, receipts).
  Cold is recovery-only (snapshot, backup, dump). Anything else refuses."
  [kind]
  (let [k (str kind)]
    (cond (or (= k "worktree") (= k "git-common") (= k "build")) "tier/hot"
          (or (= k "evidence") (= k "models") (= k "cache")
              (= k "cron-output") (= k "runs") (= k "receipts")) "tier/warm"
          (or (= k "snapshot") (= k "backup") (= k "dump")) "tier/cold"
          :else "tier/unknown")))

(defn mount-required?
  "Warm and cold tiers need the awai fs mount (or the S3 gateway for blob
  reads). Hot never does: the Git common dir and active worktrees stay on
  local SSD (measurement 4, macFUSE unresolved)."
  [tier]
  (let [t (str tier)]
    (or (= t "tier/warm") (= t "tier/cold"))))

(defn placement-verdict
  "Where one data kind lives given the profile backend. Hot is always
  local, even when the profile names awai-fs. Warm/cold need awai-fs and
  refuse local-only with a distinct verdict so the caller can ask for a
  mount instead of silently diverging."
  [kind backend]
  (let [sv (storage-verdict backend)
        tier (tier-for kind)]
    (cond (= sv "storage/unknown-backend") "placement/unknown-backend"
          (= tier "tier/unknown") "placement/unknown-tier"
          (= tier "tier/hot") "placement/hot-local"
          (= sv "storage/local-only") "placement/needs-awai-fs"
          :else "placement/awai-fs")))
