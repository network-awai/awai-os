#!/bin/sh
# Open the Awai Otehon desktop in a QEMU window on macOS. Changes are written to
# the image. Set OTEHON_DISPLAY to run without a window, for example "none".
#
# usage: run-desktop-qemu.sh <image.qcow2>
set -u

image=${1:-}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}

[ -n "$image" ] && [ -f "$image" ] || { echo "no image: $image" >&2; exit 3; }
[ -f "$firmware" ] || { echo "no firmware: $firmware" >&2; exit 3; }

exec qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp 4 -m 4096 \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image" \
  -device virtio-gpu-pci,xres=1440,yres=900 \
  -device qemu-xhci -device usb-kbd -device usb-tablet \
  -nic none -display "${OTEHON_DISPLAY:-cocoa}" ${OTEHON_QEMU_EXTRA:-}
