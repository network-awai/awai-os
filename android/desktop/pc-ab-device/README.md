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
- It copies each partition from the partition of the same name in the build's disk image. The Awai ESP
  is named `awai_esp`.
- It requires 512-byte logical sectors on both the source and target and refuses to use the same
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
| `installer/controller.py` | front-end-neutral controller: list/confirm -> one-shot ticket -> typed device name -> exactly one detached worker, true install state, power-off question. Unit-tested without GTK. |
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
an unattended boot only reaches the installer screen, which still needs the typed device name. The kernel and initrd lines
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

Order of `run_install`: typed device name == target -> target checks and identity (major:minor, size, model, serial,
WWN; a serial or WWN appearing or vanishing counts as a change) equal to what was confirmed -> `archive.sha256` ->
raw image sha256 == pinned value -> plan with `existing == []` and the expected number of new partitions ->
**all target checks and identity again, plus a fresh plan, immediately before writing** ->
`awai-pc-install.py apply --record` -> record has `sourceSha256 == pinned`, `existingUnchanged`, one readback per
partition with a digest -> `sgdisk -v` exit 0 and "No problems found" -> `sync` -> only then `done`. Any other path ends
in `failed`; the window shows the completion screen only for `state == "done"`.

Two-step confirmation: the review screen asks for the device name (`nvme0n1`); the controller checks it and the worker
checks it again. The text installer still asks for `INSTALL nvme0n1` and hands the name to the same check.

One install: the worker holds `flock` on `/run/awai-pc-installer/lock`; it is a separate, detached process (own session), so
closing, killing or crashing the GTK window neither stops the write nor allows another. A restarted window reads the true state
(`running` only with a live lock holder; `running` without one is reported as interrupted, never as running or done).
`write-started` / `install-record.json` block any further start until reboot (`/run` is a tmpfs). Reboot and power off are
refused by the controller while an install runs, and the buttons are disabled. The ticket from `内容を確認` (identity at that
moment) is consumed by the one start, whatever happens; a wrong typed name consumes it too.

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

**Proportions.** One design unit `u = min(W/740, H/440)` pixels scales text, logo, cards and gaps with the screen; the rail is 30.5% of
the width and cards 57.7%, as in `design/installer.png`. Gtk CSS only, software rendering (no GL): the window uses the plain cairo
paths of GTK 3.

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
on a display; Tab/Enter/typing are simulated at widget level) and skip themselves where PyGObject/Gtk 3 is missing (CI runs
117 of 130 tests there; the 13 GTK tests ran locally in a conda env with Gtk 3.24). Bazel: `:screen_installer_*_test`. Mutation list:
`installer/tests/mutation-results.txt` (77 of 78 guards killed; the one survivor is equivalent offscreen and covered by the VM run).
Screenshots from the widget tree and the design side by side: `installer/screenshots/` (`fonts-used.txt` proves every label is drawn
by the bundled face, `keyboard-walkthrough.txt` is the Tab/Enter sequence).

### VM run (real SystemRescue 13.03, QEMU/TCG on another host, UEFI, one blank and one used virtual NVMe)

Built with `build-overlay.py`'s `build_overlay` into the shipped ISO; screenshots in `installer/screenshots/vm/`.
Passed: GRUB default entry starts the GTK window by itself; screens 1, 2, 3 and the wrong-name case (button stays disabled);
Ctrl+T/N/L/W/O/Q, Ctrl+Shift+I, Alt+F4, Alt+Tab, Alt+F2, Ctrl+Alt+Backspace, F1-F12, Menu, Super, Print and Ctrl+Alt+Delete pressed on
the review screen change nothing (typed text still there, nobody left the screen); Ctrl+Alt+F2 reaches the console and X does not take
it back; the power-off question (first Enter asks, it stays asked across polls, Tab away disarms it); a full install to 完了 (11 区画);
`kill -9` of the GTK process at step 2, 36.46 %, `written: started` - the write went on and the restarted window showed the true
state (step 3) and then 完了; all 8 data partitions identical to the source image and the used NVMe byte-identical (sha256 unchanged);
screen 6 with only the used disk; the text boot entry (`awai.installer=text`) starts the text installer and lists both disks as
not selectable with the reasons. The VM run found one bug, fixed before this record: the power-off question disarmed itself when the
poll redrew the screen (rebuilding destroyed the focused button, which counted as the user leaving it); two tests now pin it.

### Not tested

Failure screens in the VM (they are in the widget-tree screenshots only), the power-off and reboot buttons actually powering the machine
(the first press of the question is tested, the second only against the fake `systemctl`), typing a device path in the text installer
inside the VM (the harness did not deliver it; the unit tests cover it), the BIOS/syslinux boot path, 1920x1080 in the VM (VGA was
1280x720), real hardware, USB removal mid-install, and window behaviour on a GPU/KMS display (the VM used the VGA framebuffer). The old
text installer's `sgdisk -v` wording ("No problems found") was confirmed by the real install above. AGENTS.md prefers shared policy in
`.cljc`; the live system has no Clojure runtime and nothing here may download one, so the guards are stdlib Python next to the existing
Python installer.

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
