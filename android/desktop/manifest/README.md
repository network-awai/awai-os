# Desktop source manifest snapshot (AWAI-4088, G1)

A resolved Awai overlay manifest for the Desktop product
**`lineage_virtio_x86_64`**, so later builds start from fixed, checkable
inputs.

- **Snapshot date:** 2026-11-25. This is a **new snapshot**, not a
  reproduction of the existing 0526 version.
- **Base manifest repo:** `https://github.com/LineageOS/android.git`, branch
  `lineage-24.0`, commit `913c6baa35ffa32be9ae33368cac69dbec6ead4b`
  (from `git ls-remote https://github.com/LineageOS/android.git
  refs/heads/lineage-24.0`).
- **Claim ceiling:** inputs are fixed and resolvable. No claim of
  buildable, reproducible, or bootable.

## Individually resolved projects (16)

`pinned-manifest.xml` pins 16 Awai overlay projects at full 40-hex SHAs,
each from `git ls-remote <url> refs/heads/lineage-24.0` (see `resolve.log`,
including a second pass re-checking 16/16 MATCH):

- the 13 `local_manifests` projects from
  `scripts/operator/same-build/build-inside.sh` (AWAI-3850), and
- the 3 `device/virt` projects needed by `lineage_virtio_x86_64`:
  `virtio_x86_64`, `virt-common`, `virtio-common`. These are not in the
  default `lineage-24.0` manifest (same situation as
  `device/mainline/generic` in AWAI-3850); their upstream repo names were
  found via the GitHub API search for `org:LineageOS` virt repos.

## Remaining projects

Every other project in the base LineageOS manifest is pinned **by the
manifest-repo commit above**, not by invented per-project SHAs.
`test_pinned_manifest.py` enforces that every `revision` in
`pinned-manifest.xml` is a 40-hex SHA (never a branch name) — the network
resolution lives in `resolve.log`, not in the test.

## Patch applicability

- `android/desktop/target-files/mkbootimg-header-version.patch`:
  **not applicable** at this snapshot. `device/mainline/generic` at
  `3d402dc5` sets `AB_OTA_UPDATER := false` and no
  `BOARD_BOOT_HEADER_VERSION`, so the patch does not apply (same as the
  `AWAI3850_GENERIC_FIX_SKIPPED` path in AWAI-3850).
- `android/desktop/pc-ab-device/patches/*` and
  `scripts/operator/same-build/inputs/setupwizard-awai.patch` are inventoried
  by SHA-256 in `manifest-inputs.sha256`. They target `device/virt/*`
  projects (and `vendor/lineage`, `packages/apps/SetupWizard`, etc.) and
  are not applied by this snapshot.

## Product-name split (recorded, not fixed)

Current state, unchanged by this snapshot:

- target-files evidence (`android/desktop/target-files/evidence/`) builds
  `lineage_Generic_x86_64`;
- A/B / installer / menu patches under `android/desktop/pc-ab-device/` use
  `lineage_virtio_x86_64`;
- AWAI-3850 (`scripts/operator/same-build/`) builds `Generic_x86_64`.

`lineage_virtio_x86_64` is the Desktop product per the owner decision of
2026-11-25. The split above stays open until decided; nothing here
renames a product or touches the `same-build/` target list.

## B2 check (2026-11-25)

One read-only attempt to list AWAI-3850's `pinned-manifest.xml`:
`rclone listremotes` shows no remotes (no `~/.config/rclone/rclone.conf`),
Keychain item `network.awai.release-artifacts.b2` is absent, and
`rclone lsf "art:"` fails with "didn't find section in config file".
The AWAI-3850 manifest could not be listed; no credentials were sought or
invented. Full commands and outputs are in `resolve.log`.

## Files

| File | What |
| --- | --- |
| `pinned-manifest.xml` | Awai overlay manifest, 16 projects at 40-hex revisions + base manifest-repo commit |
| `resolve.log` | per-project URL, ref, resolved SHA, command, UTC timestamp; manifest-repo, repo-init, GitHub-API and B2 notes |
| `manifest-inputs.sha256` | SHA-256 of `pinned-manifest.xml`, `resolve.log`, and every inventoried patch |
| `test_pinned_manifest.py` | offline `unittest`: fails if any `revision` is not 40-hex or is a branch name |

## Not verified

No build, no boot, no reproducibility claim. The old target-files device
revision `4cc0f606198db7d9f3a577283ebb3969350a0d38` is unreachable from
LineageOS GitHub branches and absent from Gerrit (searched by SHA and by
message); it was probably a local commit and is not reused as a pin.
