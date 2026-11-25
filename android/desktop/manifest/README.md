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

## Project set: 1264

| Source | Projects |
| --- | --- |
| `base/default.xml` (LineageOS/android `913c6baa`) | 1067 |
| `base/snippets/lineage.xml` | 176 |
| `base/overlay.xml` (13 `local_manifests` from AWAI-3850 + 3 `device/virt`) | 16 |
| `lineage.dependencies` closure additions | 5 (`kernel/virt/virtio` + 4) |
| **Total, no duplicates by path** | **1264** |

**Source fidelity.** Each `<project>` element from the three committed
source manifests is carried through unchanged — every attribute (`name`,
`path`, `remote`, `groups`, `sync-c`, `clone-depth`, `upstream`,
`dest-branch`, …) and every child (`<linkfile>` / `<copyfile>`) — with only
`revision` replaced by the resolved 40-hex SHA. The 24 linkfile/copyfile
lines (9 in `default.xml`, 15 in `lineage.xml`, including the six
`build/make` ones such as `build/envsetup.sh`) are present.
`test_complete_manifest.py` compares every attribute and every
linkfile/copyfile pair and fails on any mismatch.

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

`lineage.dependencies` (JSON) is traversed recursively at the pinned SHAs
from the product device tree, **reaching every dependency whether or not it
is already in the manifest**: 17 projects reached, 4 added, 0 absent —
`kernel/virt/virtio` (`604b22fb`), `prebuilts/mesa-build-dep`
(`d68b2751`), `external/libdisplay-info-upstream` (`dffa9dee`),
`external/alsa-lib` (`533b21f7`), `external/alsa-ucm-conf`
(`b695e875`). (Order: `virtio_x86_64` → `virtio-common` → `virt-common` →
`device/mainline/common`, `external/mesa`, `kernel/mainline/configs`,
`prebuilts/bootmgr`; `device/mainline/common` → `external/drm_hwcomposer-upstream`
→ `external/libdisplay-info-upstream`; `external/mesa` →
`prebuilts/mesa-build-dep`; `hardware/mainline/common` →
`external/alsa-lib`, `external/alsa-ucm-conf`.) Projects without a
`lineage.dependencies` (404: both kernels, `prebuilts/bootmgr`,
`external/minigbm-upstream`, `external/linux-firmware-mainline`,
`vendor/mainline`, and the 4 additions) stop the closure. Every step —
path, pinned SHA, deps URL, every entry, added-or-present — is in
`deps.log`; non-404 visited files are committed under `base/deps/` and the
test asserts every entry is present with matching name/path.

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
| `pinned-manifest.xml` | Complete manifest: 1264 projects, every `revision` 40-hex, no inheritable `<default>`/`<remote>` revision; source attributes and all 24 linkfile/copyfile children carried through |
| `base/default.xml`, `base/snippets/lineage.xml` | Base manifests verbatim at `913c6baa` |
| `base/overlay.xml` | The 16 overlay projects (13 + 3 `device/virt`) |
| `base/deps/*.lineage.dependencies.json` | Visited `lineage.dependencies` files at pinned SHAs (7 non-404 files) |
| `base/SHA256SUMS` | SHA-256 of every file under `base/` |
| `resolve.log` | Method + per-project URL, ref, resolved SHA, kind, UTC timestamp (1264 lines) |
| `deps.log` | Dependency-closure traversal: 17 reached, 4 added, 0 absent (per project: path, pinned SHA, deps URL, entries, added/present; 404s recorded) |
| `manifest-inputs.sha256` | SHA-256 of the manifest, logs, base files and every inventoried patch |
| `test_complete_manifest.py` | Offline `unittest`: 40-hex everywhere, no inherited branch/tag, attributes + linkfile/copyfile fidelity vs sources, coverage, transitive deps, negative controls (a)-(f) |

## Not verified

No build, no boot, no reproducibility claim. The old target-files device
revision `4cc0f606198db7d9f3a577283ebb3969350a0d38` is unreachable from
LineageOS GitHub branches and absent from Gerrit (searched by SHA and by
message); it was probably a local commit and is not reused as a pin.
