# AWAI-2933 identity enrollment verification — 2026-11-15

Tracking: [AWAI-2933](https://linear.app/kotobalabs/issue/AWAI-2933),
mail integration [AWAI-328](https://linear.app/kotobalabs/issue/AWAI-328),
[source PR95](https://github.com/network-awai/awai-os/pull/95).

## Implemented and enabled

The owner-host service runs executable revision
`fdb05ab1c24b44560484cbaf1ca4cfae767861c6`. Identity/custody/recovery/mail domain
logic is CLJC under `otehon/bot-chat/src/itonami_identity/`. The previous
MJS mail domain implementation is removed; existing Node code carries HTTP and
process transport. Browser controls are ClojureScript.

The digest-pinned owner configuration approves 899 profile IDs from its verified
private manifest. Startup/reconciliation registers those subjects, stores
principal UUID/DID bindings in encrypted Kotobase over AwaiFS, and checks
authenticated etcd registration CAS. New profile IDs require an owner-approved
policy update; unsigned public reports and caller fields cannot widen it.
Primary and recovery credentials are held in owner macOS Keychain items.

Observed owner-host results:

| Check | Result |
| --- | --- |
| Registered bindings independently read back | 899 |
| Distinct principal IDs | 899 |
| Distinct DIDs | 899 |
| Bindings unchanged after service restart | all 899 |
| Private HTTPS / Tailscale owner authentication | passed |
| Purpose/counterparty alias issue and stop | passed |
| Exact request replay without another address | passed |
| Owner recovery retains principal, DID and earlier stopped aliases | passed |
| Encrypted Kotobase/AwaiFS readback | passed |

The aggregate binding digest before/after restart matched; no principal IDs,
DIDs, aliases, private purposes/counterparties or credentials are included in
this report. Operational test aliases remain stopped in the private history.
Existing conversation history, original cron schedules and Linear Cycles were
preserved. Enrollment is not evidence that a Bot executed its business work.

Initial five-subject registration/readback took 5,098ms in its explicitly bound
owner-host batch. This is a registration throughput observation, not issue
velocity, an ETA or steady-state capacity. Application model calls in the
identity/API checks were zero; coding-session model/token/cost and active/wait
telemetry remain unknown/shared-unallocated.

## Source and recovery gates

- CLJC: 9 tests, 441 assertions; host regressions: 11; shell: 97.
- Advanced Japanese/English setup and all three advanced builds passed.
- [Exact executable-head CI](https://github.com/network-awai/awai-os/actions/runs/43700361352)
  passed both `evaluate` and `otehon` jobs.
- Separate-process/store tests cover restart, concurrent enrollment, native
  owner export/restore, missing/wrong credentials, forged binding, stale basis,
  inactive aliases, ciphertext canaries and owner allowlist refusal.
- Alias requests are durably encrypted before their pending etcd claim; an
  interrupted operation resumes the same event/address after browser/process
  loss. Latest committed heads reject old snapshots, preserving stop tombstones.
- Real Keychain and authenticated etcd were also checked with synthetic subjects
  before enabling the actual catalog.

## Qualification limits and resume point

The system resolver still returns addresses that differ from this node's
Tailnet IP. Direct correct-IP binding with the same hostname/SNI and certificate
verification succeeds. Root access for the previously deferred split-DNS repair
is unavailable; no resolver, certificate validation, authentication or CSP was
weakened. Soshiki loaded in CUA, but interaction timed out in the browser control
tool. Ordinary-browser end-to-end acceptance remains open after DNS repair.

Addresses are reservations until SMTP/gateway routing is provisioned. No Google
MX changes, live inbound/outbound email, mail read/decrypt/send grants or remote
inference were introduced by this identity work. Recovery export is an explicit
native owner operation; keep its owner key separate from ciphertext. Production
off-host backup, independent hardware/cold OS boot, same-UID isolation and key
rotation beyond epoch0 are not qualified by these checks.

The source PR remains unmerged and has existing integration conflicts. The
implementation issue stays In Progress until the intended merge; owner-host
activation and browser/SMTP qualification are recorded separately. Preserve the
open worktree, unique evidence, previous configurations and source capsules.
