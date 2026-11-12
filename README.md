# awai-os

**Native Murakumo NixOS preview:** [profile, Itonami launcher and VM gates](docs/murakumo-nixos-native-preview.md).
It runs Kaikei and Dandori judgment cores in browser Workers and a native host
observer under systemd. It is an independent VM/live candidate; full network
Node/Cell integration and physical hardware remain separate acceptance work.

For installed native systems, see [network updates and retained-generation
recovery](docs/native-network-updates.md). This opt-in SSH/Nix/UEFI route is
separate from the historical updater below; it is disabled on live USB media
and does not provision remote access or release keys.

The [0.1.1 live media candidate](docs/native-media-0.1.1.md) includes those
update tools, the installed-profile source bundle and its guide. The actual
ISO has a separate UEFI boot, browser-readiness and no-disk-write VM gate.

NixOS installation media and Murakumo Client setup for Awai Nodes.
NixOS is the current operating system. Murakumo Client names the software suite;
Awai Node names a participating instance or host. AiueOS is an unfinished
future OS intended to replace NixOS, not the OS delivered by this installer. This repository owns the OS installation boundary: boot media, disk
selection, target configuration, recovery and rollback. The ISO opens a guided
installer on boot: choose Wi-Fi, Ethernet or offline continuation, then select
and approve the internal disk. The bundled OS
is copied and installed without Internet or host-side compilation. Registration
opens the same network guide after the installed PC boots. See
[network onboarding](docs/network-onboarding.md).
The [account-linking guide](docs/account-onboarding.md) continues through a phone
QR, Passkey approval, cancellation/retry and saved versus online-verified status.
The [native graphical guide](docs/graphical-setup.md) describes the new disk cards,
selected-disk confirmation and UUID-based boot routing.
See [the guided installation procedure](docs/automatic-install.md). Initial
password entry is no longer required; see [password-free verification](docs/verification-passwordless-2026-10-05.md).

Status: guided disk installation and account onboarding were added on 2026-10-05. See
[the account onboarding verification record](docs/verification-account-onboarding-2026-10-05.md) for the
reviewed source, ISO hash and VM checks. Physical PC installation, real phone
Passkey linking and inference still require separate verification. The
[2026-09-26 record](docs/verification-2026-09-26.md) describes the earlier manual
installation image.
The device-claim agent, local model-readiness check and `community.nix`
template were last built and booted in the BIOS and UEFI QEMU checks of
[the 2026-09-30 record](docs/verification-2026-09-30.md), against an older
revision; an ISO from this combined source has not been built.

Phone-only setup, Wi-Fi provisioning, Kotoba authority pairing, remote model
download and model switching are not present in this source. A read-only local
inference check and a factory device claim responder for `murakumo.cloud` are
included in the revised image. Neither component installs or starts a model server.
The target flow and qualification gates are recorded in
[headless phone setup](docs/headless-phone-setup.md).

## Build the bootable ISO

On a NixOS or Linux machine with Nix, use a clean installer checkout and a
clean nixpkgs checkout at the exact commit in
[`nixos/nixpkgs-revision.txt`](nixos/nixpkgs-revision.txt). Run the local
release gate; GitHub Actions is not required:

```sh
./scripts/release-iso.sh /absolute/path/to/nixpkgs /absolute/new/evidence-directory
```

The [VM release gate](docs/vm-release-gate.md) must pass against the same source
and package pin before ISO creation or system-export publication.
The gate runs the factory-claim and model-readiness tests, builds
`result/iso/*.iso`, then records the ISO SHA-256, size, installer commit and
nixpkgs commit in the new evidence directory. `scripts/build-iso.sh` remains
available for development builds, but accepts any reviewed full nixpkgs commit
and does not create a release identity record. The local identity files are
not signed fleet receipts or replicated ISO storage; publication still needs
those independent checks. Review the recorded ISO identity before writing a
USB stick. Use the
[official NixOS installation manual](https://nixos.org/manual/nixos/stable/#sec-installation)
for USB writing, partitioning, mounting and `nixos-install`. An ISO built from
this source includes the read-only preflight and local-inference checks,
device claim agent and target templates under `/etc/murakumo/`,
and the guided installer, but does not run an install automatically.
Previously written USB sticks must be rewritten with the new ISO separately,
after confirming and approving the USB's erasure.

## Install a target host

The normal path is now [guided installation](docs/automatic-install.md).
The steps below are the manual recovery/custom configuration path.

1. Boot the USB media. Run `sh /etc/murakumo/preflight.sh` to inspect boot
   mode, disks, network interfaces and GPU devices.
2. Identify the intended disk and a recovery path. Partition and mount it
   following the official manual. A wrong disk choice destroys data.
3. Run `nixos-generate-config --root /mnt`. Keep the generated
   `hardware-configuration.nix` for this host.
4. Copy `node-base.nix`, `community.nix`, `node-readiness.mjs`,
   `device-claim.mjs`, `node-provider.nix`, `node-claim.nix`, `console-ui.nix`,
   `offline-base.nix`, `offline-uefi.nix`,
   `offline-bios.nix`, `network-setup.mjs`, `setup-ui.mjs`, `registration-ui.mjs`,
   `account-link.mjs`, `local-setup.mjs`, `language.mjs`, `graphical-ui.js`,
   `graphical-dialog.mjs`, `murakumo-logo.svg`, `acoustic-code.mjs`,
   `setup-sound.mjs` and `sound-link.html` from `/etc/murakumo/` to
   `/mnt/etc/nixos/`, along with
   an edited `configuration.example.nix` renamed to `configuration.nix`. For
   the guided network screen, set `networking.networkmanager.enable = true`
   and `networking.useDHCP = false` in that edited configuration. Set a real
   SSH public key, confirm UEFI or replace the boot loader settings, and review
   the network and filesystem configuration before `nixos-install`.
5. Reboot from the installed disk. Confirm remote access and RADV/Vulkan on
   physical hardware. Install and start a reviewed OpenAI-compatible model
   server and model separately. Run the local inference check with its exact
   model ID (shown by its `/v1/models` endpoint):

   ```sh
   node /etc/murakumo/node-readiness.mjs --model YOUR_MODEL_ID --local-url http://127.0.0.1:11434/v1
   ```

6. Install the node CLI from
   [cloud-murakumo-installer](https://github.com/network-awai/cloud-murakumo-installer).
   Follow the [buyer and operator path](docs/buyer-operator-path.md) for local
   AI access, optional community participation and account boundaries.

Factory provisioning is a separate operator step after installation: generate
one device key and one label per shipped unit with
`sudo node /etc/murakumo/device-claim.mjs provision --model 'Murakumo 2609'`.
The command prints a claim URL and registration JSON containing the factory
token. Keep that output private; print the URL as the unit's QR label and
register the JSON through the operator-only `murakumo.cloud` device API near
dispatch. The node must never hold that API's admin token. See the
[buyer and operator path](docs/buyer-operator-path.md) for the exact boundary.

## Opt in to idle inference after buyer claim

The base profile leaves every claim and provider unit disabled, including the
standalone `murakumo-device-claim` agent. Before shipping, provision each
physical device with its own DID and Ed25519
private key, register that DID and its matching claim token with the site, and
put the claim URL or QR code on that device's label. The factory key must never
appear on the label or in the Nix store. The registered DID and device identity
must match. This process still requires a real device and site registration;
installing the OS alone cannot produce a claimable unit.

Once the CLI release is published, install its verified launcher outside home
directories so the restricted service can run it:

```sh
sudo env MURAKUMO_INSTALL_DIR=/opt/murakumo-cli \
  MURAKUMO_BIN_DIR=/opt/murakumo-bin sh install.sh
sudo test -f /var/lib/murakumo/device-identity.json
sudo env MURAKUMO_NODE_IDENTITY_FILE=/var/lib/murakumo/device-identity.json \
  /opt/murakumo-bin/murakumo node doctor \
  --model YOUR_EXACT_MODEL_ID --local-url http://127.0.0.1:11434/v1
```

The factory identity file must be private (mode `0600`) and match the DID
registered for this physical device. Never replace it with another identity
after the buyer claim. To let the device answer the buyer's short-lived claim
challenge, enable the responder on the target after the published CLI is
installed:

```nix
services.murakumoClaimResponder.enable = true;
```

Run `sudo nixos-rebuild switch` and check
`systemctl status murakumo-claim-responder.timer`. The timer calls
`murakumo node claim-once` every 15 seconds and signs only the pending
challenge for this DID. It uses systemd's private credentials and does not
require a model server or buyer password. The buyer must still complete the
claim in their browser. A local `claim-once` success only proves that the
device responded to a challenge; it does not prove that ownership changed.

The standalone agent needs no CLI: `services.murakumoDeviceClaim.enable =
true` runs `device-claim.mjs serve`, which answers the same buyer challenge
and sends signed liveness heartbeats. Enable exactly one of
`services.murakumoClaimResponder` and `services.murakumoDeviceClaim`; the
node profile asserts they are mutually exclusive so one device never answers
the same challenge twice.

After the buyer claim and a local `doctor` check, an exact model must be
running locally before idle inference can be enabled. Add this to the target's
`configuration.nix`:

```nix
services.murakumoProvider = {
  enable = true;
  name = "murakumo-node";
  model = "YOUR_EXACT_MODEL_ID";
  localUrl = "http://127.0.0.1:11434/v1";
  idleOnly = true;
};
```

Run `sudo nixos-rebuild switch`, then inspect
`systemctl status murakumo-provider` and
`journalctl -u murakumo-provider -b`. The unit waits for the network, restarts
after a failure and reads the identity through systemd's private credentials.
It does not download a model, bypass admission or guarantee a paid job. If the
model server needs a private API token, configure that separately before
enabling the service; this template does not embed one in the Nix store.

`services.murakumoCommunity` is an alternative join unit that runs
`node-readiness.mjs` before `murakumo node join --idle-only`. Enable exactly
one of `services.murakumoProvider` and `services.murakumoCommunity`; the node
profile asserts they are mutually exclusive.

The 2026-09-26 NixOS 26.05 VM pilot booted and ran Murakumo CLI help with an
llvmpipe GPU, and the 2026-09-30 pilot booted with an emulated GPU. Bare-metal
Radeon 680M, Prism Vulkan, model throughput,
concurrency and restart recovery remain unverified. Keep the serving Ubuntu
installation until those checks and a recovery plan succeed.

`cloud-murakumo-installer` owns the macOS/Linux CLI installation script;
`awai-os` owns NixOS boot media and OS installation.
Windows node installation is a separate future platform path and is not
advertised as supported by the current CLI script.

## Passwordless account registration

The example enables `services.murakumoAccountLink.enable`. On the installed system,
TTY1 shows a five-minute QR/device code and the public Device ID. Scan it with a phone,
compare the full Device ID, and open the canonical `auth.kotoba.cloud` signer.
Approve with a user-owned Base-account Passkey or an external wallet connected
through Privy. Privy sessions and historical cookies do not grant Node ownership.
The node does not request an account ID/password. Administrative SSH access is configured
separately with the operator's public key; account linking does not grant remote shell access.

The node keeps a local signing key with mode 0600 and a public registration receipt.
Before saving ownership it independently verifies the user proof against the
original Node, flow, challenge and expiry, including current Base-chain verification.
A server `registered` projection alone is refused. The generated verifier's
source commit and digest are recorded in `nixos/node-root-receipt-provenance.json`.
On reboot it loads the previously verified local record and checks online status;
this is not a fresh user ceremony or a claim of fresh chain verification on every boot.
Legacy receipts are preserved but require fresh user proof. Revocation fails closed; an intentional local
relink uses `node /etc/murakumo/account-link.mjs --relink`, preserving the device key.
No model service or fleet worker is enabled by account linking.

This requires the matching dedicated registration Worker, canonical signer and
database migration to be published. Synthetic proof qualification exercised the
compiled verifier and Node persistence with live Base RPC and an unfunded test
wallet; its registration transport was a fixture. It does not verify a real
phone Passkey ceremony, deployment or fleet admission.

Run `node --test test/*.test.mjs` for registration and offline/disk safety tests.
On Linux with the pinned NixOS channel, run `bash scripts/check-install-config.sh`
to parse and evaluate both generated boot configurations with Nix.

## Product names and roles

- **NixOS**: current operating system, installation and system updates.
- **Murakumo Client**: software suite installed and configured on NixOS.
- **Murakumo Daemon**: name for the resident participation process, when supplied.
- **Murakumo CLI**: command interface; **Murakumo App**: user-facing application.
- **Awai Node**: running participant, host and its observed status.
- **AiueOS**: future replacement OS; incomplete and not delivered here.

The journey is **Install NixOS → Set up Murakumo Client → Participate as a
Awai Node**. Local configuration and account linking alone do not prove a
running daemon, inference readiness or fleet admission. See
[naming and compatibility](docs/product-naming.md).

## Local setup and startup language

Startup offers Japanese and English. The installed guide can complete local setup
without a phone, an account or Internet, preserving its device identity across boots.
Account linking remains an explicit later choice. See
[local setup](docs/local-setup-and-updates.md) and [the integrated update lifecycle](docs/os-update-lifecycle.md).
Signed OS update services require owner provisioning; see [operations](docs/update-operations.md).
Updating a USB does not update an
already installed PC.

## Setup audio

The startup language page plays a quiet, original ambient piece with a visible
stop/replay control. The QR page can send the same expiring approval code by sound.
See [sound linking](docs/sound-linking.md) for the included companion reader,
Passkey approval boundary and public-release/physical-phone qualification gaps.

## Bluetooth Wi-Fi provisioning

The network chooser offers Bluetooth when a controller is present. Opening it
creates a ten-minute, one-use secret shown locally as a QR code or a masked key.
The companion encrypts Wi-Fi credentials with HKDF/AES-GCM before sending
fragmented GATT writes; expired, modified and replayed messages are refused.
Closing the page stops advertising. This transfers Wi-Fi settings only; account
ownership still requires the separate Passkey flow.

`nixos/ble-setup.nix` integrates the services into the next installer build.
`scripts/install-ble-host.sh` installs the Ubuntu adapter on the explicitly
selected existing node. Its services start at boot but do not advertise until
a setup window is opened. `scripts/serve-ble-client.mjs` provides a localhost
companion for Mac Chrome testing; it is not a published phone application.

On 2026-10-07, 6600hs-2 registered the GATT service and started/stopped its
advertisement. The live controller accepted WebCrypto-encrypted, fragmented
settings, reconnected its existing Wi-Fi, refused replay and removed its consumed
secret. That test uses private local IPC, not a Bluetooth radio transfer.
The Mac Bluetooth chooser did not discover the node, so radio transfer and
physical-phone setup remain unverified. An iPhone native companion, public
HTTPS companion deployment, Nix runtime evaluation and USB rewrite are not
included in this host verification. See the machine-readable evidence under
`docs/evidence/ble-setup-2026-10-07/`.

### Kekkai SSH during installation

The live installer and installed client support [8-digit, locally approved
Kekkai SSH](docs/kekkai-install-ssh.md) before Passkey or account registration.
The manager pins the Node certificate and both public keys; approved SSH and
Kekkai identities survive installation and reboot. The release gate tests the
real encrypted overlay with direct LAN SSH blocked.
