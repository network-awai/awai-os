# Guided setup without maintenance commands, 2026-10-06

Runtime source: 964b881 (installer branch codex/automatic-disk-install).

The installed guide owns its network, registration, retry, deferred completion,
and shutdown states. A normal registration error never exits the guide and never
starts a systemd retry loop. Retry is explicit and bypasses repeated network
selection. Defer or QR cancellation lands on the OS-complete page, from which the
owner can connect again or shut down. Unreadable saved receipts block new claims
without deleting identity or account state. Signed registration semantics are
unchanged. Disk installation is not called by this controller.

New offline ISO: /Users/junkawasaki/github/murakumo-usb-auto-install-qa/murakumo-guided-setup-20261006.iso
Size: 2011299840 bytes.
SHA256: ae196687f5677e9f4a12adb2c1b1f1d75d2db38adb9c1d614828927964210188.
Linux builder and Mac hashes match; AUTO_BUILD_EXIT=0.
Nixpkgs pin: f5c082a40f7571c266e74e80ae2e68aadd8a9fc7.
Previous qualified ISOs are preserved separately.

Verification:

- 35 focused client/disk/network/guide tests pass. New cases cover unavailable API
  retry/defer, offline completion/resume, phone cancellation, expiry QR cleanup,
  unreadable receipt preservation, network errors, unexpected registration errors,
  and recoverable shutdown failure.
- 21 integration assertions against the actual generated frozen local Worker
  e8fda133 pass. This uses in-memory SQLite and explicit fixture Passkey approval;
  it does not use a real account or change production.

The Japanese dialog was exercised in a dedicated copy of the previously qualified
installed VM, using the final controller with an explicitly injected unavailable
service and connected-network result. This isolates UI recovery from production.
The recovery screen stays visually identical while idle; Retry makes one additional
attempt. Register later opens the completion page. The normal Shutdown action
stops this dedicated VM. This is a controller/UI fixture, not a real LAN test or
an installation of the newly built ISO.

The unmodified new ISO boots with no NIC into the Japanese installer network
selection page. Read-only checks inside the booted ISO confirm all four modules
match the frozen source and parse with the shipped Node runtime. The prebuilt
UEFI and BIOS systems in the ISO also contain matching versions of all four
modules. Both complete offline systems are included. No physical disk was touched,
and no new disk installation was performed in this turn; the unchanged installation
engine retains the prior qualified offline-install evidence.

Evidence: [guided setup evidence](evidence/guided-setup-2026-10-06/).

The physical PC and USB do not receive updates from a source change. The production
registration routes were unavailable in the previous check; publishing Worker and
Portal and testing real phone approval remain separate release work. Model/fleet
inference is not established by this change.

All task-owned builder, preview, and ISO-check VMs were shut down normally; their
PID files are absent. No push, PR, merge, production deploy, USB rewrite, or physical
PC change occurred. Source and evidence are committed locally.
