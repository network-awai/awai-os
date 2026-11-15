# K3s inside Awai Otehon OS (AWAI-2959)

This opt-in Otehon NixOS integration is separate from the Native/selfhost
profile. K3s runs inside existing Otehon guests: jacob is the server, dan and
judah are agents. No build/test installs anything on the real fleet.

## Configuration

The desktop exposes `otehon.k3s.role`, default `off`. Off adds no K3s service,
package, firewall rule or data directory. Role selection is OS administration,
not an imported Bot's capability or browser-app permission.

For an image candidate, import the profile with verified guest addresses:

```nix
import ./nixos/otehon/k3s/desktop.nix {
  node = "jacob"; # dan / judah selects agent
  addresses = verifiedGuestAddresses;
  interface = privateGuestInterface;
  tokenFile = "/run/secrets/otehon-k3s-token";
}
```

The corresponding build entry is `nixos/otehon/k3s/build.nix`, taking the same
arguments plus `arch` (`aarch64`, default, or `x86_64`) and `output` (`image`,
default, or `system`). For example, with an operator-owned non-secret guest
address mapping:

```sh
nix-build nixos/otehon/k3s/build.nix --argstr node jacob \
  --arg addresses 'import ./verified-guest-addresses.nix' \
  --argstr interface eth1 --argstr tokenFile /run/secrets/otehon-k3s-token
```

Repeat with `node` set to dan/judah for the workers. Image IDs include the node
name (`awai-otehon-k3s-jacob`, etc.). Building is not deployment and the runtime
token file is never read/copied by the build.

There are no production IP defaults. Mac host LAN/Tailscale addresses are not
guest addresses. Provision the same nonempty root-owned 0400/0600 token file on
all three guests through the existing secret-delivery boundary. Never put token
bytes in Nix, Git, argv, images or the Nix store. This module does not generate
credentials or enroll a tailnet device. The bootstrap token grants server
privileges; keep it out of Bots and browsers.

The candidate composes the existing desktop and encrypted-state modules. It
retains the GUI and selects a 20 GiB root and 16 GiB encrypted state partition
instead of the base fixture's 256 MiB state. This is a new image layout, not a
command to resize/reformat an existing disk. Live adoption requires separately
backed-up and verified state migration. The existing key disk/unlock contract
still applies. Missing keys or a missing/private-token failure block startup.

## Runtime and resources

- Retain jacob's existing 4 vCPU / 4 GiB Otehon allocation for initial
  qualification. Desktop-plus-K3s capacity is not established by an x86 VM test.
  Do not implicitly allocate extra VM RAM on the already swapping Mac host.
- Run normal workloads on dan/judah. A NoSchedule control-plane taint keeps
  ordinary Pods off jacob; privileged operators can override it. No existing
  Bot, schedule, admission/fence or unknown run is automatically migrated.
- The separate K3s SQLite database, secrets and certificates live under
  `/var/lib/otehon/k3s` on the unlocked LUKS state volume. The kubeconfig is
  root-only at `/var/lib/otehon/k3s/admin.yaml`, on that same encrypted volume.
  Existing Bot/Circle etcd remains independent.
- Pinned K3s airgap images are provisioned into the actual encrypted data
  directory. Application images require separate pinning/provisioning. Default
  ingress, service load balancer, local storage and metrics server are disabled.
- Only listed peer IPv4 addresses on the selected guest interface may reach
  VXLAN 8472/UDP and kubelet 10250/TCP. Only peers/explicit management clients on
  that interface may reach server 6443/TCP. No global API port is opened.
  Verify bridged/routed guest connectivity and nonoverlapping guest/Pod/Service
  ranges; existing NAT does not prove cross-host reachability.
- Container logs are bounded. Keep models, business data and observability
  databases on workers/their selected services, separate from cluster state.

The single server is a failure point. Worker processes may continue during an
outage, but scheduling/reconciliation is unavailable. Back up SQLite
consistently together with its server token and node configuration to an
independently retained encrypted destination. Application data needs its own
backup. Reboot is not backup restoration or independent durability. OS rollback
does not reverse K3s database schema: qualify upgrades/restoration separately.

## Checks and evidence

```sh
nix-instantiate --eval --strict --json --expr \
  'import ./tests/otehon-k3s-eval.nix { nixpkgsPath = import ./ci/nixpkgs.nix; }'
nix-build nixos/tests/otehon-k3s.nix --out-link result
```

Evaluation covers both desktop architectures and invalid configurations. The
independent `Otehon K3s VM gate` boots the role/module configuration on isolated
x86_64 KVM, using test-only runtime tokens and real LUKS test disks. It checks
three-node registration, worker Pods, cross-node networking, agent restart,
encrypted server reboot, and missing-token/wrong-token/locked-state/disabled/
firewall refusal. An existing-service sentinel verifies K3s restart does not
restart an unrelated service. Artifacts identify the exact Git revision.

This does not boot the full graphical ARM64 release image, qualify real Mac
capacity or production keys, or perform live cutover. The test has no fleet SSH,
host disks or real credentials. Keep source, evaluation, VM, image build,
physical acceptance and deployment evidence separate.
