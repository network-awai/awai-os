# Device claim source verification — 2026-09-28

## Scope

Current `feat/headless-phone-setup` source adds a per-unit Ed25519 identity,
canonical `aiueos:1` QR label, device-side challenge response, and signed
heartbeat. The NixOS target module starts the responder only after a factory
identity file exists. The operator-only site registration credential is not
stored on the device. This is the `murakumo.cloud` device claim flow, not the
separate Kotoba authority pairing or a Community provider enrollment.

## Checks run on the macOS development host

- `npx --yes node@22 --test archive/nixos/test/device-claim.test.mjs archive/nixos/test/node-readiness.test.mjs`:
  8 tests passed, 0 failed. Device claim tests cover a unique, private
  provisioned identity and canonical label; signing and verification of the
  site's exact challenge and heartbeat message formats over a real loopback
  HTTP connection; and refusal of expired or absent challenges and non-HTTPS
  remote origins.
- `git diff --check`: passed.
- The signed message format was compared with
  `grant.device-attest/signing-input` and `heartbeat-signing-input`, and the QR
  field order with `grant.enroll/qr-payload` in the pinned source. These are
  source and local fixture checks, not a live end-to-end claim.

## Checks still needed

This macOS host has no Nix build tools. The source has not been built into a
new ISO, booted in a VM, installed on a physical Murakumo 2609, or run against
a deployed site with the device-claim migration and Worker changes. The
2026-09-26 BIOS/KVM proof applies only to an older ISO revision. Keep the
serving Ubuntu disk intact while testing an isolated build and recovery path.

For a genuine buyer trial, build and boot this exact revision, provision one
test unit, register its DID and token with the site's operator API, print its
unique QR, sign in as a test buyer, scan it, verify a single linked claim audit
record, and observe a signed accepted heartbeat. Separately verify local model
readiness, Community admission, one accepted inference job, a reward ledger
entry, and payout before describing a working token economy.
