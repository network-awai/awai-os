# Radeon 680M and RTL8168 firmware for Awai PC

Use linux-firmware 20261019 at revision
`a2dcb924f0897368b0b4f305cbf9808cdda90ce0` from the existing build input.
On the build machine, point the tool at its Git checkout and the Android
source checkout. The x86_64 device is pinned to
`0e8571a0d7fce749856e9dea72e99a8a83f8f9b4` (the pinned manifest
revision; the earlier `50dc1471…` is not resolvable on GitHub or
Gerrit — a host-local commit, like the old `4cc0f606…` build-input
SHA). Run this before building the `lineage_virtio_x86_64` product.

```sh
python3 android/desktop/pc-ab-device/pc-firmware.py prepare "$ANDROID_ROOT" "$FIRMWARE_GIT"
```

This adds pinned Yellow Carp firmware to the vendor image and selects the Android
`linux_firmware_r8168` module to install the RTL8168 firmware. Preparation checks
that all 13 Android RTL8168 files match the pinned bytes before generating
the Awai overlay. The overlay also installs the matching upstream notices
and revision. Preparation can be rerun on the same checkout. For a checkout
prepared by the earlier overlay, preserve and move the previous
`vendor/awai/pc-firmware` directory aside before running preparation again.
The tool also adds the Radeon option to the x86_64 GRUB submenu, makes it the
first-boot default on a PC with an AMD GPU and no virtio GPU (see "Default boot
entry" in [README.md](README.md)), and builds the AMD Minigbm, Mesa and Vulkan
paths. Run the normal Android build and signing procedure, then verify the
vendor files in the final signed archive.

```sh
python3 android/desktop/pc-ab-device/pc-firmware.py verify "$SIGNED_TARGET_FILES" "$FIRMWARE_GIT"
```

Save the emitted SHA-256 list with the signing record. Verify Radeon display
output and Realtek link on the physical PC using that same signed image.
Track hardware acceptance in AWAI-3605.
