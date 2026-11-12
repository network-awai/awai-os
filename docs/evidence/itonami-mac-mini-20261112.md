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
