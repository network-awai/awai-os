# Itonami Mac mini runtime observation — 2026-11-12 JST

AWAI-2795, related C1 preflight AWAI-2773. Existing trusted SSH to the two
previously selected aliases was used for read-only inspection. No VM, service,
network configuration, credentials or bot schedule was changed.

| Observation | levi | benjamin |
| --- | --- | --- |
| Hardware | Mac mini, Mac16,10, 16 GB | Mac mini, Mac16,10, 16 GB |
| Host identity | Distinct from the other host | Distinct from the other host |
| Awai QEMU process | Present, named Awai | Present, named Awai |
| VM allocation | 4 vCPU, 4096 MiB | 4 vCPU, 4096 MiB |
| Network argument | user-mode NAT | user-mode NAT |
| TCP forwarding argument | None observed | None observed |
| Monitor argument | none | none |
| node-account Lima inventory | Empty | Empty |
| Guest health / peers / bot execution | Unverified | Unverified |

Host identity was compared using hashes retained only in local task evidence;
raw machine identifiers, process arguments, filesystem paths and credentials
are omitted here. Evidence was collected with Python 3 one-shot read-only host
probes: `system_profiler SPHardwareDataType -json` (selected fields only),
`sysctl -n hw.model`, process-name inventory and allowlisted QEMU argument
extraction. No guest command, model request or fault injection was performed.

The two Awai VM processes are real. Empty Lima inventories do not contradict
them: these VMs run directly through QEMU. The source desktop profile has
loopback Zenoh endpoints (`nixos/otehon/desktop.nix`) and the source macOS
launcher defaults to NAT (`nixos/otehon/macos-app/launcher.sh`); source settings
alone do not establish the exact running guest image or its peer state.

The next integration needs a bounded guest-observation channel and a qualified
node execution/peer path. The current live VM arguments provide neither an
incoming guest channel nor an enabled monitor. Do not infer distributed Bot
execution, replicated Awai FS, inference or failover from these observations.
Do not stop or expose the existing VMs as a side effect of collecting evidence.

## Full deployed Mac mini set

The existing deployment owner issue is AWAI-433 (formerly JUN-318). Its recorded
ten-host set was refreshed using the same read-only probe, existing SSH trust,
and no guest commands or state changes. All ten hosts reported Mac mini hardware
and a QEMU process named Awai. The ten retained hardware identity hashes are
distinct. The image-parent naming also matches the old JUN-318 deployment;
this does not establish the exact image contents of each running guest.

| Deployed host | Host observed | Awai QEMU processes |
| --- | --- | --- |
| joseph | yes | 1 |
| asher | yes | 1 |
| benjamin | yes | 1 |
| dan | yes | 1 |
| issachar | yes | 1 |
| judah | yes | 1 |
| levi | yes | 1 |
| naphtali | yes | 1 |
| simeon | yes | 1 |
| zebulun | yes | 1 |

The other owner's jacob preview was not changed. Current process presence is
verified for all ten; GUI health, authenticated guest access, peer connections,
replicated state, distributed Bot work and restart continuity are separate
unverified properties. Historical notes about desktop/network faults or a
successful old setup were not substituted for live observations.

## Separate candidate qualification

A new opt-in read-only guest-agent channel was built with the repository's
Nixpkgs pin (`f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`). The default desktop
configuration leaves it disabled. Its positive RPC allowlist excludes guest
exec, file writes, time changes and shutdown. The host observer refuses agents
advertising broader enabled commands and refuses non-private socket directories.

The minimal `observation-vm` image was built through the existing pinned Nix
container and cache, then exported as a compressed raw image. Export SHA-256:
`dc20e34a9ca7784673f82fa009c2b9de2490bba4813e7ce3348172d0850b7495`.
The image is a qualification artifact, not a signed desktop release.

One separate overlay VM was booted locally and then on each Mac mini, using
1 vCPU, 1024 MiB, no NIC, no monitor and an owner-private virtio serial socket.
Both remote image/script digests were checked before execution. Observations:

| Qualification result | levi | benjamin |
| --- | --- | --- |
| Read-only guest response | Succeeded | Succeeded |
| Observed OS | NixOS 26.05 | NixOS 26.05 |
| Guest agent | QEMU 10.2.4 | QEMU 10.2.4 |
| Interfaces | loopback only | loopback only |
| Test process after qualification | Stopped | Stopped |
| Pre-existing Awai VM after qualification | Still present | Still present |

The source observer was also tested against stale/parser-error frames before
the QGA synchronization sentinel, a wrong nonce, an agent exposing guest-exec,
and a public socket directory. The actual local guest exposed a stale parse
error on the initial flush byte; sentinel/nonce synchronization was corrected
and the real probe then passed. Missing/failed initial observations were not
counted as successes.

Remote host tools: Node 26.5.0 and QEMU 11.1.3. The image's QGA is 10.2.4.
One-shot Python host probes, source tools and generated artifacts remain in
task evidence; no credentials, private profile payloads or source stores were
transferred. All qualification images/logs are retained in task-owned workspace
directories. Only the new test QEMU processes were stopped.

This qualifies a read-only observation channel on two physical hosts. It does
not qualify the old live guests' contents, inter-node traffic, grants, atomic
occurrence/cursor admission, effect fencing, inference, Bot cron or failover.
