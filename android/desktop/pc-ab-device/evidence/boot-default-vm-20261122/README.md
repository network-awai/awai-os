# Default GRUB entry, isolated VM readback (2026-11-22, AWAI-3563)

Input: the privacy release-candidate install image `awai-pc-install.img`,
SHA-256 `cd22c7624f0058b0972c6d49b0b8d51aedc2e4c919486ed48bbf404d9c16d396` (decompressed from the USB
installer overlay and re-hashed). Its ESP `grub.cfg` (SHA-256 `7bedc0a6…a8155e`) is byte-identical to the
one captured from the 0712 install, and its persist `grubenv` holds `grub_android_default=0`.

Each case ran `kvm/boot-default-vm.sh` on a clone of that image. The patch case appends the lines that
`patches/virtio-x86-64-awai-radeon-default.patch` adds (SHA-256 `30d235e7…bb9cb7`). The device part of the
result is identical to the patched `device/virt/virtio_x86_64` `bootmgr/grub/grub-boot.cfg`
(lineage-24.0 `0e8571a` plus both Radeon patches, distribution name substituted). Host: Apple Silicon Mac,
QEMU 11.1.3, **TCG** (no KVM), q35, OVMF, NVMe disk, no network. The original image was not written.

| Case | GPU | Patch | GRUB line on serial | `grub_android_default` after the run | Result |
| --- | --- | --- | --- | --- | --- |
| virtio | `virtio-vga` (1af4:1050) | yes | `INFO: awai_gpu virtio=1af4 amd_class= default=0` | `android` (stock first entry, then the kernel and ramdisk loaded) | pass |
| amd | `ati-vga` (1002, class 0300) | yes | `INFO: awai_gpu virtio= amd_class=300 default=advancedoptions-virtio_x86_64>android-awai-pc-amd-mesa`; `Booting 'Awai PC (AMD Radeon, Mesa graphics)'` | `advancedoptions-virtio_x86_64>android-awai-pc-amd-mesa` | pass |
| amd-saved | `ati-vga` | yes, grubenv set to `android` first | none (detection skipped) | `android` | pass |
| amd-stock | `ati-vga` | no (negative control) | none | `android` | pass: without the patch an AMD GPU gets the stock entry |

Two first attempts (virtio, amd-stock) reached the 150 s limit before GRUB finished under TCG; they were
rerun with 540 s and 400 s. The ati-vga runs only reach the entry choice: that emulated card is not an
amdgpu device, so Android graphics on Radeon are not tested here.

Files: `*-serial.log` (ANSI sequences removed), `*-result.json`, `grub-patched.cfg`.
