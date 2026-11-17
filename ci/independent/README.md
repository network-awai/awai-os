# AWAI-2987: isolated ARM qualification on a Tailscale Mac

This is an operator-owned executor for Otehon evaluation/core tests. It is not
an x86/KVM installer, Native, release signer, production scheduler or full CI
replacement. Never weaken `archive/nixos/scripts/ci-otehon-vm-local.sh` to admit this host.

Create a **new** Lima instance from `lima-arm64.yaml` on the reviewed Mac.
The profile has no host mounts, agent/X11 forwarding or published guest ports.
Only use `run-offline-otehon.sh` inside that dedicated disposable guest; it
checks a root-owned executor marker before stopping the guest's Nix daemon.
It never operates on the Mac's or an existing VM's services.

Deliver public input files over existing Tailscale SSH, without GitHub/B2 keys.
The input directory contains `source.tar.gz`, `nixpkgs.tar.gz`, `inputs.json`.
The source archive must contain a clean `source/` Git checkout with a real
reviewed HEAD and no remote or credentials. The lock has this structure:

```json
{"schema":"awai.ci.local-inputs.v1","sourceRevision":"FULL_REVIEWED_COMMIT","files":{"source.tar.gz":{"bytes":123,"sha256":"64_HEX"},"nixpkgs.tar.gz":{"bytes":456,"sha256":"64_HEX"}}}
```

Pin the lock SHA256 independently on the controller, then run as `awai-ci`:

```sh
python3 admit-inputs.py /absolute/inputs CALLER_PINNED_LOCK_SHA256
```

Admission hashes the actual archives, rejects traversal/unsafe tar members,
extracts into a new directory and verifies Git HEAD/clean state. A prior Nix
cache cannot substitute for this raw-input verification.

Bootstrap dependencies explicitly while connected using the pinned local
nixpkgs archive: runtime buildEnv named `awai-ci-runtime` containing nodejs_22,
python3 and git, npm's locked packages, the four test derivations and the full
`scripts/ci-otehon-local.sh`. Store the resulting runtime store path in
`inputs/runtime-path.txt`. Bootstrap can fetch public dependencies; it is
not an offline pass. Preserve its source/revision/digest/download record.
Move any generated untracked files outside the source before qualification;
never discard unknown WIP or relax the clean-source check.

Run the offline gate from a root controller in this dedicated guest:

```sh
sudo bash run-offline-otehon.sh /absolute/inputs FULL_REVIEWED_COMMIT /absolute/NEW_EVIDENCE
```

The controller creates a network namespace with loopback only and a private
Nix daemon inside it; tests run as `awai-ci`. External substitutes are disabled
for this phase. Missing inputs fail closed. Four test derivations receive a
fresh execution ID so their tests execute again rather than accepting outputs
from bootstrap. The existing Otehon local gate then runs unchanged. Inspect
`build.log` and `result.json`; a process start or dependency bootstrap is not
a passing result. Keep failed attempts in separate evidence directories.

Observed 2026-11-16 on jacob: reviewed source
`8673a587668077513bc7292087a0005d51c5cf91` passed the full local gate in an
isolated ARM guest. This includes 26 storage tests/161 assertions, 30 crash
cases, C1/replica checks, shell/mobile/Saifu checks and profile evaluation.
Some bootstrap sources still originated on GitHub. A redistributable input
and dependency closure, scheduling, all other workflow lanes and x86/KVM
installer/reboot evidence remain separate outstanding work. GitHub Actions
stays disabled. No claim of production cutover or GitHub-free source hosting.

## Coverage against the workflow inventory

Inventory: main `7a18e4f` (2026-11-16), eleven workflow files. These are
verification lanes, not equal-sized units; do not turn the row count into a
completion percentage. Repository Actions is disabled independently of these
retained definitions.

| Existing lane | Non-GitHub execution evidence / remaining work |
| --- | --- |
| `nixos-module.yml:otehon` | Local **subset** passed on ARM as above. The wrapper omits bot-fleet, node-observation, bot-chat and Meiji checks currently present in the workflow. It is not full job parity. |
| `nixos-module.yml:itonami-gms-core` | No independent execution evidence in this unit. |
| `nixos-module.yml:forest-writer-linux` | No independent execution evidence; Linux-amd64 Forest binary still comes from a GitHub release and must be mirrored with both pinned digests. |
| `nixos-module.yml:evaluate` | Native build/evaluation remains separate; no qualification from the Otehon ARM result. |
| `otehon-storage-reboot.yml` | Local VM entrypoint exists; x86/KVM execution pending. |
| `otehon-drive.yml` | Local VM entrypoint exists; x86/KVM execution pending. |
| `otehon-network-update.yml` | Local VM entrypoint exists; x86/KVM execution pending. |
| `otehon-usb-installer.yml` | Installer/installed boot/reboot not qualified on this ARM executor; fixed ISO inputs, scratch disks and x86/KVM remain required. |
| `otehon-lan-diagnostic.yml` | Independent image build/browser/diagnostic/VM lanes not qualified. |
| `otehon-lan-install.yml` | Independent installer/boot evidence and keyed candidate distribution pending. |
| `otehon-lan-recover.yml` | Qualified source/image byte-identity and recovery delivery pending. Archive ZIP restoration is a separate test. |
| `otehon-yotei.yml` | Independent execution pending. |
| `otehon-k3s.yml` | Independent multi-VM/KVM execution pending. |
| `sanka-vm-gate.yml` | Independent contract/VM execution pending. |

Manual operator execution, dependency bootstrap, an automatic scheduler,
artifact transport, signing, promotion and production cutover remain distinct.
The new runner proves one bounded execution path; it does not mark the entire
migration or all existing checks complete.
