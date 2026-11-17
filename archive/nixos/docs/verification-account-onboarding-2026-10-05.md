# Account onboarding verification, 2026-10-05

Runtime source: 87d49c1f57b9f7791b1a8ed51b1df45d7f7e30ee.
The existing network UI is extended through phone account linking and saved versus
online-verified registration status. No production release or physical USB rewrite
is included. The existing network-only ISO remains preserved separately.

New offline ISO: /Users/junkawasaki/github/murakumo-usb-auto-install-qa/murakumo-account-onboarding.iso
Size: 2011299840 bytes.
SHA256: 66de04884a2b64897dd3138c3ec7dbde74c623b11cf34d9940f9c33966ad5f49.
Linux builder and macOS hashes match; AUTO_BUILD_EXIT=0.
Nixpkgs: f5c082a40f7571c266e74e80ae2e68aadd8a9fc7.
Both shipped BIOS and UEFI systems are built in the ISO.
Task-owned blank 24 GiB NVMe ACCOUNT-QA-FINAL installed successfully through the
unmodified new ISO with -nic none and explicit ERASE confirmation. No downloaded
packages or root-password prompt are used. The source and media are preserved.

The same NVMe boots without the ISO or NIC. The Japanese network/account guide
starts normally, and register-later displays OS complete/account not linked.
All four shipped JS modules match /etc/nixos and the frozen source hashes.
The account service is active/running with zero restarts and no failed units;
ProtectSystem=strict, NoNewPrivileges=yes, state/runtime directories 0700.
Root password is locked and SSH is not installed/enabled. No offline receipt exists.
The normal guide's shutdown action is used to stop the final installed QA VM.

## Focused verification

- All 29 client/disk/network/onboarding tests pass. These include cancellation
  racing an approval response, server-side expiry, unavailable API, receipt binding,
  reboot persistence and key permissions.
- The current client passes 21 assertions against the actual generated registration
  Worker from e8fda1333a9a3ccec8cf3d29d7053164430979c6 using in-memory SQLite and an
  explicitly mocked Passkey verdict. Signed start/poll/status, replay refusal,
  concurrent single approval, wrong-device refusal, public receipt persistence,
  reboot status verification, owner revocation and explicit same-owner relink pass.
  No production DB or real account credentials are used. The generated Worker was
  reused from the frozen review, not rebuilt or deployed by this change.
- The Japanese dialog renders on the existing installed QA VM's framebuffer.
  The final layout keeps the device DID, code and QR on one screen. Vision CPU QR
  decoding returns https://murakumo.cloud/portal/#device-link?code=ABCD123456.
  Enter exits the waiting screen, stops polling and leaves no account-link receipt.
  The fixture state directory exists only in that VM's /run; it disappears at shutdown.
- The frozen Portal's generated assets were served with the actual frozen Worker
  on localhost. In-app Chromium at 390x844 shows the complete wrapped DID; document
  width equals 390. Unverified approval shows the auth.murakumo.cloud Passkey URL
  with the original device-link URL as return_to. Explicit LOCAL TEST fixture
  admission then permits approval and shows completion. The registered-devices
  link navigates correctly, but that page requires actual frontend sign-in; a real
  account session and registered-device listing remain unverified.
- Production read-only route check: GET status and empty POST start each return
  HTTP 404, unknown devices route. This cannot create a device registration.

Evidence: [account onboarding evidence](evidence/account-onboarding-2026-10-05/).
The phone screenshot prominently identifies LOCAL TEST authentication.

## Remaining acceptance

Production requires integration of the frozen Worker/Portal and reachable dependency
pins, release gates, deployment and a real phone Passkey approval. Physical Wi-Fi,
real account visibility and fleet inference are not established by these fixtures.
