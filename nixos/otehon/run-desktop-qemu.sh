#!/bin/sh
# Open the Awai Otehon desktop in a QEMU window on macOS. Changes are written to
# the image. Set OTEHON_DISPLAY to run without a window, for example "none".
#
# usage: run-desktop-qemu.sh <image.qcow2>
# The desktop opens its encrypted state volume with a key disk (protection-0.1.0.md). Set
# OTEHON_KEY_DISK to one made by base-make-key-disk.sh; without it the desktop does not start.
set -u

image=${1:-}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}

[ -n "$image" ] && [ -f "$image" ] || { echo "no image: $image" >&2; exit 3; }
[ -f "$firmware" ] || { echo "no firmware: $firmware" >&2; exit 3; }

key_args=""
[ -z "${OTEHON_KEY_DISK:-}" ] || key_args="-drive if=none,id=keys,format=raw,readonly=on,file=$OTEHON_KEY_DISK -device virtio-blk-pci,drive=keys,serial=otehon-key"
exec qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp ${OTEHON_VM_CPUS:-4} -m ${OTEHON_VM_MEMORY:-4096} \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image" \
  -device virtio-gpu-pci,xres=1440,yres=900 \
  -device qemu-xhci -device usb-kbd -device usb-tablet \
  -nic none -display "${OTEHON_DISPLAY:-cocoa}" $key_args ${OTEHON_QEMU_EXTRA:-}
