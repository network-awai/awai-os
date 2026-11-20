# Radeon 680M and RTL8168 firmware for Awai PC

Use linux-firmware 20261019 at revision
`a2dcb924f0897368b0b4f305cbf9808cdda90ce0` from the existing build input.
On the build machine, point the tool at its Git checkout and the Android
source checkout. The x86_64 device is pinned to
`50dc14712023705ccf477af49a27ef9109b54d19`. Run this before building the `lineage_virtio_x86_64` product.

```sh
python3 android/desktop/pc-ab-device/pc-firmware.py prepare "$ANDROID_ROOT" "$FIRMWARE_GIT"
```

This adds the pinned Yellow Carp and RTL8168 firmware to the vendor firmware
directory and installs the matching upstream notices and revision alongside the
vendor image. It reads the committed inputs and can be rerun on the same
checkout. It also adds the Radeon option to the x86_64 GRUB submenu and
builds the AMD Minigbm, Mesa and Vulkan paths. Select **Awai PC (AMD Radeon,
Mesa graphics)** on the physical test machine. Run the normal Android build and signing procedure, then verify the
vendor files in the final signed archive.

```sh
python3 android/desktop/pc-ab-device/pc-firmware.py verify "$SIGNED_TARGET_FILES" "$FIRMWARE_GIT"
```

Save the emitted SHA-256 list with the signing record. Verify Radeon display
output and Realtek link on the physical PC using that same signed image.
Track hardware acceptance in AWAI-3605.
