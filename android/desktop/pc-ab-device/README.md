# Awai PC A/B device, step by step (AWAI-3586)

Goal: an A/B image that installs next to the partitions already on a PC's NVMe and takes signed OTA
updates. The base is the upstream A/B reference device `lineage_virtio_x86_64` (GRUB boot control,
Virtual A/B), whose OTA behaviour is recorded in [../ota-reference-check](../ota-reference-check/README.md).

That device owns a whole virtio disk and addresses partitions by device name and number. This directory
holds the changes that remove those assumptions, and the installer for a shared disk.

**State: KVM only.** Nothing here ran on the 7735HS. The kernel has the Desktop's NIC driver and builds
the AMD GPU driver as a module. Without a virtio GPU the image boots in the headless mode, with no picture
(see "Headless mode").

## Patches

Apply to a synced source tree with `apply.sh <source tree root>`.

| Patch | Project (revision) | What it changes |
| --- | --- | --- |
| `patches/virtio-common-awai-pc.patch` | `device/virt/virtio-common` (`e6f2a7d2`) | SELinux labels for `/dev/block/by-name/{super,misc,userdata,persist,metadata,boot_[ab],vendor_boot_[ab]}`, kernel config fragment `awai-pc.config`, and Intel NIC modules in the boot-time load list. |
| `patches/virtio-userdata*.patch` | `device/virt/virtio-common` | Mounts userdata by partition name while preserving the existing ext4 and f2fs mount options. |
| `patches/virtio-common-awai-apps.patch` | `device/virt/virtio-common` (`9d5c9307`) | Prebuilt `AwaiHome` and `AwaiStore` (`BUILD_PREBUILT`, `PRESIGNED`) and their `PRODUCT_PACKAGES` entries. The product include is fail-closed: missing APK, unset expected signer or a signer mismatch stops the build; `AWAI_WITHOUT_APPS=1` is refused on release builds. Yotei is not added. |
| `patches/launcher3-home-priority-fallback.patch` | `packages/apps/Launcher3` (`3e0e4f19`) | Lowers the HOME intent filter to `android:priority="-1"` in `AndroidManifest.xml` (Launcher3) and `quickstep/AndroidManifest-launcher.xml` (Launcher3QuickStep), so Awai Home (0, non-privileged) is the unique highest after the setup wizard. |
| `patches/virt-common-awai-pc.patch` | `device/virt/virt-common` (`0e62edf1`) | GRUB takes the boot disk from where the `PERSIST` filesystem is, and finds `misc`, `vendor_boot_a/b` and `boot_a/b` by fixed GPT partition GUIDs. `EFI` and `BIOS` leave `AB_OTA_PARTITIONS`, and Android no longer mounts the ESP. `ro.surface_flinger.enable_frame_rate_override=false` is removed (headless mode). |

| `patches/vendor-lineage-no-ota-downgrade.patch` | `vendor/lineage` | Removes LineageOS's opt-in to older A/B payloads on non-`user` builds. |

Use a dedicated LineageOS source checkout for these patches. The vendor change affects LineageOS
products built from that patched checkout. The installed image must report an empty
`adb shell getprop ro.ota.allow_downgrade`. Validate the rejection paths on the Awai PC NVMe
guest using an older OTA signed with its test key and a current OTA signed with a different test key.

For `virtio-common`, `apply.sh` selects a matching userdata fstab patch before
changing any source files. Both variants use the userdata GPT name and enable
`checkpoint=block` for ext4. Older Awai source trees without the ext4 flag are
updated on reapplication. F2FS keeps `checkpoint=fs`. The PC kernel must include
`CONFIG_DM_BOW=y` for ext4 checkpoints.

Why the ESP leaves the A/B set: with `androidboot.boot_devices=any` every GPT partition on every disk
appears under `/dev/block/by-name/`. If an existing ESP is named `EFI`, an update could write to it.

Without the first patch the stock image on an NVMe disk reboots in a loop: `/metadata` cannot be
formatted (`mke2fs returned 1`, the device node has no label) and `/dev/block/vdb` does not exist.

The stock GRUB has no search by partition name. It has `probe --part-uuid` and `regexp`, which is what
the second patch uses. A disk without the fixed GUIDs (the stock `disk-vda.img`) keeps the stock numbers.

## Default home and preinstalled apps (AWAI-4094)

**State: inputs only. Not built, not booted.** Preinstall Home and Store only (Yotei comes
from the Store) and make Awai Home the home screen on a fresh `/data`.

**Preinstall (source build).** `patches/virtio-common-awai-apps.patch` adds
`device/virt/virtio-common/awai-apps/`: `Android.mk` (`BUILD_PREBUILT`, `PRESIGNED`,
`LOCAL_DEX_PREOPT := false`) for `AwaiHome` and `AwaiStore`, and `product.mk` that adds both to
`PRODUCT_PACKAGES` under a fail-closed check. `apply.sh` applies it with the other
`virtio-common` patches. The build stops until the operator supplies:

| Input | Meaning |
| --- | --- |
| `device/virt/virtio-common/awai-apps/AwaiHome.apk`, `AwaiStore.apk` | operator-built APKs; they are not in this repository |
| `AWAI_APKSIGNER` | path to a host `apksigner` |
| `AWAI_HOME_EXPECTED_SIGNER_SHA256`, `AWAI_STORE_EXPECTED_SIGNER_SHA256` | expected certificate SHA-256 (lowercase hex) |

`awai-apps/verify-apks.sh` compares `apksigner verify --print-certs` with those values. A
missing APK, an unset expected value, a missing tool, an unsigned APK or a mismatch prints
`AWAI_APPS_FAIL: …` and the product config stops (`$(error)`). `AWAI_ALLOW_UNVERIFIED_APKS=1`
skips the comparison for development builds. `AWAI_WITHOUT_APPS=1` installs neither app in
an evaluation build and prints `AWAI_WITHOUT_APPS: Home/Store are NOT preinstalled`. Both
flags are refused when `TARGET_BUILD_VARIANT=user` or `LINEAGE_BUILDTYPE=RELEASE`. The
default stays fail-closed. The shipping signing key is not decided, so no expected value
is committed.

**Default home.** No `config_defaultRoleHolders` or default-home string exists in
`framework-res` at the pins, and `roles.xml` gives `android.app.role.HOME` no `defaultHolders`,
so a device overlay cannot express this. The platform uses the unique highest-priority HOME
activity (`HomeRoleBehavior.getFallbackHolderAsUser`, `ComputerEngine.getDefaultHomeActivity`).
Home is a non-privileged `product/app`, and `ComponentResolver.adjustPriority` caps a
non-privileged filter's priority above 0 back to 0 (pinned `frameworks/base` `0a607d06`,
`ComponentResolver.java:493-515`), so Home declares **no priority** in
[`android/build.py`](../../build.py) (`manifest()`, `:55`).
`patches/launcher3-home-priority-fallback.patch` sets Launcher3's HOME filter to `-1` in both
its manifests (`AndroidManifest.xml` and `quickstep/AndroidManifest-launcher.xml`). Resulting
order: setup wizard 9 (Organizer's 6600H observation) > Awai Home 0 > Launcher3 -1 > Settings
`FallbackHome` -1000. A Store-installed launcher is also capped to 0 and can only tie Home;
ranking it remains a Store review/policy question, not a security boundary. Evidence, the
Launcher3 fallback and the unrun checks are in
[home-default-20261125.md](home-default-20261125.md). `Launcher3QuickStep` still comes from
`build/make` `handheld_system_ext.mk:27`.

## Shipping debug lockdown (AWAI-3682)

**State: patches only. Not built, not booted.** `apply.sh` does not call this; run it yourself on the
dedicated checkout, after `apply.sh`:

```sh
apply-shipping-debug-lockdown.sh --check <source tree root>   # changes nothing
apply-shipping-debug-lockdown.sh <source tree root>
```

It checks all three patches first and applies none if one does not match. A second run reports `applied`.

| Patch | Project (upstream revision it was written against) | What it changes |
| --- | --- | --- |
| `patches/virt-common-user-no-adb-tcp.patch` | `device/virt/virt-common` (`5da81829` plus `virt-common-awai-pc.patch`) | `service.adb.tcp.port=5555` moves from `product.prop` to the product makefile and is set only when the variant is not `user`. |
| `patches/mainline-common-user-no-insecure-debugging.patch` | `device/mainline/common` (`e237088e`) | `androidboot.insecure_adb` and `/metadata/.enable_insecure_debugging` are honoured only in debuggable builds. A `user` build ignores both. |
| `patches/build-no-trade-in-mode-trigger.patch` | `build/make` (`90d00638`) | Removes `DeviceDiagnostics`, the app that starts ADB trade-in mode during setup, from `handheld_system.mk`. This affects every product built from the checkout. |

Why, and what each route does without the patch:
[debug route design](../../../docs/otehon/android-debug-routes-design-20261121.md).

What was checked (2026-11-21, on the Mac, against clones of the three upstream projects at the revisions
above): `--check` reports `pending` and leaves the trees clean; a run applies all three; a second run
reports `applied`; with one project edited so its patch no longer fits, the script exits 1 and changes
nothing.

What was not checked: the revisions on the build host (they may differ, in which case the script reports
`mismatch`); that the tree builds; that `product_variables.debuggable` selects the flag as intended; that a
`user` image boots, finishes setup and shows no ADB at the Welcome screen; that development `userdebug`
images still serve ADB on 5555. Those are checks V1, V2 and V7 in the design document.

## GPU sysfs label (AWAI-4090)

**State: source patch and host tests only. Not built, not booted.** On the 6600H, Mesa EGL falls back to
llvmpipe because the GPU's PCI attributes keep the generic `sysfs` label, which apps may never read
(`neverallow all_untrusted_apps sysfs:file no_rw_file_perms`).

| What reads it | File (under the GPU's `/sys/devices/pci0000:00/0000:00:08.1/0000:05:00.0`, reached through `/sys/dev/char/226:N/device`) | Needed by |
| --- | --- | --- |
| libdrm `drmParseSubsystemType`, `realpath` | `subsystem`, `device` (symlinks; every domain may already read these, `domain.te`) | not blocked |
| libdrm `drmParsePciBusInfo` | `uevent` (`PCI_SLOT_NAME`) | every `gpu_sphal_domain` process that loads Mesa; denied on the rig |
| libdrm `drmParsePciDeviceInfo` (flags 0) | `vendor`, `device`, `subsystem_vendor`, `subsystem_device` (`config` only with `DRM_DEVICE_GET_PCI_REVISION`) | same, read after `uevent` succeeds |
| libdrm `drmNodeIsDRM`, `drmGetMinorNameForFD` | `drm/` (directory read) | same; denied on the rig |

`sysfs_gpu` (system/sepolicy `private/gpu_sphal_domain.te`) grants `r_dir_file` to `gpu_sphal_domain`: every
non-isolated app, `hal_graphics_allocator`, `hal_graphics_composer`, `hal_neuralnetworks`, and the domains
that call `gpu_sphal_use` (SurfaceFlinger, system_server, bootanim, mediaswcodec, mediacodec, cameraserver,
gpuservice, and others). Apps may never write any `sysfs_type`. Only the generic `sysfs` is denied to them,
so the label is the fix; no policy rule changes.

Mechanism: `genfscon sysfs` lines in `sepolicy/vendor/genfs_contexts`
(`patches/virtio-common-awai-pc-gpu-sysfs.patch`, applied by `apply.sh`) that label **only** `uevent`, `vendor`,
`device`, `subsystem_vendor`, `subsystem_device`, `revision`, the `drm` directory and the `uevent` of
`drm/card0` and `drm/renderD128` as `sysfs_gpu`. `config` is not needed (it is read only when `revision` is
unreadable). Labelling the whole GPU function, which the first version did, made 648 files readable by every
non-isolated app, among them `drm/card0/card0-*/edid` (monitor make and serial number), `gpu_busy_percent`,
`mem_info_vram_used`, `vbios_version` and `config`. Measured on the rig.

Allow-list or deny-back: genfscon is a string-prefix match and the longest prefix wins. Labelling the function and putting
`drm/card`, `…/edid`, … back to `sysfs` fails open: the next amdgpu attribute or driver version is exposed
without anyone noticing. Labelling the individual attributes fails closed, so that is what the patch does. `drm`
is the one exception: its children cannot be listed, so `…/drm/` (trailing slash, which matches the children but not
the directory) puts them all back to `sysfs`, and the two nodes' `uevent` are labelled after it. Prefix collisions:
`device` also matches `device_x`, `vendor` matches `vendor_x`; no such file exists in an amdgpu PCI function, and a
future one would be readable (the tests document this). The matching rule is the kernel's `strncmp` with entries ordered by
decreasing length; the trailing-slash entry relies on that and is checked by the trial on the machine, not here.

The paths of PCI devices and DRM node names differ by machine, so each PC model needs its own lines (`readlink -f
/sys/class/drm/card0/device`; `gpu-sysfs-trial.py --gpu-path … --drm-node …` writes them). Rejected: a `file_contexts`
regex that ueventd would restorecon, because it cannot tell a GPU from any other PCI device; a bus-wide prefix, for the same
reason; a boot service that relabels, because it needs new relabel rights and a new domain.

**The older entries have the same exposure and are unchanged here:** the lines for `0000:00:01.0`, `0000:00:02.0`,
`0000:00:03.0`, `0000:00:1e.0`, `00:01.6/07:00.0` and the arm64 `10000.pci/…/00:01.0` label a whole device or even a bridge.
On a physical PC a bridge-level entry also exposes every device behind it. Follow-up: replace them by the same
allow-list, or drop the entries for hardware the Awai PC does not run on.

Try it without flashing: `gpu-sysfs-trial.py --plat-cil <plat_sepolicy.cil of the image> --vendor-cil <vendor_sepolicy.cil>
--out-dir <new dir>` writes `userdebug_plat_sepolicy.cil` (the image's plat policy plus the label) and a one-file cpio
for the debug ramdisk. It reads files only. Host tests: `bazel test //android/desktop/pc-ab-device:gpu_sysfs_test`
(they model the genfscon lookup; they do not build or load a policy).

## PC installer and OTA host checks

With Bazelisk and Python >= 3.11 on the host, run both regression suites using the
Bazel version in `.bazelversion` (the runner resolves a suitable `python3` and
fails with a clear message when none is found, AWAI-3852):

```sh
bazel test //android/desktop/pc-ab-device:pc_verification
```

For a focused run, use `:installer_test` or `:ota_feed_test` in the same
package. Each target declares its Python sources and runs locally. These suites
cover installer planning and OTA metadata checks. The AOSP build, signing and
on-device acceptance continue to use their documented release workflows.

## Installer

`awai-pc-install.py` adds the Awai partitions to a disk that already has partitions:

```sh
awai-pc-install.py plan  <disk or image> <disk-vda.img from the build>
awai-pc-install.py apply <disk or image> <verified install image> \
  --source-sha256 "$INSTALL_IMAGE_SHA256" --record record.json
```

- `plan` writes nothing and prints every sector range it would use.
- By default (`--userdata-gib` omitted, AWAI-4091) userdata takes the largest free range minus
  the other Awai partitions and `USERDATA_RESERVE_SECTORS` (1 GiB, in `awai-pc-install.py`)
  kept free at the end; with `--userdata-gib N` it uses N GiB. The plan JSON carries
  `userdataSectors` and a `userdata` breakdown (mode, reserve, non-userdata sectors,
  free range, disk usable/total sectors and first/last usable sectors), and `apply`
  uses the plan's userdata sectors unchanged.
- Remaining-based sizing has a floor: **`USERDATA_MIN_SECTORS` (16 GiB)**. A disk whose
  remaining space would give userdata less than that is refused with `not-enough-free-space` before
  anything is written (a nearly full small SSD would otherwise get a few-MiB `/data`). The floor
  applies only to remaining-based sizing; an explicit `--userdata-gib N` is the operator's
  decision and is not bounded by it.
- It copies each partition from the partition of the same name in the build's disk image. The Awai ESP
  is named `awai_esp`.
- It requires 512-byte logical sectors on both the source and target (4Kn is refused) and refuses to use the same
  file or device for both. It also refuses an existing Awai partition name, insufficient contiguous
  free space, or an overlap.
- `apply` rejects a source image that is shorter than the partitions it needs before changing the GPT.
  It hashes complete existing partitions before and after. It also reads back new GPT entries,
  fixed GUIDs, copied data and the zeroed prefix of new empty partitions. A success record includes
  the verified ranges and the supplied release digest. The record path must be new.

It has only been run against an image file. Running it on a real disk is a separate, approved step
(AWAI-3585 first reads the Desktop's partition table).

## Screen installer on the USB (item 205)

`installer/` is the screen version of the USB installer (the Figma design: six screens plus a failure screen). `awai/install`
on the USB starts it: **one GTK 3 window** on a bare X server (no window manager, no browser, no listener of any kind). If X or
GTK cannot start it says why in one line and continues with the text installer on tty1.

| Path | What |
| --- | --- |
| `installer/core.py` | **Every guard and the install sequence** (and the detached `worker` entry). Both front ends call it; neither decides anything. |
| `installer/controller.py` | front-end-neutral controller: list/confirm -> one-shot ticket -> one in-window confirmation -> exactly one detached worker, true install state, power-off question. Unit-tested without GTK. |
| `installer/gui.py`, `keys.py`, `strings.py` | the GTK 3 widget tree (CSS from one design unit), the key policy, every Japanese string. |
| `installer/fonts/`, `assets/` | bundled Noto Sans JP subset (3 static weights, OFL) and the Awai mark. |
| `installer/text_installer.py` | the text front end (English, on `core.py`). |
| `installer/start.sh`, `xsession.sh`, `awai-install` | tty1 entry and restart loop, the xinit session, the `/awai/install` shim. |
| `installer/build-overlay.py` | stock SystemRescue ISO + image -> overlay -> `xorriso`. `--dry-run`; downloads nothing. |
| `installer/700-awai-installer.yaml` | SystemRescue autorun for tty1 (unchanged content: it still runs `/awai/install`). |
| `installer/tests/` | tests, fakes, GTK offscreen driver, screenshot and mutation tools. |

How it runs: `start.sh` checks `xinit` and `python3 -c 'import gi; Gtk 3'`, then loops `xinit xsession.sh -- :0 vt1`. `xsession.sh`
turns off blanking and DPMS (`xset s off`, `s noblank`, `-dpms`) and runs `gui.py`. The window is undecorated and as large as the
screen; with no window manager there is nothing to switch to, and `keys.py` swallows every Ctrl/Alt/Super combination, function key
and the menu key before any widget sees it (no accelerators, no mnemonics, no context menu). Closing or killing the window (Alt+F4 has
no effect without a window manager; `kill -9` does) ends X, `start.sh` starts it again and it shows the true state from
`/run/awai-pc-installer/state.json`; the install itself is the detached `core.py worker` holding the lock, so it never notices.
Three windows that die within 20 s each mean GTK/X do not work here and `start.sh` falls back to the text installer. X VT switching
is untouched (Ctrl+Alt+F2 gives the console shell).

### Boot menu and text mode

`build-overlay.py` replaces three files of the base medium's boot configuration (from SystemRescue 13.03, kept as
`installer/tests/stock-bootcfg/` with SHA-256s): GRUB for UEFI `boot/grub/grubsrcd.cfg` and syslinux for BIOS
`boot/syslinux/sysresccd_head.cfg` + `sysresccd_sys.cfg`; xorriso maps them with `-overwrite on`. The menu is
**Install Awai OS** (default, first), **Install Awai OS (text)** (`awai.installer=text`, read by `start.sh`) and
**Install Awai OS (basic display, nomodeset)**, then the stock custom hook, firmware setup, reboot and power off. Timeout 5 s;
an unattended boot only reaches the installer screen, which still needs the confirmation (the default focus there is やめる). The kernel and initrd lines
are the stock ones character for character (a test compares them with the stock files), and the text entry adds only
`awai.installer=text`. Labels are English: GRUB's `font.pf2` and syslinux's menu font are not known to draw Japanese, and
no base-distribution name appears in menu text (the `archisolabel=RESCUE1303` parameter and `/sysresccd` paths are
parameters, not text). The stock memory test, EFI shell, copytoram, checksum, serial, nomdlvm, findroot and break entries are
dropped from the installer medium. Other ways into text mode: `awai.installer=text` typed at the boot prompt, or tty2 and
`/run/archiso/bootmnt/awai/install --text`. If an install is already running when the text installer starts (for example the
screen session died and `start.sh` fell back to text) it says so, follows the install to its true end state and never offers a
target (it also holds off while the worker's lock is held but no state exists yet). Not exercised on a real boot (QEMU run).

### What `core.py` enforces (in the backend, never only in the window)

Target: `/dev/nvme[0-9]+n[0-9]+`, block device, `TYPE disk`, `RO 0`, no partitions, 512-byte logical sectors, nothing
mounted, `wipefs` signatures only `gpt`/`PMBR`, never the device the media directory is served from (resolved with
`findmnt` plus `lsblk -s`; if it cannot be resolved every disk is refused). Every disk is listed; the ones that fail are
`選択不可` with the reason. There is no erase operation anywhere.

Order of `run_install`: `request.confirmed is True` -> target checks and identity (major:minor, size, model, serial,
WWN; a serial or WWN appearing or vanishing counts as a change) equal to what was confirmed -> `archive.sha256` ->
raw image sha256 == pinned value -> plan with `existing == []` and the expected number of new partitions ->
**all target checks and identity again, plus a fresh plan, immediately before writing** ->
`awai-pc-install.py apply --record` -> record has `sourceSha256 == pinned`, `existingUnchanged`, one readback per
partition with a digest -> `sgdisk -v` exit 0 and "No problems found" -> `sync` -> only then `done`. Any other path ends
in `failed`; the window shows the completion screen only for `state == "done"`.

Confirmation: the review screen has no text field (owner feedback from the real 6600H: a typed device name is not for ordinary
people; only empty SSDs can be chosen, so nothing of the user's is at stake). この SSD にインストール opens one confirmation in the same
window (a veil over it, never a second window): size, and for several empty SSDs model and the last 4 of the serial, "do not switch
off", やめる (focused first, Esc) and インストールする. `Controller.ask()` marks the ticket as asked; `start(confirmed=True)` refuses
without the opened confirmation and an explicit `True`; the worker request carries `confirmed: true` and `core.run_install` refuses
anything else (`not-confirmed`). The identity captured at the review is checked again right before writing, as before. The text
installer still asks for `INSTALL nvme0n1` and sends `confirmed: true` to the same check.

One install: the worker holds `flock` on `/run/awai-pc-installer/lock`; it is a separate, detached process (own session), so
closing, killing or crashing the GTK window neither stops the write nor allows another. A restarted window reads the true state
(`running` only with a live lock holder; `running` without one is reported as interrupted, never as running or done).
`write-started` / `install-record.json` block any further start until reboot (`/run` is a tmpfs). Reboot and power off are
refused by the controller while an install runs, and the buttons are disabled. The ticket from `内容を確認` (identity at that
moment) is consumed by the one start, whatever happens; a start without the confirmation consumes it too.

### Progress

`awai-pc-install.py apply` gained an optional `progress(event, done, total)` callback (events `write-start`, `write`,
`write-done`, `verify`). It only reports: no check was changed or reordered, `write-start` is emitted immediately before
the first GPT change, and the existing suite is untouched and green. Step 1 is the byte progress of hashing the archive,
unpacking and re-hashing the raw image; step 2 the bytes written; step 3 the bytes read back. `apply` itself first
hashes the source and existing partitions without progress, so step 2 can sit at 0% for a while on a large image.

### Differences between the shipped overlay copy and the repo

The overlay's `awai-pc-install.py` is older: it has no vbmeta handling (`VBMETA_ROOTS`, `vbmeta_layout`, vbmeta in the
name clash check). The repo copy is canonical and is what `build-overlay.py` ships. Consequence: the old `jq` check
`(.new|length)==11` is wrong for an image with vbmeta slots (13 to 17 new partitions). `core.py` expects
`len(LAYOUT) + len(vbmeta_layout(source))`, taken from the canonical script, so an image without vbmeta still needs
exactly 11. The review screen therefore does not say "11 区画を作成します" (the image is not unpacked yet); the completion
screen says `{n} 区画を確認` with the real count.

### Font, logo, proportions

**Font.** The live system has no Japanese font, so the window registers its own for this process only: `gui.py` writes a private
fontconfig file (`FONTCONFIG_FILE`, system config included, cache under the work dir) that adds `installer/fonts/`, and CSS names only
`"Noto Sans JP"`. It is Noto Sans JP, SIL OFL 1.1, cut into three static TTFs (Regular 400, Medium 500, Bold 700; fontconfig and Pango
cannot load WOFF2) and subset to 678 codepoints (ASCII, Latin-1, general and CJK punctuation, kana, full-width ASCII, and every
character in `strings.py`, `core.MESSAGES` and `core.STEPS_JA`). The OFL text ships unchanged as `fonts/OFL.txt`; the Reserved Font
Name 'Source' is not in any name the build keeps (`font/build_font.py` refuses otherwise). Source (pinned): `google/fonts` commit
`66a36c8c94b1a5d992ee4e7f392fccfe4945767c`, `ofl/notosansjp/NotoSansJP[wght].ttf` (sha256
`c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f`) and `OFL.txt` (sha256
`1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9`); URLs in `font/font-pin.json`. Rebuild (development only):
`pip install fonttools brotli` in a venv outside the repo, then `python font/build_font.py 'NotoSansJP[wght].ttf' OFL.txt`.
A missing glyph is a hard failure: the tests compare the screens' characters with all three fonts' cmaps (`glyphs-noto-jp.json`, tied
to the Regular file's SHA-256), the GTK tests ask Pango which font it loads for every label and require exact coverage, and
`build-overlay.py` refuses to build, with no override option. `android/client/assets/setup-noto-jp.woff2` is untouched.

**Logo.** `assets/logo.png` is `android/client/assets/setup-logo.png` (the Awai mark) scaled to 256 px. No vector version of the mark
exists in the repo or in PR #302 (its `awai_welcome_mark.xml` is only a rounded rectangle), so it is raster.

**Design and proportions.** The screens follow the revised Figma board (`design/installer-rev2.png`, 10 screens): 1 Figma px = 1 px at
1280x720. One unit `u = min(W/1280, H/720)` scales text, logo, cards and gaps (compact layout for width < 1000 or portrait: a
stepper bar on top, `u = min(W/800, H/600)`). Focus is a filled control with a 5px amber ring; hover and pressed states are
styled. Gtk CSS only, software rendering (no GL): the window uses the plain cairo paths of GTK 3.

**Never cut off.** The window takes the geometry of the primary monitor (else the first), never the virtual screen, and never
`fullscreen()`: without a window manager GDK falls back to the whole X screen, which with several outputs is larger than any one
monitor, and that is what cut the bottom off on the real 6600H. Everything sits inside a 3% safe margin on every side (TVs and
portable monitors overscan); the panel backgrounds still reach the edges. The natural height of the screen is measured and `u`
is reduced until it fits (including the confirmation and the longer power question); the SSD list scrolls inside its own area, follows
the focused card, and the action row is always visible; every label wraps. `xsession.sh` sets each connected monitor to its
preferred mode (`xrandr --auto`, mirrored), marks one primary, and writes `xrandr --query` before and after to
`$work/xrandr.txt`; `gui.py` writes the monitors and the chosen one to `$work/display.txt`. HiDPI: the geometry is in logical pixels
and `u` already scales the UI, so no extra factor is applied. `tests/test_layout.py` checks 13 sizes (1024x600 ... 3840x2160,
800x600, 1080x1920) x 1 to 8 SSDs x every screen: every button and label inside the safe area, no overlap, no clipped text.

**Mouse, touch and keyboard.** The pointer is visible (no `-nocursor`; `xsetroot -cursor_name left_ptr`); a whole card or button is
the click target. Keyboard: a sensible control has the focus when a screen opens (the one empty SSD is already chosen and 内容を確認
has the focus; several: the first card), ↑ ↓ walk the cards and then the buttons, ← → the buttons of the row, Enter does what the hint
above the buttons says, Esc is 戻る / やめる, Space selects, Tab/Shift+Tab work. Enter, Enter, Enter from boot ends on やめる, never
an install. 電源を切る is never reached by plain Enter and asks once; a done or failed screen that appears by itself ignores its
buttons for 1.2 s.

**No browser, no listener.** An earlier revision showed the screen in a kiosk browser. VM runs showed that this cannot be made
reliable (shortcuts left the installer, browser chrome and the per-boot token showed in the address bar, and the browser's own
first-run terms dialog covered the installer; accepting that on the user's behalf is not ours to decide). The browser, its policies,
the HTTP backend, the token and the watchdog are gone, and a test asserts that nothing in the installer imports `socket` or
`http.server` or calls `bind`/`listen`.

### Checks

```sh
python3 -m unittest discover -s android/desktop/pc-ab-device/installer/tests -p 'test_*.py'   # python >= 3.11
python3 android/desktop/pc-ab-device/installer/tests/mutations.py --jobs 5                  # every guard removed in turn
python3 android/desktop/pc-ab-device/installer/tests/shots.py OUTDIR                        # screenshots (needs PyGObject + Gtk 3)
```

No root, no real disk: fake `lsblk`/`blockdev`/`wipefs`/`findmnt`/`sgdisk`/`zstd`/`sync`/`systemctl` on `PATH` and sparse temp files;
the production `Host` is replaced only in tests. The GTK tests drive the real widget tree in a `Gtk.OffscreenWindow` (nothing is shown
on a display; keys, arrows, Esc and clicks are simulated at widget level) and skip themselves where PyGObject/Gtk 3 is missing (a runner without Gtk skips the 45
GTK tests; all 169 ran locally in a conda env with Gtk 3.24, Python 3.13). Bazel: `:screen_installer_*_test`. Mutation list:
`installer/tests/mutation-results.txt` (109 of 109 killed).
Screenshots from the widget tree and the design side by side: `installer/screenshots/` (`fonts-used.txt` proves every label is drawn
by the bundled face, `keyboard-walkthrough.txt` is the Tab/Enter sequence).

### VM run (real SystemRescue 13.03, QEMU/TCG on another host, UEFI, one blank and one used virtual NVMe, keyboard + USB tablet)

The revised screens (Figma rev2) from the shipped overlay; screenshots in `installer/screenshots/vm/`, harness in `installer/tests/vm/`
(`mkiso.sh`, `runvm.sh WIDTH HEIGHT` with `-device usb-tablet`, `qmp.py` for keys, absolute pointer moves/clicks and screendumps, `cmp.py`).
Passed on a real X server with no window manager:
- 1024x768, 1920x1080 and 1080x1920 (portrait, stepper bar) boot straight to the screen, content inside the safe area, nothing cut off;
  the pointer is visible, hover and click work through the tablet (a click selects a card and moves the focus to 内容を確認).
- 1366x768 (QEMU `virtio-vga`: the std VGA's screendump is skewed for widths that are not a multiple of 8): one empty SSD preselected,
  the used NVMe and the boot USB shown as 使えません; Enter, Enter, Enter from boot ends on the review screen (やめる had the focus in the
  confirmation) and nothing is written; then Enter, Enter, → インストールする, Enter: a full install to 完了 (11 区画を確認),
  `cmp.py` 8 of 8 data partitions identical to the source image, the used NVMe's sha256 unchanged.
- The monitor geometry/`xrandr` path ran in the VM (one output); several outputs, overscan and HiDPI are covered only by the offscreen
  tests and the fake-display unit tests, not on real hardware.

Earlier rounds (previous UI, same harness): key mashing of Ctrl/Alt/F-keys changed nothing, `kill -9` of the GTK process during the write
did not stop it and the restarted window showed the true state, the text boot entry lists both disks as not selectable.

### Not tested

Failure and "no SSD" screens in the VM (widget-tree screenshots only), the power-off and reboot buttons actually powering the machine
(the first press of the question is tested, the second only against the fake `systemctl`), typing a device path in the text installer
inside the VM (the unit tests cover it), the BIOS/syslinux boot path, real hardware (several outputs, overscan, HiDPI, touch), USB removal
mid-install, 1366x768 on the plain VGA device, window behaviour on a GPU/KMS display (the VM used a framebuffer), and sizes other than
those listed above in the VM (the offscreen layout test covers 13). The time left is not shown: nothing measures it. AGENTS.md prefers
shared policy in `.cljc`; the live system has no Clojure runtime and nothing here may download one, so the guards are stdlib Python.

## KVM check (2026-11-19)

`kvm/shared-disk-test.sh` on a 64 GiB image with three stand-in partitions (ESP 512 MiB, ext4 24 GiB,
8 GiB of random data for LUKS). Their sizes are placeholders: the Desktop's real sizes are not known yet.

- Install: partitions 4 to 14 added, `existingUnchanged: true`
  ([evidence/install-record-kvm-20261119.json](evidence/install-record-kvm-20261119.json)).
- Boot from that disk as the only drive (QEMU `-device nvme`): GRUB printed
  `boot_a=(hd0,gpt12) boot_b=(hd0,gpt13) vendor_boot_a=(hd0,gpt10) vendor_boot_b=(hd0,gpt11)`, and
  Android reached `sys.boot_completed=1` on slot `_a`, build `awai-byname-v2`.
- After a clean shutdown the three stand-in partitions had the same sha256 as before the install.
- `kvm/nvme-kvm.sh` is the earlier check: the stock layout plus a `userdata` partition on one NVMe disk.

## Updater feed in the release build (AWAI-3064)

Configure the pinned LineageOS Updater checkout before building the Awai PC release
`target-files`. Supply the approved HTTPS URL for the selected release channel.
Updater supports the `{device}`, `{type}`, and `{incr}` placeholders. Keep these
quoted when passing a template.

```sh
AWAI_OTA_FEED='https://ota.awai.network/v1/pc/pilot/{device}/{incr}/builds.json'
python3 android/desktop/pc-ab-device/updater-feed.py configure-release \
    "$ANDROID_BUILD_TOP/packages/apps/Updater" "$AWAI_OTA_FEED"
git -C "$ANDROID_BUILD_TOP/packages/apps/Updater" diff --check
```

On the PC pilot, the Updater preference **Automatic PC maintenance** is off by
default. Enabling it requires scheduled checks and streaming. The worker uses a
fresh offer from the pilot feed. It accepts GitHub release assets named by the
ZIP SHA-256, commit-pinned raw URLs, and HTTPS package URLs under
`ota.awai.network/v1/pc/pilot/`. UpdateEngine verifies the streamed A/B payload.
It waits for completed setup, an inactive screen, and a validated, unmetered
connection. It uses external power on devices with a battery. The first
automatic reboot check is scheduled about 20 minutes after UpdateEngine accepts
the payload. Checks back off if the device is in use, and normal scheduled
checks can resume later. Automatic reboot requires the same offer in the fresh
feed and an UpdateEngine completion marker belonging to an automatic update.
Manual update and restart remain available through Updater.

Check the final signed A/B target-files against the SHA-256 from the signing
record. Use Android SDK build-tools `aapt2` on PATH:

```sh
python3 android/desktop/pc-ab-device/updater-feed.py verify-target-files \
    "$SIGNED_TARGET_FILES" "$AWAI_OTA_FEED" \
    --sha256 "$SIGNED_TARGET_FILES_SHA256" --device virtio_x86_64
```

This check reads the actual APK resources, A/B partition set and build
properties for the selected device. Verify the Android signing certificates
as part of the signing workflow. Confirm the installed build contacts the
expected feed. Use the local signing environment with the build's AOSP releasetools on PATH
to generate the full OTA and verify it before the output is made available:

```sh
python3 android/desktop/pc-ab-device/updater-feed.py generate-ota \
    "$SIGNED_TARGET_FILES" "$OTA_ZIP" --key "$OTA_KEY_BASENAME" \
    --certificate-sha256 "$OTA_CERTIFICATE_SHA256" \
    --target-sha256 "$SIGNED_TARGET_FILES_SHA256" --require-streaming > "$OTA_VERIFICATION_RECORD"
```

The key basename refers to the private key and public certificate available
inside the local signing environment. For a delta, also pass the exact signed
source target-files and SHA-256 with `--source-target-files` and `--source-sha256`.
The command makes a new output only after both signature checks pass.

Before publishing an already-produced package, use the build's AOSP releasetools on PATH
to verify the OTA with the public certificate pinned in the signing record:

```sh
python3 android/desktop/pc-ab-device/updater-feed.py verify-ota \
    "$OTA_ZIP" "$OTA_CERTIFICATE" "$SIGNED_TARGET_FILES" \
    --certificate-sha256 "$OTA_CERTIFICATE_SHA256" \
    --target-sha256 "$SIGNED_TARGET_FILES_SHA256" --require-streaming > "$OTA_VERIFICATION_RECORD"
```

For a delta, also pass `--source-target-files "$SIGNED_SOURCE_TARGET_FILES"`
and `--source-sha256 "$SIGNED_SOURCE_TARGET_FILES_SHA256"`. The verifier checks
both the ZIP and A/B payload signatures and binds the package to its exact
build fingerprints and incremental versions. Use the verified OTA SHA-256
from the record to create the feed JSON:

```sh
python3 android/desktop/pc-ab-device/updater-feed.py make-index "$OTA_ZIP" "$OTA_URL" \
    --sha256 "$SIGNED_OTA_SHA256" --device "$OTA_DEVICE" \
    --release-type "$OTA_RELEASE_TYPE" --version "$OTA_VERSION" --require-streaming > "$FEED_INDEX"
```

Use the OTA target device and the installed build's Lineage release type and
version. Pass `--source-build` with the exact source incremental ID for a delta
and publish it at the feed path for that source. Omit the flag for a full OTA.
The index command checks the digest from the signing record and the archive
metadata. For automatic PC maintenance, require usable streaming ranges in both
the signature verification and index commands. The generator always checks
these ranges, including the Updater limit for payload properties.
The updater and Android still verify the signed package on device.
Retain a record of feed detection, apply, reboot, recovery, and rollback on the same PC.

The pilot Worker serves the mutable index as `application/json` with
`Cache-Control: no-store`. The ZIP is a GitHub release asset pinned by its
signed SHA-256 and size. An Awai repository commit-pinned raw URL can serve
a ZIP up to 100 MiB. Follow the [OTA publish runbook](../../../deploy/ota-feed/README.md)
to verify public Range and hash the downloaded bytes before offering an update.

To withdraw an offer, publish `[]` at that device/build path. Updater drops
undownloaded cached offers after a successful empty response. It retains
started updates and saved local packages. A failed request preserves otherwise
eligible cached offers. Keep the signed ZIP for diagnosis and recovery.

## OTA on the shared disk (2026-11-19)

`kvm/shared-ota.sh` and `kvm/shared-ota2.sh`, results in
[evidence/shared-disk-ota-kvm-20261119.json](evidence/shared-disk-ota-kvm-20261119.json). After every
run the VM was shut down and the three stand-in partitions compared: unchanged each time.

| Check | Result |
| --- | --- |
| Full OTA v2 to v3 | `kSuccess`; after reboot slot `_a` to `_b`, build `awai-byname-v3`, slot b marked successful. |
| Full OTA, then `boot_b` (partition 13) zeroed with the VM off | GRUB: `Could not access kernel from active slot b. Switching active slot to a...`. Booted slot a with v2; Android cancelled the update. |
| Incremental v2 to v3, installed from `disk-vda.img` | **Failed**, `kDownloadStateInitializationError`: the source hash of `boot_a` did not match. |
| Incremental v2 to v3, installed from the target-files based image | `kSuccess` in 33 s; booted slot b with v3. |

### Install from target-files, not from `disk-vda.img`

An incremental package checks each source partition against the target-files it was generated from.
`disk-vda.img` is assembled from `PRODUCT_OUT`, and its `boot.img` is not the `IMAGES/boot.img` of the
target-files package (`vendor_boot.img` was the same). `make-tf-disk.sh <target_files.zip> <disk-vda.img> <out>`
writes `IMAGES/boot.img`, `IMAGES/vendor_boot.img` and a `super` built by `build_super_image` into a copy of
the disk image. Install from that. A release works the same way: sign target-files, then make both the
install image and the OTA packages from it.

## Real-hardware drivers (2026-11-19)

`awai-pc.config` adds to the reference kernel (`gki_defconfig` plus the virt fragments):

| Option | State | For |
| --- | --- | --- |
| `CONFIG_R8169`, `CONFIG_REALTEK_PHY` | built in | the Desktop's Realtek NIC |
| `CONFIG_E1000E`, `CONFIG_IGC` | modules, loaded at boot | Intel NICs; they depend on PTP, which is a module |
| `CONFIG_DRM_AMDGPU`, `CONFIG_DRM_AMD_DC` | module, **not loaded automatically** | Radeon 680M |
| `CONFIG_FB_EFI` | built in | console text on the firmware framebuffer |
| `CONFIG_PINCTRL_AMD`, `CONFIG_I2C_PIIX4`, `CONFIG_SENSORS_K10TEMP`, `CONFIG_SND_HDA_CODEC_HDMI` | built in / module | AMD platform |

Results in [evidence/hardware-drivers-kvm-20261119.json](evidence/hardware-drivers-kvm-20261119.json):

- Build `awai-byname-v5` installed on the shared disk (existing partitions unchanged) and booted with an
  **Intel `e1000e` NIC instead of virtio**: `sys.boot_completed=1`, `eth0` on driver `e1000e`, adb over it.
  The Realtek driver itself cannot be exercised in KVM.
- **Without a virtio GPU the system does not finish booting.** SurfaceFlinger aborts in a loop with
  `No matching frame rate modes for primary range`, and adb stays offline.
- The upstream **headless entry** (`androidboot.gpu=vkms androidboot.graphics=swiftshader`) fails the same
  way, also with the virtio GPU attached and also on `awai-byname-v2`, which has no hardware changes. So it
  is not caused by this patch.
- An earlier build with `CONFIG_DRM_SIMPLEDRM` failed the same way. That option was dropped, but the runs do
  not show that simpledrm was the cause.

The headless failure is fixed below. The run without a virtio GPU in the default entry was not repeated
after the fix.

## Headless mode (2026-11-19)

Cause of the crash loop: `device/virt/virt-common/configs/properties/vendor.prop` sets
`ro.surface_flinger.enable_frame_rate_override=false`. With it off, SurfaceFlinger only accepts a display
mode whose refresh rate is inside the render range the framework asks for, 0 to 60 Hz by default
(`config_defaultRefreshRate`). The vkms display of the headless entry reports 60.00384 Hz, so no mode is
left and `RefreshRateSelector::constructAvailableRefreshRates` aborts; the fallback that ignores the
render range applies the same test. Removing the property (the platform default is on) fixes it. A real
monitor mode slightly above 60 Hz would hit the same abort.

While SurfaceFlinger crash-loops there is no adb, because the network comes up with the framework.
`serial_console_function=console` in `grubenv` gives a shell on the serial port; `kvm/con.py` sends one
command to it.

Build `awai-byname-v6`, shared disk, Intel `e1000e` NIC, no virtio GPU (`-vga none -device ramfb`),
headless entry ([evidence/headless-kvm-20261119.json](evidence/headless-kvm-20261119.json)):

- `sys.boot_completed=1`, the only DRM card is vkms, SurfaceFlinger did not exit once, adb over `eth0`.
- Incremental OTA v6 to v7 in that configuration: `kSuccess`; after reboot slot `_b`, `awai-byname-v7`,
  still headless on `e1000e`; the three stand-in partitions unchanged.
- Default entry with the virtio GPU: still boots, SurfaceFlinger did not exit.

What this means for the Desktop: with a wired NIC and adb, an OTA can be checked there without a picture.
A picture needs the AMD driver with its firmware (`amdgpu/yellow_carp_*.bin`, 12 files, 1.7 MB in
linux-firmware 20261019) and the Mesa `radeonsi` stack, which KVM cannot validate. The Realtek NIC and
the firmware's boot path are also only testable on the machine.

## OTA rejection on the shared NVMe disk (2026-11-20)

Build `awai-byname-v8-rollback-policy` omitted `ro.ota.allow_downgrade` from all eight
`build.prop` files in target-files and from the running guest. Each case used a separate shared
NVMe install under QEMU/KVM with the headless SwiftShader entry and an `e1000e` NIC.

| OTA package | Update engine result |
| --- | --- |
| v7 full OTA, signed with the device's test key | `kPayloadTimestampError (51)` |
| v8 full OTA, signed with a separate test key | `kDownloadPayloadPubKeyVerificationError (18)` |

Both guests rebooted into v8 on slot `_a` with `sys.boot_completed=1`. After shutdown, all three
protected partitions matched the SHA-256 hashes recorded at installation.
[Evidence and artifact digests](evidence/ota-rejection-kvm-20261120.json).

## Default boot entry on an AMD PC (AMD Radeon/Mesa, AWAI-3563)

Owner decision 2026-11-22: a 7735H install starts **Awai PC (AMD Radeon, Mesa graphics)** by default.

How GRUB chooses: `grubenv` on the `persist` partition holds `grub_android_default`. The build writes `0`
(the first entry, "LineageOS 24.0", which boots without `androidboot.gpu`/`androidboot.graphics` and so takes
the virtio GPU path, `init.virtio.rc`). Every entry saves its own id there when it boots. The USB installer
copies `persist` and the ESP as they are, and OTA updates neither (see Patches), so a new install starts
with `0`.

`patches/virtio-x86-64-awai-radeon-default.patch` (applied by `pc-firmware.py prepare` after the Radeon
entry patch) adds a block to the end of the device `grub-boot.cfg`. When the normal-boot default is still
the factory `0`, it reads PCI with GRUB's `setpci`:

- a virtio GPU (`1af4:1050`) present: keep the stock entry (KVM, TCG and every VM with `virtio-vga`/`virtio-gpu`);
- otherwise, the first PCI device of vendor `1002` has class `03xx` (display): start the Radeon entry.

It prints `INFO: awai_gpu virtio=… amd_class=… default=…` on the GRUB console. The entry then saves its id,
so later boots use it directly. An entry the user picked (stored by name, for example `android`) is never
replaced, and recovery and `bootonce-bootloader` boots are not affected.

Why detection in GRUB rather than an installer machine profile: it works for every path that installs this
ESP (USB, PXE-written disks, `disk-vda.img`) without a profile to keep in sync, it keeps the VM path as long
as the VM has a virtio GPU, and a disk moved between a VM and a PC still picks the right entry on its first
boot. It does not conflict with PR #379 (AWAI-3747): that patch changes only the distribution name in
`device/virt/virt-common`, while this one changes `device/virt/virtio_x86_64`, matches entries by id, and
the Radeon entry title is fixed text.

Limits:

- Disks installed before this change keep `grub_android_default=0` and their old ESP, because OTA does not
  update the ESP. On those, pick the Radeon entry once under "Advanced options (virtio_x86_64 specific)"
  (it is then saved), or reinstall.
- `setpci` is refused under GRUB lockdown. If UEFI Secure Boot with lockdown is enabled (AWAI-3612), the
  variable stays empty and the stock entry starts; revisit this block then.
- Any `1002` display device matches, including pre-GCN cards that `amdgpu` does not drive.

Checks:

```sh
python3 android/desktop/pc-ab-device/boot-default.py image "$INSTALL_IMAGE"   # ESP grub.cfg + persist grubenv, read only
python3 android/desktop/pc-ab-device/boot-default.py cfg grub.cfg
python3 -m unittest discover -s android/desktop/pc-ab-device -p 'test_*.py'
android/desktop/pc-ab-device/kvm/boot-default-vm.sh "$INSTALL_IMAGE" virtio|amd|amd-saved|amd-stock out/ [patch]
```

`image` fails on the current release candidate (`cd22c762…`) until it is rebuilt with the patch. VM
readback on 2026-11-22 (TCG): [evidence/boot-default-vm-20261122](evidence/boot-default-vm-20261122/README.md).

### Acceptance for first setup and on the 7735H

- First-setup timing results (ANR, reaching Home, input response) are judged only in a **KVM** VM or on the
  machine. Under TCG, an ANR dialog is not a reason to fail: TCG with SwiftShader makes every UI frame take
  seconds, and AOSP re-shows a continuous ANR dialog after "Wait" even when the app responds
  (AWAI-3563 report). Under TCG, record whether `InputDispatcher` logged a new unresponsive window, the
  `Displayed …` activity transitions, and `user_setup_complete`.
- A VM has no Radeon, so graphics are accepted only on the machine.
- The 7735H acceptance record includes `/proc/cmdline`, `ro.vendor.graphics`, `ro.vendor.graphics.gpu`,
  `ro.hardware.egl`, `ro.hardware.vulkan`, and the SurfaceFlinger renderer line.

On the 7735H, after installing an image built with the patch, with no key pressed in the GRUB menu:

1. On the first boot the highlighted entry is under "Advanced options (virtio_x86_64 specific)" and GRUB
   boots `Awai PC (AMD Radeon, Mesa graphics)`.
2. `/proc/cmdline` contains `androidboot.gpu=amdgpu androidboot.graphics=mesa virtio_gpu.modeset=0`.
3. `getprop ro.vendor.graphics.gpu` is `amdgpu`, `ro.vendor.graphics` is `mesa`, `ro.hardware.vulkan` is
   `radeon`, and `ro.hardware.egl` names the Mesa EGL (not `angle`/`swiftshader`).
4. `dumpsys SurfaceFlinger | grep -iE 'renderengine|GLES:'` names AMD/radeonsi, not SwiftShader or llvmpipe.
5. After a reboot, the same entry starts again; `grubenv` has
   `grub_android_default=advancedoptions-virtio_x86_64>android-awai-pc-amd-mesa`.

A user build has no shell, so steps 2 to 4 need the build's approved debug route (AWAI-3682); otherwise
record them as not observed.

## Known gaps

- `init.virtio.rc` still creates `by-name` links to `vda1`, `vda7` and so on. On NVMe they point nowhere
  (`EFI`, `EFI_a`, `EFI_b`, `grub_boot_a`, `grub_boot_b`). Nothing uses them after the second patch.
- Existing partitions appear under `/dev/block/by-name/` with their own names. Android did not mount them.
- OVMF skipped the first ESP, which had no loader, and started GRUB from `awai_esp`. Real firmware may
  need a boot entry, or the PXE route may have to chain-load it.
- No picture without a virtio GPU (headless only), no firmware files in the image, and no release keys.
- No explicit USB mass-storage settings were found in the inspected product files. `vold` can
  discover removable media through block uevents when a disk source matches, without a per-device
  fstab entry. The upstream kernel defconfig, effective kernel configuration, and USB behavior in
  a built Awai OS image remain unverified. See the
  [AWAI-4118 static assessment](../../../docs/evidence/awai-4118-usb-media-awai-os-20261125.md).
