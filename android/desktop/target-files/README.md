# target-files for the source-built PC image (AWAI-3061)

`m target-files-package` is the input for release signing (`sign_target_files_apks`) and for OTA packages.
On `lineage_Generic_x86_64` it failed while packing `vendor_boot`:

```
mkbootimg: ValueError: --vendor_boot not compatible with given header version
```

## Cause

`device/mainline/generic/BoardConfig.mk` sets `BOARD_BOOT_HEADER_VERSION := 4` but does not add
`--header_version` to `BOARD_MKBOOTIMG_ARGS`. When target-files is packed, `add_img_to_target_files`
passes only `mkbootimg_args` from `META/misc_info.txt` to mkbootimg. That value was empty, so mkbootimg
used header version 0, which has no vendor boot image. goldfish, cuttlefish and `device/virt/virt-common`
carry the same line this patch adds.

## Fix

[mkbootimg-header-version.patch](mkbootimg-header-version.patch) adds one line to the device tree
(revision `4cc0f606`):

```make
BOARD_MKBOOTIMG_ARGS += --header_version $(BOARD_BOOT_HEADER_VERSION)
```

Apply it to a synced source tree:

```sh
android/desktop/target-files/apply.sh <source tree root>
```

The script does nothing when the line is already there.

## Result on 2026-11-19

[evidence/target-files-20261119.json](evidence/target-files-20261119.json) records the run on the Vultr
build host:

- `lineage_Generic_x86_64-target_files.zip`, 2,780,221,057 bytes,
  sha256 `6c757cce14ec69c5b5b66436950a7e127f7e3a82f35e5caed8250994d59b7285`;
- it contains `IMAGES/vendor_boot.img`, and `META/misc_info.txt` has `mkbootimg_args=--header_version 4`.

The first run after the patch stopped at 97% for an unrelated reason: the filesystem repair of the
restored build host had damaged the git metadata of four projects, and `repo manifest -r` (which writes
`build-manifest.xml`) could not read them. After those four were fetched again, the rerun finished.
A check of the source tree after a repair must run `git rev-parse HEAD` in every project;
`git status` alone reports a project without git metadata as unchanged.

## Not shown

- signing with release keys: the package is signed with test-keys;
- A/B and an OTA a device can install: this device has `AB_OTA_UPDATER := false` and no recovery;
- a boot of the images in this package.
