# Awai FS persistence: public two-host pilot — 2026-11-12 JST

Tracking: AWAI-2776 (C1.3), AWAI-534 (replica/placement), AWAI-2795 (Bot state).
This is an Otehon storage-core experiment, outside the Native runtime and outside
the mounted AwaiVol service. No production volume, VM or private Bot state was
changed. Existing SSH trust was used; no credentials were copied.

## Current implementation boundary

The running AwaiVol mount uses its installed `awaivol.cljc` local-pack backend
and a selected durable tier (currently B2). Its daemon is not evidence that the
ten Mac mini disks already form one replicated pool. The hosted Pack adapter
in this repository separately verifies/publishes bounded CARv2 Packs through
the pinned Awai codec and local WAL/checkpoint recovery.

Owning apex main has placement and erasure-layout planning; the inspected
`ec.cljc` blob `57498a88ab5f597779b390ed99b7cdbecc00987d` explicitly has no
encoding arithmetic, bytes or network. `placement.cljc` blob
`591f1a0e4c194775b414f8340e9e44350385370f` is likewise planning only.
Do not present these planners as an active distributed persistence service.

## Actual experiment

The helper uses the merged `otehon.pack-store` implementation, including its
exact pinned codec and WAL dependencies. A deterministic PUBLIC binary fixture
was created, checkpointed and exported on levi, transferred over existing SSH,
validated/imported/checkpointed on benjamin, and read in new BB processes.

Both target workspaces were checked: their backing filesystems are internal
APFS volumes, with distinct volume-identity hashes retained only in local
evidence. These are separate host-local copies, not two paths on one shared NAS.
Power/rack/site failure-domain independence was not established.

| Property | Observed |
| --- | --- |
| Payload | 131,109 bytes, three raw leaves |
| Root CID | `bafyreibmkwfu2zj3s5l56ahflfwz7rn3w5g6gt4duxzcqnwraiff6a7owa` |
| CAR SHA-256 | `c93cd21a475eb2734d15877ad5bee95e73f882f39947acdf1ae354d7400446a2` |
| Payload SHA-256 | `05bcfc6beb8aad88119c874da56942320529df363cb7c8e8519064f64bd2f130` |
| Fresh-process readback on both hosts | Same root, CAR and payload hashes |
| Read on B without contacting A | Passed; A was not stopped |
| Damaged new clone on B | Typed `corrupt-car` refusal |
| Original B replica after damage test | Preserved |
| Restore to a new B store from current third host's saved CAR | Passed |
| RPO / RTO / throughput / capacity scale | Unmeasured |
| Production-ready | false |

Corruption was confined to a newly re-imported public clone. No existing store
was reset or overwritten; the damaged copy and all artifacts remain. Restoration
is staged import into a new store, not an automatic in-place repair service.
The retained third-host CAR is a copy/restore rehearsal, not proof of an offsite
backup policy, version retention or key recovery.

An initial run correctly failed its negative control because the remote CLI
path reported exit zero while printing a storage error. The helper now emits
explicit application refusal/type JSON; the driver classifies that response
rather than treating transport exit status alone as a storage result. The
successful run records `refused/corrupt-car` with raw transport exit zero. No
initial failed run was promoted to a pass.

The successful driver SHA-256 is
`1945a26cbddc928d67e933f25c036c5462a7b5376c0beda2eaa360e12ea34662`;
the transferred helper/vendor archive SHA-256 is
`5e70757322d7873280b24111d9e9db7e0ef0b63af648228d8a98a8a2f3be45d6`.
Reports retain the base revision and exact source hashes separately because the
unit was tested before its source commit. Local fixture tests: 2 tests/9 assertions.
The pinned Nix fixture check built successfully. No model inference was invoked;
coding model/settings/token attribution remains unknown.

## Persistence target and remaining integration

One user-visible namespace can refer to immutable Packs distributed across
nodes. Preserve logical bytes/CIDs when changing physical placement. Add nodes
and rebalance without rewriting logical identity; enforce provider quotas and
independent device/host placement. Replica and EC layouts do not provide a
mutable-head writer authority: publish checkpoints/frontiers only through the
owning consensus/fencing contract, after required data durability is satisfied.

For Bot data, persist immutable profile versions, results, logs and checkpoints;
keep live cron claims/leases under their execution authority. Do not copy a live
SQLite database around and call it distributed writer coordination. Private data
needs existing Kura/dango authorization, encryption and key custody before moving.

Three-copy hot storage and EC for cold immutable Packs remain candidate policies
owned by AWAI-534/535, not activated defaults. Automatic admission/placement,
authenticated provider operations, encrypted data, repair, provider loss,
restart/power loss, capacity rebalance and backup/restore acceptance remain open.
