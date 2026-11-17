# Local setup and startup language — 2026-10-06

Frozen runtime source: `1952e8b`.
See [the current behavior and update contract](local-setup-and-updates.md).

41 source tests passed, including phone-free completion with zero network or
registration calls, saved local setup across controller boot, private file modes,
corrupt identity refusal, network settings without implicit enrollment, Japanese
and English language persistence, existing account approval/cancellation and
disk erase guards. Native GTK screen qualification ran the final source in an
isolated x86_64 VM booted from the preceding logo ISO. It was a diagnostic override,
not proof of the final ISO's packaged startup.

In that no-NIC VM the language chooser displayed, English selected the English
headings/buttons and local completion menu, and choosing local completion created
the public device DID without an account receipt. After restarting the controller,
Japanese showed the same local completion record and DID. The public completion
JSON before and after was byte-identical. Both fixture completion callbacks ran.
Fixture network/registration handlers make no outbound request; accidental test
clicks in connection settings produce an injected network error, not a connection.
The diagnostic UI completion callback does not power off the VM; actual cleanup
used the VM's graceful poweroff. Temporary fixture keys/state were removed first.

Both public `/api/devices/link/start` and `/api/devices/link/status` returned 404
`unknown devices route` to empty non-enrolling POST probes. No public enrollment,
phone authentication or account claim was created. Production routes were not
published by this run.

Evidence: [local/language evidence](evidence/local-language-setup-2026-10-06/).

This change adds no OS auto-update agent or timer. Signed decentralized release
transport, staged activation, health checks and rollback are a documented future
contract, not enabled runtime behavior. Peer invitation/admission and inference
are also not implemented by the local completion feature.

The first `2d9f79a` ISO passed its initial language/network screen and byte-level
asset checks, but running the packaged installed controller exposed a Node ESM
resolution error: `/etc` symlinks resolve to flat store files, so the new local
module looked for `/nix/store/account-link.mjs`. This candidate is not qualified
and was not written to USB. Runtime `1952e8b` bundles local setup and the identity
module in a common store directory, preserving the relative import. A regression
test loads the bundled module through an etc-style symlink and completes local
setup without an account receipt. This repair required a rebuild and packaged-controller qualification; final results follow below.

The repaired final image was built successfully from `1952e8b`, then booted
normally with no NIC or target disk. Its startup language chooser continued to the
English network page and persisted `en`. The actual packaged installed controller
(`/etc/murakumo/setup-ui.mjs`, without diagnostic imports) was then launched on
the live media using its packaged launcher. English appeared first as the saved
preference; keyboard selection switched to Japanese. Choosing local completion
created and displayed a public device DID. A packaged-module read verified the
saved completion, `ja`, no account receipt, and mode 0600 for identity, completion
and language files. The UI's existing loop remained available after completion.
No outbound enrollment was performed; this VM had no network device.

Asset proof checked the original contents and resolved identity companion path
for the live media and both prebuilt UEFI/BIOS systems. This explicitly verifies
the store-directory bundle that failed in the first candidate. It does not claim
an installed internal-disk reboot or a physical-PC update in this run.

Final ISO is `murakumo-local-language-setup-fixed-20261006.iso`, 2,303,950,848 bytes,
SHA256 `cbbe316011bdb0996ddda01f5056f6d3894c9283039e69977c1b410133ff97f2`.
Guest and host hashes agree. Nix output:
`/nix/store/x8bmq161vzjmwyrmvllq35rxm4iwlafa-nixos-minimal-26.05pre-git-x86_64-linux.iso`.
The first repaired-image output attempt exhausted the dedicated build disk. Two
exact copied ISO outputs were deleted through Nix without deleting their systems
or dependencies, freeing 4.3 GiB. Re-realizing the same frozen ISO derivation then
passed. Host-side copies of the prior image remained available.

USB writing remains pending: macOS listed no external physical disk. The guarded
writer request is staged with action `check` and the final repaired ISO. No first
candidate or repaired ISO was written to USB. The installed PC remains unchanged.

All three task-owned QA VM processes were confirmed stopped. No other user VM
or app was closed. No push, PR, merge or production deployment occurred. A final
non-enrolling public start-route check still returned 404 `unknown devices route`.
