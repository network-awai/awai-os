# Itonami bot organization — Otehon

AWAI-2795 registers immutable registry profiles into repository Circles with one
role per profile. Exact-name existing Linear Projects and their Initiatives are
referenced rather than recreated. An Issue/run/revision/acceptance-unit binding
is required separately; missing and ambiguous mappings remain unresolved.

Itonami bots run on Itonami/Awai distributed nodes (owner decision 2026-11-12).
The catalog names `itonami.distributed-execution.v1`: per-occurrence authority,
Awai FS state, and an explicitly selected Muse/Meta inference rail. VKE and
central-only/local-SQLite dispatch are incompatible configurations. An owner
string or a matching descriptor is not an authenticated admission proof.
Existing VKE services are outside this task; no migration to/from VKE is required.

The existing integration seam is Itonami's `gateway_job_node.kotoba` composing
Murakumo's job node, not the local cron execution ledger. That adapter itself
still requires trusted schedule enrollment, a durable cursor, unknown-outcome
reconciliation and cross-host fencing; see `kotoba-lang/itonami-agent` at
`177c2bb1ae43b21c40ad18a4201e4027a9401308`,
`docs/native-gateway-job-node.md`. This is an integration reference, not a
qualified/pinned runtime closure for this Otehon fleet. Do not copy the Native
implementation into Otehon or relabel the local ledger as distributed authority.

Generate from owner-selected snapshots (JSON exports are not checked in):

```sh
bb catalog.clj REGISTRY_DIRECTORY PROJECTS.json ISSUES.json REGISTRY_COMMIT NEW_CATALOG.json
node verify-cron.mjs NEW_CATALOG.json NEW_VERIFICATION_DIRECTORY
node persist.mjs NEW_CATALOG.json NEW_VERIFICATION_DIRECTORY/schedules.json NEW_DIRECTORY_ON_AWAI_FS
bb -cp src test/bot_fleet/core_test.clj
node --test receipt.test.mjs
node receipt.mjs BINDING.json MUSE_EVENTS.jsonl NEW_RECEIPT.json
nix-build check.nix --no-out-link
```

Run from this directory. `verify-cron.mjs` uses existing `gh` authorization to
read each profile's pinned `cron/jobs.json`, checks its manifest byte length and
SHA-256, and retains only schedule/authority inventory. It never executes code,
replays historical prompts or transfers connector secrets. Source publication
does not enable cron. Missing/failed sources remain holds; disabled and paused
jobs remain disabled. No shared daily schedule is invented.

`persist.mjs` creates an immutable registration directory, joins verified
schedules by profile pin, writes a digest, and reads the result back. Verify
that the selected destination really is the intended Awai FS service. Read it
through an independent service request as an additional check; a filesystem
mount can cache reads. Preserve partial directories for reconciliation.

In the Soshiki browser UI select `catalog.json` with the local file picker to
merge Circles, roles and bot registrations. Existing work is retained; identity
or name conflicts refuse the entire import. Repeat imports are idempotent until
the imported records have local edits, which require reconciliation. Imports
force `approval: ask` and never activate runtime grants or schedules. UI state
remains browser-local; edits are not automatically synchronized to Awai FS.

Current boundary: catalog/pin verification, immutable hosted registration,
browser import, and explicit Linear bindings are implemented. The continuously
running scheduler, scoped Linear executor, ownership/lease reconciliation and
restart/recovery acceptance remain open. The separate Muse CLI inference probe
is evidence of that provider/model call only; it does not qualify 899 live bots.
Do not enable imported scripts with a generic shell cron wrapper.

## Soshiki runtime observation (AWAI-2795)

Soshiki now has a **稼働状況 / Runtime** tab. The same component has a static
preview at `/soshiki-runtime/`. Import the existing registration catalog and an
operator-selected `awai.bot-fleet-observation.v1` file locally. The preview
keeps catalog data in memory; the regular Soshiki tab uses its current local
organization. The observation is saved separately in browser localStorage;
it never changes a bot's grants, owner, profile, approval or schedule.

```sh
node nixos/otehon/bot-fleet/observe-runtime.mjs \
  /Volumes/AwaiVol/itonami-circles-AWAI-2795-20261112-distributed-v1/catalog.json \
  .agent-output/ten-mac-mini-runtime-20261112.json \
  .agent-output/bot-runtime-observation-NEW.json
```

Run from the repository root. The collector uses existing strict SSH trust,
queries only command existence and process executable names (not argv), and
emits a bounded observation with no secret/profile payload. It does not start
services or jobs. CLI discovery is limited to the remote user's `.local/bin`,
Homebrew and system PATH. The count of unallocated process names cannot be
assigned to a bot; running/success/failure totals stay unknown. Host observations
do not establish guest runtime or whole-host absence of a bot.

`docs/evidence/itonami-bot-runtime-observation-20261112.json` records the fresh
2026-11-12 11:01:53 JST census: all ten hosts answered; bb was on PATH on all ten;
Muse, itonami and itonami-agent were not on the queried PATH. The immutable
observation was stored in `/Volumes/AwaiVol/itonami-runtime-AWAI-2795-20261112/`
and independently read over the existing localhost WebDAV service. SHA-256:
`7186ab12c1883a494e86c97b1331eaf236cdaa15575edd8c4dfa4da850f7308f`.
This is hosted persistence only, not two-node replicated filesystem proof.
The observation references the registration digest; browser matching currently
checks registry revision (not byte-level catalog authentication). Unsigned
operator observations are never execution/admission authority.

There are no qualified live run records in this schema. Run records are refused
instead of interpreting invented `running` fields. Future observations, another
registry revision and invalid imports are explicit; existing display is retained
on invalid import. Circle filtering changes only presentation. Observation age
is visible and updates every 30 seconds; it is a manual snapshot, not a heartbeat
or continuous monitor. There is no fabricated uptime, velocity or token total.

Live execution is still incomplete. At the independently inspected Itonami
revision `177c2bb1ae43b21c40ad18a4201e4027a9401308`,
`otehon/src/itonami/otehon/cli.cljc:910` (`execute-oneshot`) explicitly has no
live executor and returns pending/exit 3 without an injected finished turn.
The actual product CLI passes nil at the oneshot call. `run-step-stub` is a
fixture and must never be used as an inference adapter. The native job-node
reference also leaves distributed enrollment, cursor and fencing integration
open. A separate Muse provider probe cannot fill these gaps. No fleet cron is
activated here, and VKE is not used. Resume with a qualified Itonami/Muse host
adapter and authenticated Awai-node occurrence/cursor/effect integration,
then add attributable live run and recovery receipts to the observation schema.

## Approved execution path and physical qualification

Owner subsequently approved etcd for the Otehon control plane (2026-11-12,
apex PR185). Itonami PR282 now provides the explicit `muse-oneshot` live adapter,
`dispatch-muse!`/`recover-muse!`, a `.cljc` occurrence protocol and the pinned
certificate-CN etcdctl gRPC transport. The historical Native gateway adapter
reference above remains separate; old `oneshot`/`run-exec` pending routes have
not silently become live inference.

The [etcd operator runbook](etcd/README.md) and
`docs/evidence/itonami-etcd-three-mac-mini-20261112.json` record the independently
verified3-host deployment, scoped permissions, cross-host contention, quorum
failure/process recovery and actual Muse recovery. Background launchd services
are running on levi/benjamin/joseph; original Awai QEMU PIDs remained unchanged.
These are host control-plane services, not an existing guest OS replacement.

Soshiki's Runtime view can also import
`docs/evidence/itonami-runtime-receipts-20261112.json`:3/3 current-point etcd
responses,2 real physical-quorum Muse integration receipts with model/token
records, and no-reinference recovery. These dedicated integration profiles are
explicitly excluded from the899 registered fleet Bot counts. The view remains
a local, timestamped snapshot import, not continuous monitoring or permission.
Per-Bot Muse authorization, active work/capability/timebase and actual cron
rollout remain incomplete. Preserve all existing disabled states and holds.

## Limited recurring activation — owner request 2026-11-12

Five registered identities now have **separate public-readiness-only jobs**.
Their original effectful jobs remain held; this is not their mail, Git, shell,
arbitrage-ledger or registry-registration executor. Each readiness run examines
only a confirmed-public README at an immutable commit and records one proposed
acceptance unit in the Bot's existing unfinished Linear Issue.

| Registered Bot | Source interval retained | Owning Issue |
| --- | --- | --- |
| awai-arb | 6 hours | AWAI-750 |
| mail-relay | 6 hours | AWAI-893 |
| public-bots-registrar | 24 hours | AWAI-1012 |
| rule-kaizen | 24 hours | AWAI-755 |
| sec-toolkit-maturity | 12 hours | AWAI-943 |

`prepare-readiness.clj` creates new Itonami profiles and a digest-pinned worker
manifest, checks the original enabled interval and current Issue/Project, and
enrolls distinct readiness job IDs in the authenticated3-host etcd ledger. It
refuses existing paths/enrollments; preserve partial preparation for operator
reconciliation. The deployment used exact Itonami source `a68e5bf` for all five
initial real model calls, subsequently promoted to `f1a2341` for waiting-tick
connector reduction. First-run bindings retain their actual `a68e5bf` revision.

`activate-readiness.clj` requires completed model receipts and confirmed Linear
results for every selected Bot before installing the new owned label
`network.awai.itonami.readiness.awai2795`. Its60-second wakeup checks due slots;
it does not replace individual frequencies. Waiting slots use etcd only. Sleep
skips unstarted old slots; admitted/unknown work never skips or transfers.
The current inference worker is local `jun-control`, using the physical3-host
ledger. Independent remote Muse execution and machine cold boot are unqualified.

`readiness-worker.clj` publishes only bounded public metadata/model counters to
the explicitly selected existing loopback WebDAV resource:
`http://127.0.0.1:8586/itonami-bot-readiness-AWAI-2795-20261112-v1/current.json`.
It uses bounded PUT+GET readback (3-second connect/30-second read timeout per
request), rejects redirects and does not write through
the mounted volume in the launchd path: a mount-open stall was observed after
model/cursor completion during service qualification. Local transcripts/auth
references remain private. Hosted snapshots do not establish private/distributed
filesystem qualification. Existing Awai guests, VKE and other labels are untouched.

The existing Orca application connection provides scoped Linear reads/comments;
the worker exports no credentials. Source effects and missing-timezone cron are
held. `reconcile-rejected-forecasts.clj` is only for the observed definitive
`linear_issue_required` UUID-target rejection, after complete no-comment and
no-admission readback; never use it for an unknown transmitted write.

Soshiki can import the public readiness report separately from integration-test
receipts. It shows selected periodic configuration, latest actual completions,
model/tokens and Linear confirmation. Browser display remains a local snapshot,
not continuous synchronization, fleet uptime or all899 original jobs activated.
The other894 registered identities are not activated by this deployment.

### Original cron timezone decision — 2026-11-12

The owner subsequently chose `Asia/Tokyo` for missing original cron timezones.
`resolve-timezones.mjs` applies the explicit decision to1,607 cron entries,
preserves30 interval entries and all expressions/enabled/paused flags, and
produces a new registration with source digests and per-job provenance. Existing
explicit zones are retained. The previous immutable registration remains intact.
This resolves the timezone prerequisite only; the inference-only recurring host
does not become an effectful calendar executor. Its five live interval jobs
and authenticated enrollment pins are unchanged. The decision/report and new
registration are persisted through the selected existing WebDAV service with
independent byte readback; see `docs/evidence/itonami-cron-timezone-20261112.json`.
