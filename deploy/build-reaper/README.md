# build-reaper

[AWAI-3664](https://linear.app/kotobalabs/issue/AWAI-3664). A CronJob in the `build-reaper` namespace of the Awai Tatara VKE cluster (`awai-tatara-ci`, nrt). It runs on the `tatara-system` pool every 10 minutes and deletes any on-demand node pool that has had no active Job or Pod for 30 minutes. It works even when the operator's worker died hard (SIGKILL, laptop asleep). The operator-side worker already releases its pool on exit, INT, TERM and HUP; this is the server-side backstop.

## What it deletes

- **Candidates:** Vultr node pools labelled `awai.network/reapable=true`. Release-build pools (`vke-release-pool.mjs`) and Tatara APK burst pools (AWAI-3834) set this label at creation.
- **Never touched**, checked independently of the label: pools named `tatara-system` or `tatara-ci-runners-*`, any pool whose name starts with `tatara`, and any pool or node that carries `tatara.network/role`.
- **Idle** means no non-finished Pod on the pool's nodes or selecting the pool, and no unfinished Job selecting it. Cluster add-ons (DaemonSets and kube-system Calico, CSI, kube-proxy, konnectivity and CoreDNS Pods) do not count. The 30 minutes run from the latest pool creation or update, node creation, Pod start or finish, or Job start, completion or failure.
- The pool is re-read right before deletion, and every decision is logged as one JSON line (`skip`, `would-delete`, `deleted`, `error`, `key-too-broad`).

## Security

- The Vultr key lives only in the Secret `build-reaper/build-reaper-vultr` and reaches the Pod through `secretKeyRef`. The reaper ServiceAccount can only list nodes, Pods and Jobs, and get or patch its heartbeat ConfigMap. It has no Secret permission. `default` has no token. The namespace enforces Pod Security `restricted`. A NetworkPolicy allows no ingress, and egress only to DNS and ports 443 and 6443.
- On 2026-11-22, only kube-system controller ServiceAccounts (and `kube-system/admin-user` with cluster-admin) had cluster-wide Secret read. No workload ServiceAccount did. Kubernetes RBAC is additive, so recheck this before deploying.
- **The key must be limited to VKE.** Use a Vultr sub-user with ACL `[vke]` only, never the root account key. On every run the reaper probes `/v2/instances` and `/v2/billing/history` and refuses to run unless both return 401 or 403. The root key fails this check (verified 2026-11-22).
- **No IP allowlist.** Egress uses the `tatara-system` node's public IP, which changes whenever that pool is recreated. A per-user allowlist would silently disable the reaper.

## Heartbeat

Each run patches `ConfigMap build-reaper/build-reaper-heartbeat` with `lastRun`, `result`, `error`, `pools` and `deleted`. A `lastRun` older than 20 minutes means the reaper is broken. `CronJob .status.lastSuccessfulTime` is a second signal.

## Deploy (after the PR merges)

```sh
kubectl apply -f deploy/build-reaper/namespace.yaml
# Sub-user key with ACL [vke] only, from the secret store over stdin (never argv or a file):
read_vke_only_key | kubectl -n build-reaper create secret generic build-reaper-vultr --from-file=VULTR_API_KEY=/dev/stdin
# First apply with REAPER_DRY_RUN "1" in cronjob.yaml. Check one run, then set it to "0" and apply again.
kubectl apply -k deploy/build-reaper
kubectl -n build-reaper logs -l app.kubernetes.io/name=build-reaper --tail=50
kubectl -n build-reaper get configmap build-reaper-heartbeat -o jsonpath='{.data}'
```

Tests: `node --test deploy/build-reaper/reaper.test.mjs`. They cover a dry run, the incident's idle pool, a negative case where Tatara pools are never touched (even when idle, renamed or mistakenly marked reapable), the grace period, active builds, a key that is too broad, and the heartbeat.
