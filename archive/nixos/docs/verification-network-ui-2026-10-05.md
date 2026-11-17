# Guided network onboarding verification — 2026-10-05

Runtime source: `bc7ea27` (following `ea07fa7` and `eb57492`). Nixpkgs revision:
`f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`. This is local QA; no push,
PR, merge, production deployment or new USB write is part of this record.

## Scope

The installer and installed OS now share a Japanese Wi-Fi / Ethernet / offline
chooser. Wi-Fi scan, masked secret entry, saved connection reuse, separate local /
Internet / Murakumo reachability, retry and deferred registration are provided
without maintenance commands. The installed offline screen explicitly says that
OS installation is complete and account registration remains pending.

Japanese fonts and a framebuffer renderer are bundled in both installed OS
closures and the ISO. Consoles without a usable framebuffer fall back to English.
The renderer runs once; fallback is permitted only if its child never started.
A started installer is never automatically repeated. Maintenance is Alt+F2.

## Completed source checks

- `node --test test/*.test.mjs`: 23 passed, 0 failed, including registration
  identity / approval checks, disk exclusion and identity rechecks, network
  failures, delimiter-containing SSIDs, secret stdin handling, and saved-connection
  readiness changing while the chooser is open.
- Syntax checks of the installer and installed setup entry points passed.
- Full generated BIOS and UEFI NixOS configurations evaluated successfully.
- A WPA2 `mac80211_hwsim` fixture, confined to the QA VM, completed its key
  handshake and DHCP lease using SSID `Murakumo-QA:WiFi`. Its local-only connection
  was correctly shown as connected locally, with Internet and Murakumo unavailable.
  The QA AP's DHCP server required stopping the firewall inside the isolated QA VM;
  this does not change the shipped configuration. No physical radio or router is
  qualified by this fixture.

- An installed-system preview using the corrected `bc7ea27` setup entry point
  reconnected to the preserved WPA2 fixture without reentering its password.
  The copied NetworkManager profile remained `0600 root:root`.
- A wired QEMU NIC with the shipped firewall enabled skipped network / password
  entry and showed successful Internet and Murakumo HTTPS reachability. “Register
  later” was selected; no production registration POST was made.
- An ANSIUTF8 QR fixture rendered through the shipped font / framebuffer settings
  decoded to the exact input URI using Apple's Vision CPU path. This tests screen
  rendering, not a phone camera or an account approval.

The Wi-Fi scan / password / DHCP media run used the unmodified `ea07fa7` ISO;
its network module is unchanged in `bc7ea27`. Installed preview checks replaced
only the setup entry point, to verify the fixed `/etc/murakumo/` imports before
rebuilding. These preview checks do not replace the final unmodified-ISO checks
below.

## Artifact and final media checks

Final artifact:
`/Users/junkawasaki/github/murakumo-usb-auto-install-qa/murakumo-network-ui.iso`

- Size: **2011299840 bytes**.
- SHA-256: `d325dcc764b3af9ee3df55cafe8b0eba6a00b61319555718a3530ec198009432`.
- Linux builder and Mac copies have the same hash; build exit was 0.
- Final unmodified ISO booted using UEFI with `-nic none` and showed the Japanese
  connection chooser. Offline continuation reached disk review and the explicit
  erase phrase for a new, task-owned 24 GiB NVMe fixture (`NETUIQA-FINAL`).
- Offline installation completed without a NIC, downloads or target-side builds.
  The completion screen instructed removal of the USB before reboot.
- The same installed NVMe booted with no ISO and no NIC. The Japanese network /
  registration chooser appeared automatically. “Register later” showed the
  completed-installation screen with connect/register and shutdown actions.
- The installed service was `active/running`, with `NRestarts=0`, no failed units,
  `ProtectSystem=strict`, its private runtime directory, locked root password and
  no SSH service. Installed UI code matched both retained `/etc/nixos/` sources
  and the frozen QA copies. No preview overrides or bind-mounted code were used
  in this final run.

Small checks and screenshots are committed in
[`evidence/network-ui-2026-10-05/`](evidence/network-ui-2026-10-05/).
The ISO and owned VM disks remain local outside source control. The final run
qualifies UEFI/NVMe; BIOS configurations evaluated, but the new network UI's BIOS
boot was not repeated. The prior offline installer record retains its separate
BIOS/virtio installation qualification.

The final shutdown action powered off the installed QA VM. All six task-owned
builder / media / installed / wired QA VM processes were closed; their PID files
were absent at closeout. Other user VMs and applications were not operated.
The ISO, owned VM disks and detailed logs are preserved for a restartable check.

## Remaining boundaries

No real account or phone Passkey ceremony was completed. The matching frozen
Worker / Portal registration routes and migration remain unpublished in this
local task. HTTPS reachability alone does not establish that registration API's
availability, account linking or model inference. Physical Wi-Fi hardware / driver
compatibility, physical disk installation and Murakumo fleet inference require
separate checks. The new UI ISO has not been written to KIOXIA.
