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
