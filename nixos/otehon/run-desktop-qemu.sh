#!/bin/sh
# Open the Awai Otehon desktop in a QEMU window on macOS. Changes are written to
# the image. Set OTEHON_DISPLAY to run without a window, for example "none".
#
# User-mode NAT enables outgoing networking; set OTEHON_NETWORK=none for offline use.
# Set OTEHON_AUDIO=coreaudio to expose host audio input/output to the guest.
# usage: run-desktop-qemu.sh <image.qcow2>
set -u

image=${1:-}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}
network=${OTEHON_NETWORK:-user,model=virtio-net-pci}

[ -n "$image" ] && [ -f "$image" ] || { echo "no image: $image" >&2; exit 3; }
[ -f "$firmware" ] || { echo "no firmware: $firmware" >&2; exit 3; }

case ${OTEHON_AUDIO:-none} in
  none) set -- ;;
  coreaudio) set -- -audiodev coreaudio,id=otehon-audio -device virtio-sound-pci,audiodev=otehon-audio ;;
  *) echo "unsupported OTEHON_AUDIO: $OTEHON_AUDIO" >&2; exit 3 ;;
esac

exec qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp ${OTEHON_VM_CPUS:-4} -m ${OTEHON_VM_MEMORY:-4096} \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image" \
  -device virtio-gpu-pci,xres=1440,yres=900 \
  -device qemu-xhci -device usb-kbd -device usb-tablet \
  "$@" \
  -nic "$network" -display "${OTEHON_DISPLAY:-cocoa}" ${OTEHON_QEMU_EXTRA:-}
