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

### Original bounded jobs — 2026-11-12

`prepare-original-jobs.clj` enrolls only the reviewed public-bots-registrar
24-hour and awai-arb6-hour original interval jobs. Typed operator grants permit
two exact public registry GETs, owned arb ledger/pending-draft writes, AwaiFS
artifact publication and owning Linear records. They grant no email send,
registration POST, arbitrary scripts, Git merge or model tools. These tasks use
a deterministic executor, with no inference call or applicable model token
counters. The existing five Muse readiness jobs remain separately identified.

`activate-original-jobs.clj` requires actual completed storage/Linear proofs
before creating the owned `network.awai.itonami.jobs.awai2795` timer. Wakeup is
60seconds; the enrolled source intervals remain unchanged. Unknown outcomes
stay claimed and recover only from their original persisted observations.
`original-worker.clj` publishes a separate `awai.original-job-observation.v1`
snapshot at the selected WebDAV `/itonami-job-results-AWAI-2795-v1/current.json`.
The live report has two completed observations and confirmed CID readbacks;
registry metrics returned200/count9, catalog502, so registration remains
unverified. The arb ledger contains measured service status and an unposted
availability investigation draft; these are not financial return measurements.
See `docs/evidence/itonami-original-jobs-20261112.json`. Mail/private-source/Git
effects and broad original fleet activation remain unqualified.

### Automatic fleet projection and staged rollout — 2026-11-12

AWAI-2808/2809 extend the parent AWAI-2795. The operator-owned observer joins
the immutable899-Bot catalog with explicitly pinned approved bindings and fresh
readiness/original/adapted execution reports. It publishes digest-checked public
artifacts to AwaiFS and, only after exact readback, atomically distributes a
static artifact to the local Soshiki preview. The app origin serves files only;
it performs no request-time joining, external proxying, scheduling or inference.
Soshiki reads this same-origin artifact every30seconds without manual catalog
selection. It shows all Bot/repository mappings, permissions, run IDs, next
slots and per-source-job hold conditions. Older manual tools are collapsed.

The new observer label `network.awai.itonami.fleet-observer.awai2795` wakes every
60seconds. This is observation cadence, separate from each Bot's source schedule.
Missing, future, duplicate, stale (>3minutes), changed profile/Project or unknown
reports never become current healthy execution. Hash verification checks artifact
integrity, not independent authentication or permission to execute.

The pinned existing GitHub CLI checks only metadata for exact requested repos in
the three owner organizations, in bounded GraphQL batches; results are cached
for6hours. Public/private availability is an operator read check, not a Bot grant
or a live App API qualification. Private source bodies and credentials are never
included. Current inspection verified755 repo targets covering891 Bot mappings;
six requested targets/eight Bot mappings remain unobserved.

Wave2 adds the `cron-health` Itonami-only adaptation every60minutes. Its grant
allows one exact public compact-summary GET, owned measurement/result writes and
owning Linear records. It never reads Hermes stores/SQLite or runs imported
Python scripts. The source Hermes monitoring job remains separately held. First
measurement recorded transport unavailable, and a later distinct diagnostic
received200/fresh summary; the first record remains unobserved and is displayed
as attention, not rewritten into success. Its next scheduled occurrence remains
at the original cadence. Current scope:6 identities/8 jobs=5 Muse readiness,
2 bounded originals and1 deterministic adaptation;893 identities remain held.
No automatic arbitrary capability granting or full-fleet business activation is
implemented. See `docs/evidence/itonami-fleet-auto-integration-20261112.json`.

### Wave3: pinned App physics adaptations — 2026-11-12 16:57 JST

The earlier Wave2 counts above are a dated baseline. The live observer now joins
525 configured identities/527 jobs:5 Muse readiness,2 bounded originals,
1 cron-health adaptation and519 pinned physics adaptations. The899-identity
catalog remains intact;374 identities are not enabled. Configuration is not a
successful-run count. Soshiki separately shows queued, confirmed latest receipts,
attention, App/repository, exact grant capabilities and next JST slot. The next
normal cron-health occurrence recorded HTTP200; its earlier transport failure
remains an unchanged historical observation.

643 profiles shared the same legacy physical measurement script. A reviewed
Otehon port replaces that runtime for519 supported immutable App specs; it does
not invoke KBB, Python, Hermes stores or arbitrary imported scripts. Supported
bounded models are transport, thermal, manipulator, tank-drain and pipe-flow.
22 specs could not be retrieved at their pinned revision;102 failed the current
scope/solver/budget checks. Those124 and250 other identities remain held with
their original conditions in the all-Bot projection and dated gate artifact.

`fetch-physics-specs.mjs` verifies public, nonarchived exact requested repositories,
immutable commits and Git blob OIDs before saving bounded data. The preparation
plan is display metadata and grants no authority. `prepare-physics-fleet.clj`
checks source/schedule/spec/runtime pins and enrolls explicit typed grants through
authenticated etcd CAS with independent readback. `daily.cljc` accepts only exact
daily HH:MM in Asia/Tokyo/UTC; it preserves the source phase and refuses other
cron shapes. `physics-worker.clj` admits at most4 due jobs per wake, catching up
only the latest missed daily occurrence. Wakeup is60seconds after prior runs;
it does not change each Bot's daily frequency. Unknown results reconcile only
the original saved measurement and never blindly re-simulate.

The new owned `network.awai.itonami.physics.awai2809` worker is live. Its compute
currently runs on jun-control; admission and fencing use the three physical
etcd hosts. This does not qualify distributed compute or cold boot. Each actual
simulation saves an AwaiFS CID with byte readback and forecast/result records in
its owning Project's unfinished Linear Issue. Initial Backlog issues move to
In Progress after measured work; they are never automatically Done. The
deterministic executor has no model call or applicable token counters. Native
tests remain unmeasured, hardware actuation disabled, and code growth/landing
held. Original source jobs remain separately identified.

The observer runs immutable source776d9cd with the pinned527-binding manifest;
the browser continues to read only its static same-origin artifact. The first
four physics runs and subsequent autonomous batches were independently observed.
See `docs/evidence/itonami-physics-rollout-20261112.json` for dated counts, source
pins, scope, public artifact readbacks, held-gate manifest and validation. The
local Soshiki preview is qualified; production guest UI cutover is not performed.

Wave3 follow-up diagnostics retain the original eligibility limits: the102
scope/solver/budget holds consist of70 unsupported material/J2 specs,19 total
numerical work budgets exceeded,12 invalid thermal budgets and1 invalid solver
budget. The detailed per-Bot data-only validation report has an immutable AwaiFS
URL/digest/readback in the follow-up evidence; no additional simulation or grant
was made for those held specs.

If artifact publication becomes uncertain after a child has saved its result,
the worker leaves that occurrence unknown and visibly in attention. It checks
again after10minutes, retaining the same request/run/slot and etcd claim. Recovery
uses the original saved simulation and artifact bytes; it must not reset the
claim, change the scheduling checkpoint to force success, or start another child.
The result is returned to waiting only after publication and scoped Linear
recording are confirmed. Operator-assisted and fully automatic live recovery
observations are kept separately from the initial successful-run baseline.
