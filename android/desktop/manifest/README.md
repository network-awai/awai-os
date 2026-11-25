# Desktop source manifest snapshot — complete (AWAI-4088, G1)

A complete, fully-resolved source manifest for the Desktop product
**`lineage_virtio_x86_64`**, so later builds start from fixed, checkable
inputs.

- **Snapshot date:** 2026-11-25. This is a **new snapshot**, not a
  reproduction of the 0526 version.
- **Base manifest repo:** `https://github.com/LineageOS/android.git`, branch
  `lineage-24.0`, commit `913c6baa35ffa32be9ae33368cac69dbec6ead4b`
  (from `git ls-remote https://github.com/LineageOS/android.git
  refs/heads/lineage-24.0`; the committed base files under `base/` match
  that commit byte-for-byte, see `base/SHA256SUMS`).
- **Claim ceiling:** inputs are fixed and resolvable — for the **complete**
  set below. No claim of buildable, reproducible, or bootable.

## Why this output exists (Organizer rejection, PR #503)

The first version pinned only the 16 Awai overlay projects and described
the remaining base projects as "pinned by the manifest-repo commit". That
was false: `default.xml` sets `<default revision="refs/heads/lineage-24.0">`
and `snippets/lineage.xml` also uses branch names, so two syncs at the same
manifest commit can fetch different sources. `pinned-manifest.xml` now
contains **every** project with an explicit 40-hex `revision`; `<default>`
carries no `revision` and no `<remote>` carries one, so no branch or tag
can be inherited. `test_complete_manifest.py` fails otherwise.

## Project set: 1260

| Source | Projects |
| --- | --- |
| `base/default.xml` (LineageOS/android `913c6baa`) | 1067 |
| `base/snippets/lineage.xml` | 176 |
| `base/overlay.xml` (13 `local_manifests` from AWAI-3850 + 3 `device/virt`) | 16 |
| `lineage.dependencies` closure additions (`kernel/virt/virtio`) | 1 |
| **Total, no duplicates by path** | **1260** |

Resolution (per project, `resolve.log`): branches →
`git ls-remote <url> refs/heads/<ref>`; tags → `git ls-remote <url>
refs/tags/<ref> refs/tags/<ref>^{}` (peeled commit; a lightweight tag
would be recorded as such — none occurred, all 941 were annotated).
Counts: **318 branch-resolved** (301 in the base manifolds — 126 in
`default.xml` + 175 in `lineage.xml` — plus 17 overlay/closure), **941
tag-resolved**, **1 already 40-hex in base**, **0 unresolved**. Re-ran
per-project resolution before generating: the 16 overlay SHAs matched the
earlier session's pins exactly.

## Dependencies closure

`lineage.dependencies` (JSON) was followed recursively at the pinned SHAs
from the product device tree (`virtio_x86_64` → `virtio-common` →
`virt-common` → `device/mainline/common`, `external/mesa`,
`kernel/mainline/configs`, `prebuilts/bootmgr` — all already in the
overlay — plus `kernel/virt/virtio`). That kernel
(`LineageOS/android_kernel_virt_virtio` → `604b22fb`) is the one addition
(its `lineage.dependencies` is HTTP 404 at the pinned SHA, so the closure
stops). Every step is in `deps.log`; the visited files are committed
under `base/deps/` and the test asserts every entry is present.

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
| `pinned-manifest.xml` | Complete manifest: 1260 projects, every `revision` 40-hex, no inheritable `<default>`/`<remote>` revision |
| `base/default.xml`, `base/snippets/lineage.xml` | Base manifests verbatim at `913c6baa` |
| `base/overlay.xml` | The 16 overlay projects (13 + 3 `device/virt`) |
| `base/deps/*.lineage.dependencies.json` | Visited `lineage.dependencies` files at pinned SHAs |
| `base/SHA256SUMS` | SHA-256 of every file under `base/` |
| `resolve.log` | Method + per-project URL, ref, resolved SHA, kind, UTC timestamp (1260 lines) |
| `deps.log` | Dependency-closure steps and closure additions |
| `manifest-inputs.sha256` | SHA-256 of the manifest, logs, base files and every inventoried patch |
| `test_complete_manifest.py` | Offline `unittest`: 40-hex everywhere, no inherited branch/tag, coverage vs base+overlay+closure, deps presence, and negative controls (a)-(d) |

## Not verified

No build, no boot, no reproducibility claim. The old target-files device
revision `4cc0f606198db7d9f3a577283ebb3969350a0d38` is unreachable from
LineageOS GitHub branches and absent from Gerrit (searched by SHA and by
message); it was probably a local commit and is not reused as a pin.
