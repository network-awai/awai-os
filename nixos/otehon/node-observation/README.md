# Bounded guest observation — Otehon

AWAI-2795 found real Awai QEMU VMs on two Mac mini hosts while the node account's
Lima inventory was empty. Their live arguments expose neither guest forwarding
nor a monitor. This opt-in channel qualifies guest observations without opening
SSH, TCP services or a general guest command executor.

`node-observation.nix` defaults off. When enabled it uses pinned Nixpkgs' QEMU
Guest Agent with a positive list of seven observation/synchronization RPCs.
QEMU documents that an allowlist blocks all other RPCs by default:
[QGA options](https://www.qemu.org/docs/master/interop/qemu-ga.html).
The module does not enable cron, node admission, replication or remote effects.

`observation-vm.nix` is an isolated minimal qualification profile, not an upgrade
of a running desktop. `observation-launch.sh` starts only that caller-selected
test image, with one vCPU, 1024 MiB RAM, no NIC, no monitor and a new private
directory for its Unix socket, PID and serial log. It refuses existing state.
Use a task-owned overlay over a freshly exported immutable image; never copy a
running desktop disk or boot a shared base image writable.

```sh
nix-build nixos/otehon/default.nix --argstr profile observation-vm --no-out-link
nix-build nixos/otehon/node-observation/check.nix --no-out-link
sh nixos/otehon/observation-launch.sh /absolute/test-overlay.qcow2 /absolute/new-private-run
```

From another terminal, change into that private run directory and invoke:

```sh
node /absolute/repository/nixos/otehon/bot-fleet/observe-guest.mjs guest.sock
```

The relative socket address avoids macOS Unix socket path-length limits in long
worktree paths. The observer refuses a non-private or foreign-owned directory,
a non-socket endpoint and an agent advertising enabled commands outside the
observation list. It bounds time and bytes and synchronizes with a random nonce,
discarding stale pre-sentinel responses as specified by the
[QGA protocol](https://www.qemu.org/docs/master/interop/qemu-ga-ref.html#command-guest-sync-delimited).
No generic RPC/exec interface is exposed by this helper. Interface addresses,
MAC addresses, hostnames and raw agent payloads are omitted from its report.

Stop only the task-owned qualification process after verifying its PID and image
argument; preserve images/logs as evidence. No change to an existing VM, app
installation, desktop image or network route is implicit. Enabling this module
in a live deployment needs its own reviewed release/cutover. Guest observations
remain separate from peer connectivity, authenticated admission, durable cursor,
effect fencing, model inference and distributed Bot execution acceptance.
