# Meiji fleet recovery observation — AWAI-2820

At 2026-11-16T07:34:43Z, the read-only `.cljc` audit used benjamin's existing
node identity and owner-pinned etcdctl binary. Both Range reads returned cluster
revision 3024. No enrollment, lease, cursor, certificate or VM disk was changed.

| Registered Bot | VM job | Issue | Last completed slot (UTC) |
| --- | --- | --- | --- |
| physai-unspsc-39 | a838b5c01f26-otehon-vm-v1 | AWAI-2421 | 2026-11-12T14:53:00Z |
| physai-unspsc-43 | 872686336f44-otehon-vm-v1 | AWAI-2422 | 2026-11-12T14:55:00Z |

Both enrollments target `vm-levi` and `vm-benjamin`, with daily 86400000 ms
intervals and the bounded `awai-vm-physics-v1` executor. Their provider/model
are `none` / `deterministic`; **these jobs do not call Kapitsa**. Three historical
platform canaries also have completed cursors. No current liveness or business
completion rate follows from these historical cursor states.

The existing additive Bot VMs and their host-owned keys remain present. The
local VM coordinator's manifest, fixed-command operator SSH identity and old
`awai-bots-v1` admin identity are missing following the state-directory
recreation. The loaded LaunchAgent repeatedly reports FileNotFoundException.
Thus neither service registration nor the older 899-Bot catalog is evidence
of ongoing cron execution. The separate Circle control-plane keys do not
replace authority in the old Bot ledger.

Resume requires recovering the original coordinator configuration/operator key
and reconciling original slots, or an explicit identity-recovery migration that
preserves guest data and ledger outcomes. Do not reset the cluster, issue new
job IDs, replay uncertain work, replace a live disk, or count missing telemetry
as zero to bypass this state. A pinned Meiji guest image, VM-local scheduler,
bounded inference executor, guest-to-jacob transport and original cron/paused
manifest still need qualification before migrating additional production Bots.

Read-only inspection on the owning node (no key export):

```sh
bb -cp src -m meiji.fleet-audit /absolute/private/worker-client.json
```

The command publishes only VM enrollment/cursor metadata. Missing cursors and
all liveness remain unknown. It does not operate the scheduler or validate
guest result replicas. Two independent Range reads are not claimed to be an
atomic snapshot; both revisions are emitted. The node's configured cluster ID
and etcdctl SHA-256 must match before any output is accepted.

## AwaiVol retreat lookup

The owner identified **AwaiVol** as the retreat location. Read-only lookup at
07:48–07:53 UTC checked the active logical file index (5216 entries), HTTP
Depth-1 listings of Itonami report/result roots and the workspace/volume roots,
the accessible resident checkpoint metadata, and four local saved indexes
(1140, 1140, 1675, 4854 entries; overlapping snapshots, not additive coverage).
No indexed path matched `.itonami`, `itonami-state`, `operator_ed25519`,
`worker.edn` or `root.key` in that inspected scope. Itonami registration,
execution report and VM result namespaces do exist. The mounted WebDAV path
occasionally blocked; direct HTTP listing/metadata reads worked, while one
VM report GET timed out at 8 seconds. This is not storage availability/SLO
qualification and does not prove the backup is absent from other volumes,
encrypted archives or historical remote versions. The owner was asked for the
specific retreat folder/volume/snapshot name. No AwaiVol data was changed.

When the original state is found:

1. Stage it privately outside the loaded LaunchAgent's active config path.
   Verify the operator public key against `vm/operator-authorized.pub`, client
   certificates against the preserved cluster CA, and configuration against the
   original LaunchAgent manifest digest. Do not print/copy keys into Git.
2. Read the authoritative enrollments, cursor and original guest result for
   each job; preserve completed/uncertain slots, identity and disk ownership.
   Restore original cron/timezone/paused fields, not a newly generated cadence.
3. Drain the task-owned coordinator before atomically installing the verified
   restored configuration. Verify fixed-command SSH and persisted result
   readback before resuming a due slot. Do not substitute a new job ID.
4. Qualify guest-local scheduler/inference grants, signed Meiji image and
   guest-to-jacob transport before additional Bot cutover. Native UI fixture
   success and historical physics receipts do not satisfy these conditions.

## Owner-selected new WebDAV state root

The owner subsequently chose to create a **new** `.itonami` folder through
WebDAV. At 07:56 UTC this task created `/.itonami/`, `recovery/`, `runtime/`
and `receipts/` without replacing existing state. The bootstrap `.cljc` script
stored public recovery metadata only. No key, credential, transcript or private
Bot payload was uploaded. Two append-only bootstrap records remain preserved:
the first write's verification hit a response-body type mismatch, then text
decoding was corrected and a second immutable record was verified.

The verified record is
`/.itonami/recovery/awai-2820-a06bd4e9-399f-4f98-b203-319ebaca1f18.json`, SHA-256
`3d9474aca3e1aaec715547ef624155b7ef6eda20824b32988d95b0fce48d5664`.
HTTP bytes match the locally prepared record, and the local persistent manifest
contains both records and all four collections. The daemon reports journal 0,
namespace `ready`, pending-sync false and last-snapshot `isolated-worker`.
An independent remote-replica read, process-kill recovery and availability SLO
were not established. Evidence: `docs/evidence/meiji-state-bootstrap-20261116.json`.

The folder-location question is resolved by this new-state choice. It does
**not** restore the former execution/admin keys or reconnect existing guests.
Current local identities and existing guest keys/disks are retained in their
managed application directories. Production migration remains open on original
key/config recovery or a reconciled identity/authority recovery, followed by
guest scheduler and bounded jacob inference qualification. Do not point the
live scheduler at an empty WebDAV directory or place plaintext keys there.
