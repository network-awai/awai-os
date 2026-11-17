# Setup VM gate qualification — 2026-10-10

The production `offline-base.nix` service configuration passed the real NixOS
VM test with pinned nixpkgs `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`
and Nix 2.34.8. The final run took 129.32 seconds for the VM script.
[Machine-readable evidence](qa-vm-release-gate-20261010.json) binds the VM
result to the production target and the full NixOS source digest.

Verified: private update state and consent, threshold-two release trust,
periodic timer startup, native interface discovery under the real service PATH,
8-digit pairing, refusal before approval, approval and revocation, a separate
LAN peer, real GTK language selection and the launched setup screen, and
same-disk reboot preserving consent, anti-replay history and TLS identity.
Automatic activation remains unqualified; the test requires
`watchdogQualified:false`.

The related six-file unit suite passed 36 tests with zero skipped tests.
The full `test/*.test.mjs` suite passed 134 tests with one pre-existing
conditional real-Kotoba integration test skipped. `node --test` without that
file glob also attempts hardware integration helper scripts; it is not the
unit-suite entry point. The fleet capability probe passed 36 cases.

Two disposable copies of the final fixture failed for their expected cause,
while the unmodified fixture passed:

- `state-directory`: `ENOENT: no such file or directory, mkdir '/var/lib/aiueos-update'`; VM build exit 1; log SHA256 `e922247043d1c2c18c87e7b19cfa6232d648173138fe99f3d69615ad56a88589`.
- `service-path`: `spawnSync hostname ENOENT`; VM build exit 1; log SHA256 `b321a098a34f9098bdc393102aa695251b7f2e6e4d179bcdcc1aabd9029e240b`.

This was an operator-initiated sandboxed Nix build, not an automated fleet
receipt. The fleet companion PR keeps CD promotion disabled until a dedicated
non-root runner is approved and has produced an actual fleet green result.
No ISO, USB or production release was published by this CI change. Physical
hardware and real-phone account linking are outside this VM qualification.
