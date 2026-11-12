# Approved Itonami Otehon execution ledger — AWAI-2795

Owner approved etcd on 2026-11-12; ADR0026 D3 change is network-awai-apex PR185.
The deployed control plane uses **levi / benjamin / joseph**, three separately
verified Mac mini identities, etcd3.6.14 and certificate-authenticated peer/client
TLS on their existing Tailscale addresses. The existing Awai guests are preserved.
This is a host control-plane role, not an OS guest update or full Bot fleet launch.

`sources.json` pins the official Darwin ARM64 ZIP/digest and exact Itonami source
revision02828b67ae0219d37c265960ffc7a71e102e7e62/archive digest. No update-to-latest
path exists. Source installation verifies the archive and rejects unsafe members.

## Provisioning and key custody

Run operator tools from the repository root. They are one-shot administration,
not a Python app/Bot runtime or a Native build/gate/fallback. The running server
is the pinned etcd binary; the worker protocol is Itonami Otehon `.cljc` on BB.
The administrator must supply verified private inventory files in `.agent-output/`:
`etcd-preflight.json` (the selected aliases/IPs, hardware digests and free-port
observations) and `ten-mac-mini-runtime-20261112.json` (independent prior identities).
The provisioner compares them and refuses unexpected or existing state.

```sh
bb nixos/otehon/bot-fleet/etcd/provision.clj prepare
bb nixos/otehon/bot-fleet/etcd/provision.clj pki
bb nixos/otehon/bot-fleet/etcd/provision.clj activate
bb nixos/otehon/bot-fleet/etcd/bootstrap-auth.clj
bb nixos/otehon/bot-fleet/etcd/issue-worker-certs.clj
bb nixos/otehon/bot-fleet/etcd/install-peer-runtime.clj
```

These are ordered, initial-deployment stages, **not a command to rerun on the
live cluster**. Existing paths, keys, auth state, manifests or services refuse
blind overwrite. Partial state is preserved for reconciliation. Each remote
operation needs an exact node + semantic success envelope: this SSH environment
can return transport exit0 even when the remote application failed.

- Peer and client CAs are separate. Node server/peer/worker keys are generated
  on each owning node and never copied off it. Operator CA/root and local worker/
  observer keys remain in the existing Itonami application credential directory.
  Credentials/keys/raw transcripts never belong in Git or Linear.
- Root bootstrap is certificate-based; worker users cannot write enrollments.
  Workers read enrollment and read/write cursor/run state; observer credentials
  are read-only. These are trusted host-worker credentials, never exposed to a
  model/profile/browser. This is a crash-fault/public-payload deployment, not a
  permissionless Byzantine or private-output authorization claim.
- Use the pinned **etcdctl gRPC** transport `itonami.otehon.etcd`: HTTP gateway
  does not provide certificate-CN RBAC and is disabled. Every worker pins its
  executable SHA, CA, certificate identity,3 endpoints and cluster ID.
- Host public configuration/source capsule is under the canonical github
  workspace; managed credentials, WAL/database and logs remain in Itonami's
  application directories. The launchd label is `network.awai.otehon.etcd` in
  the owning user's **Background** domain. `LimitLoadToSessionType=Background`
  is required for these headless accounts. No GUI, sudo, host reboot, SSH change
  or existing VM change was used. Service restart is tested; machine cold boot
  is not qualified.

`control.py` changes only that exact task-owned label after checking the
manifest/owner, and confirms loaded/listening state. It must never be used as a
host/guest reboot or general service manager. `grpc-only.py` updates only the
owned gateway flag with preserved before-image and atomic replacement.

## Verified state

`docs/evidence/itonami-etcd-three-mac-mini-20261112.json` records scoped RBAC,
cross-host contender results, original-owner reconciliation, actual leader/quorum
loss, persistent3-process restart with member/auth preservation, and a real Muse
worker's interrupted-publication recovery against the physical quorum. Only new
owned etcd services were stopped; all were restored and healthy afterward.
The first deterministic fixture's unsupported BB FileDescriptor.sync stopped
publication after its marker; the durable claim froze correctly. Its original
owner reconciled from that marker without another effect. The corrected fixture
uses FileChannel.force; its next explicit slot had one effect across two hosts.
These fixture effects are not model calls. Actual Muse run counters and the
integration-only scope are in `itonami-runtime-receipts-20261112.json`.

Unknown results never expire into a second attempt; recovery uses the original
owner/token/transcript. The test schedule is explicitly enrolled public intervals,
not the imported Bot schedules. No VKE, arbitrary profile scripts or external
Linear/Git effect tools are enabled. The899 registered profiles remain separately
tracked, with their original individual schedules/disabled states preserved.

Remaining acceptance: per-Bot Muse authorization, active Issue/capability/timebase
binding and cron executor rollout; continuous Soshiki transport; private encrypted
Awai FS output; machine cold boot/power loss; reviewed off-host backup/restore and
PKI rotation. Leaf certs last90 days and the dedicated CAs365 days; automatic
renewal is not configured. Current pointwise3/3 health and process-restart checks
are not availability percentages, RPO/RTO measurements or permanent reliability.
