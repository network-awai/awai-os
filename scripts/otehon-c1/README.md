# Otehon distributed operations C1

Tracking: [AWAI-2772](https://linear.app/kotobalabs/issue/AWAI-2772).
This is an Otehon operations tool, separate from Native build/runtime gates.
It does not enroll nodes, grant capabilities, launch workloads or move funds.

## One cycle and one milestone

The existing AWAI team Cycle 1 contains the bounded C1 issues below. The
project milestone is **Otehon C1 — 独立2ノードで contribute・推論・保存・復旧を一巡**
in **AWAI Network — 分散型 dapps と経済圏（anatomy）**. Cycle dates follow the
team's settings; a calendar boundary does not imply operational acceptance.
The integration parent remains a child of AWAI-160. Existing owning issues
keep their parents and acceptance criteria; C1 adds integration scope.

| Order | C1 issue | Existing owners | Acceptance boundary |
| --- | --- | --- | --- |
| 0 | [AWAI-2773](https://linear.app/kotobalabs/issue/AWAI-2773) | AWAI-202 | Host/VM preflight, pinned run manifest and evidence |
| 1 | [AWAI-2774](https://linear.app/kotobalabs/issue/AWAI-2774) | AWAI-235 | Live consent/revocation, atomic durable reservation, fence, OCI, signed receipt/witness |
| 2 | [AWAI-2775](https://linear.app/kotobalabs/issue/AWAI-2775) | AWAI-149/167/203 | Real model answers, authenticated two-node serving and explicit recovery |
| 3 | [AWAI-2776](https://linear.app/kotobalabs/issue/AWAI-2776) | AWAI-161/532/534 | Authorized encrypted replication, same-CID readback, loss/repair and backup restore |
| 4 | [AWAI-2777](https://linear.app/kotobalabs/issue/AWAI-2777) | AWAI-164/183 | Fault injection, monitoring/runbook, initial 24h soak and measured decision |

Contribute and storage integration follow preflight; inference integration
also needs the contribution execution boundary. Soak follows all three.
Two-node serving means placing requests on independent providers. Splitting
one model over several hosts is a distinct model-parallel experiment and is
not a prerequisite. Native selfhost completion is not a C1 dependency.

## Read-only host inventory

From the repository root, using Babashka v1.12.218:

```sh
bb scripts/otehon-c1/preflight_test.clj
mkdir -p .agent-output/c1-preflight
bb scripts/otehon-c1/preflight.clj levi benjamin > .agent-output/c1-preflight/host-inventory.json
```

The caller selects exactly two distinct SSH aliases; the fixed remote account
is `node`. Existing SSH credentials/configuration and trusted host keys are
used. Unknown keys are rejected. No credentials, SSH diagnostics, raw process
arguments, VM names or private payloads are written into the report.
Each probe has a 15-second local deadline and an 8 KiB output cap; stderr is
discarded. Tests exercise a real process timeout and oversized output as well
as malformed observations and duplicate/option-like targets.
The same tests run without SSH in the existing Otehon CI job through
`nix-build scripts/otehon-c1/check.nix --no-out-link`, using the repository's
immutable nixpkgs pin. Native build/gate dependencies are unchanged.

The probe reads OS/architecture, CPU count, physical RAM and the free space of
the account's home filesystem. It looks for four executables in a fixed PATH
and, if available, reads Lima instance status counts. It does not inventory
other users' Lima inventories, contact Docker daemons, inspect inference
endpoints or test any guest. Zero instances means only that the account's Lima
inventory was empty at observation time. The read-only process-name probe also
counts visible QEMU system processes, independently of Lima. It exports no PID,
VM name, command arguments or disk paths. A QEMU count proves process presence,
not guest health, peer connectivity or distributed execution. A failed process
probe remains unknown rather than zero.

Exit 0 means **inventory collected**, not readiness. Exit 2 means incomplete
collection or invalid CLI arguments. The report always states
`operational-ready: false`: this tool supplies no runtime qualification and
cannot be used as an execution permit. Alias uniqueness does not prove host
identity or independent failure domains. Physical RAM is not allocatable RAM;
filesystem free space is not a reservation.

## Next integration inputs

`run-plan.edn` is a draft checklist, not an executable configuration. Resolve
every unknown from actual owning adapters and record digests before starting
a workload. Keep credentials and private data outside source and evidence.
The workload, SLOs, resource ceilings and failure matrix must be fixed before
the experiment, not selected retrospectively from a passing result.

The candidate plan now pins the observed inventory and the actual source
revisions. The profile source is a boot profile, the local Pack store is not a
replicated encrypted service, PR #69 is a draft model, and PR #53 has no live
model/guest proof. None fills a `:real-adapter` slot. `:operators`, the inventory
age bound, independent identities/domains, guest digests/readbacks, per-provider
resource enforcement, model/fixture digests, adapter readbacks and protocol
evidence remain explicit unknowns until independently observed.

Check an operator plan without contacting a provider:

```sh
bb scripts/otehon-c1/run_plan_test.clj
bb scripts/otehon-c1/run_plan.clj scripts/otehon-c1/run-plan.edn \
  docs/evidence/otehon-c1-run-plan-20261111/host-inventory.json
```

The checker joins the exact SHA-256 of the supplied inventory bytes, rejects
stale/future/missing observations and mismatched aliases, requires distinct
declared identities/domains, and lists missing inputs with owning issues.
Each input is a regular non-symlink file of at most 64 KiB: exactly one EDN map
and one JSON object. Extra forms/objects are refused. Resource ceilings apply
to each provider: CPU in vCPUs, RAM/disk in bytes, network in bytes/second and
deadline in milliseconds. Comparing with observed physical bounds does not
reserve capacity or prove enforcement. Per-provider readback digests are
separate required inputs; free space on the home filesystem does not establish
the guest's usable storage.

Exit 2 means invalid or incomplete inputs. Exit 0 means only that the supplied
metadata is structurally complete. The checker does not authenticate that
metadata, verify signatures or capabilities, prove physical independence,
contact adapters, download models, or grant authority. Its report always sets
`executable`, `execution-authorized` and `operational-ready` to false. Explicit
test metadata may exercise completeness but cannot qualify a node. Artifact
checksums here join operator evidence; they do not redefine canonical block CIDs.
The actual candidate remains blocked. All checks run in the same separate
Nix-pinned Otehon job; Native has no dependency on them.

The cycle closes only when the same run/job/node/artifact identities connect
the live consent, reservation, execution, result verification, durable storage
and recovery evidence. The initial 24h soak is an experiment, not a claim of
production reliability. Preserve refusals, unknown outcomes and failures.
Do not retry an unknown execution before authoritative reconciliation.

Existing linked VM state and live services must be preserved. Production
route cutover, OS updates to an existing persistent VM and real settlement
retain their separate approval boundaries. Creating this checklist does not
authorize an app or bot to bypass fresh operation consent.
