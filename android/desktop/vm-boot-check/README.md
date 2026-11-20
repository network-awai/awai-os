# KVM boot check for the source-built PC image (AWAI-3540)

`bm-boot-check.sh` boots the source-built Live ISO from [AWAI-3061](https://linear.app/kotobalabs/issue/AWAI-3061)
on a Linux host with KVM, the same way the Desktop boots it over the LAN:
- the kernel and the netboot initrd (the built ramdisk plus the `../netboot/init.sh` overlay);
- the ISO, served read-only over NBD as `awai2992` at `10.77.0.1:10829`.

It then checks Android over adb and saves a screenshot. It is the routine check for each build. The Desktop
is kept for what only real hardware can show (the Radeon 680M, DP-1 output, the Realtek NIC).

## Use

On the KVM host, as root, with `qemu-system-x86`, `qemu-utils`, `adb` and `python3` installed:

```sh
bm-boot-check.sh <dir> std
```

`<dir>` holds `kernel`, `initrd`, `live.iso` and `cmdline.txt` (the netboot command line from the iPXE
script). The script writes `<dir>/run-<UTC>-std/` with `result.json`, `screen.png`, `serial.log` and
`steps.log`. `virgl` instead of `std` asks for host GPU rendering; it needs a `/dev/dri/renderD128` node.

## What it does to the guest (VM only)

- Android 17 starts in trade-in mode until setup is finished: adb then serves only `tradeinmode`
  commands. The script sets `device_provisioned=1` and `user_setup_complete=1` over the serial console.
- It writes the host's adb public key to `/data/misc/adb/adb_keys` so adb is authorised.

On a real device these steps happen through the setup wizard and the adb confirmation dialog instead.
Never treat the VM result as acceptance of a device.

## Result on 2026-11-18

[evidence/bm-boot-20261118.json](evidence/bm-boot-20261118.json) records the run:
- **Host:** Vultr bare metal `vbm-6c-32gb`, Xeon E-2286G with VT-x, QEMU 8.2.2 with KVM.
- **Boot:** `sys.boot_completed=1` within 37 s.
- **adb:** `adb shell` as uid 2000.
- **Build:** `Generic/lineage_Generic_x86_64/Generic_x86_64:17/CP2A.260605.016/eng.root:userdebug/test-keys`, kernel 7.3.0+.
- **Graphics:** SurfaceFlinger runs with ANGLE.
- **Screen:** the setup wizard is drawn ([screenshot](evidence/bm-boot-20261118-setupwizard.png)).

The same ISO under QEMU without KVM (TCG) took about 6 minutes to boot and drew a black screen. That host
is not suitable for this check.

## Not shown

- the Desktop hardware, which needs its own run (see AWAI-3061);
- Awai branding or apps (this is the unmodified LineageOS build);
- release signing, A/B or OTA.
