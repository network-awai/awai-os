# Local inference check verification — 2026-09-28

## Source and runtime checks

- Source: local `feat/headless-phone-setup` working tree. These changes are not
  in the 2026-09-26 ISO, which predates `node-readiness.mjs`.
- `node --check archive/nixos/node-readiness.mjs`: exit 0.
- `npx --yes node@22 --test archive/nixos/test/node-readiness.test.mjs`: 4 tests passed,
  0 failed. Node.js version: 22.23.3, matching the NixOS package major version.
- Cases: exact listed model responds; missing model fails; remote/non-HTTP URL
  fails; completion from a different model fails.
- `git diff --check`: exit 0.

The tests use a local HTTP fixture, not a downloaded model or physical node.
They establish the checker's request and failure behavior only.

## ISO and hardware status

The previous build/boot result in `verification-2026-09-26.md` applies only to
the older source revision and must not be reused as proof for the new ISO.
This macOS host has no `nix-build`. The prior NixOS build VM was hosted on
`aiueos-6600hs-2`; on 2026-09-28 its Tailscale address `100.84.134.120` was
offline and an SSH connection timed out. No new ISO was built or booted. No
disk on the serving Ubuntu host was modified.

Next verification: when that host is reachable, send the current source to an
isolated NixOS build VM, run `./scripts/build-iso.sh` against the reviewed
pinned nixpkgs revision, record the ISO hash, boot it in a separate VM and
verify `/etc/murakumo/node-readiness.mjs`, `preflight.sh`, and failed units.
Only then test the installed target configuration and a real local model on
physical hardware.
