# Headless phone setup for Murakumo NixOS

Status: design and qualification plan. The revised ISO built on 2026-09-30 does
not implement this flow. Do not describe that ISO as a phone-configurable server.
The current source adds a read-only local inference check and a
`murakumo.cloud` factory device claim responder for after a manual OS install.
These do not implement phone-only setup, Wi-Fi provisioning, or the separate
`auth.kotoba.cloud` authority flow described below.

## Target and ownership

The first target is `aiueos-6600hs-2` (Ryzen 5 6600HS). Its only internal disk
is a 256 GB NVMe currently running Ubuntu and Mishima. The Wi-Fi device uses
the `rtw89_8851be` driver. On the current Ubuntu kernel, `iw phy phy0 info`
advertises AP mode and a managed+AP combination with at most one channel.
That is a capability report, not an association or phone setup trial. Keep the installed Ubuntu and its serving process
until a separate install and recovery trial succeeds. The USB image may boot
without writing the internal disk.

This repository owns boot media, local phone setup, disk selection, NixOS
installation, and recovery. `cloud-murakumo-installer` owns the existing-OS
CLI installer. `auth.kotoba.cloud` owns account approval and never gives the
USB installer a browser session cookie. The Murakumo node/runtime owns model
admission and serving after OS installation.

## Required phone path

1. Boot the USB with no monitor or keyboard. Prefer an already connected wired
   network. If no wired path is present, start a temporary Wi-Fi access point
   only after checking that the wireless adapter supports AP mode. Publish a
   local setup address by mDNS and provide a direct IP fallback. If the AP
   cannot start, report the failure through a durable boot log and keep the
   internal disk untouched; a monitorless Wi-Fi-only promise is then false.
2. The phone joins the setup network and opens the local setup page. Initial
   access needs a per-media secret supplied to the owner out of band. Never
   ship one shared default password in the image. The local page shows the
   device fingerprint, boot mode, wired/Wi-Fi state, and only whole candidate
   disks with model, capacity, serial, and existing partitions.
3. The phone supplies Wi-Fi credentials to the device over an authenticated
   local channel. Do not put credentials in a URL, log, cloud request, or
   Nix store derivation. Test the new connection before retiring the setup AP.
   If one radio cannot run AP and station modes together, keep an explicit
   reconnection address and a timed AP recovery path.
4. From the phone, start the existing `auth.kotoba.cloud` one-time device flow.
   Bind a locally generated device key, DID, challenge, model, and nonce;
   display the authority's approval URL as a QR and as a direct link. Approval
   uses the account's Passkey. Poll with the device-only token and signed
   proof, verify every echoed binding, and store only the resulting device
   identity/receipt on the target. Reuse the authority's existing five-minute,
   single-use `/v1/aiueos/device/*` contract only after confirming that a
   Murakumo NixOS device is an admitted audience; otherwise add a dedicated
   authority route with the same security properties.
5. The phone selects the target disk by serial and reviews the exact partitions
   to be removed. Require a fresh, target-bound erase phrase on the local page.
   The installer verifies that the selected whole disk is not the USB medium,
   that no selected partition is mounted, and that the boot mode and partition
   layout match. It records the choice before partitioning, formats only that
   disk, installs the pinned NixOS closure, and saves the installation receipt.
   A failed install leaves the USB recovery path available.
6. After reboot, the phone reconnects to a local management endpoint and sees
   OS revision, network state, account link state, disk health, and Murakumo
   service health. The installed OS must not require a monitor for rollback or
   network recovery.

## Model lifecycle

The OS should expose an approved model catalog rather than accept arbitrary
download URLs from the local browser. Each entry needs immutable source,
digest, size, license and hardware requirements, engine version, and model ID.
Download to staging; verify digest and available disk/RAM; activate one model
atomically; perform a local inference health check; then advertise that exact
model ID to Murakumo. A failed check rolls back the active model. Keep the
previous model until the new one passes. Remote commands must be authenticated
to the linked device and leave a receipt. No model should be advertised solely
because its bytes downloaded.

## Qualification gates

- VM: ISO boots both UEFI and BIOS; local setup page works headlessly; wrong
  disk and wrong erase phrase are refused; successful installation boots from
  the selected virtual disk; interrupted install recovers.
- Physical USB: verify image bytes after write and boot on the 6600HS machine.
- Wireless: verify AP support and phone association on the actual Realtek
  adapter, Wi-Fi credential application, loss-of-network recovery, and access
  from iOS and Android. Wired setup must work independently.
- Identity: run a real Passkey approval through the authority, verify the
  target-bound result and single-use behavior, and prove the installed node
  retains identity after reboot without exposing browser credentials.
- Serving: verify Radeon 680M/Vulkan, chosen model download and digest,
  switch/rollback, local inference, Murakumo admission, and restart recovery.

Until every relevant gate passes, the 2026-09-30 ISO remains a manual recovery
and installation image. It is not a headless phone installer or a production
Murakumo server image.
