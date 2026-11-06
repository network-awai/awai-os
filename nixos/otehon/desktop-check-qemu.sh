#!/bin/sh
# Boot the Awai Otehon desktop on macOS with HVF, read its boot report from the
# serial console and save a screenshot of the display.
#
# usage: desktop-check-qemu.sh <image> <serial-log> <screenshot.ppm> [timeout-seconds]
# exit:  0 report with every component up and failed=0, and a screenshot was saved
#        1 report with another state, no report before the timeout, or no screenshot
#        3 the check could not run
set -u

image=${1:-}
log=${2:-}
shot=${3:-}
timeout=${4:-420}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}
monitor=$(mktemp -u /tmp/otehon-monitor.XXXXXX)

[ -n "$image" ] && [ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -n "$log" ] && [ -n "$shot" ] || { echo "NOT_RUN no output paths"; exit 3; }
[ -f "$firmware" ] || { echo "NOT_RUN no firmware: $firmware"; exit 3; }
command -v qemu-system-aarch64 >/dev/null || { echo "NOT_RUN no qemu"; exit 3; }
command -v nc >/dev/null || { echo "NOT_RUN no nc"; exit 3; }

: > "$log"
rm -f "$shot"
qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp 4 -m 4096 \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image,snapshot=on" \
  -device virtio-gpu-pci,xres=1440,yres=900 \
  -device qemu-xhci -device usb-kbd -device usb-tablet \
  -nic none -display none -monitor "unix:$monitor,server,nowait" -serial "file:$log" &
qemu=$!
trap 'kill "$qemu" 2>/dev/null; rm -f "$monitor"' EXIT

elapsed=0
while [ "$elapsed" -lt "$timeout" ]; do
  kill -0 "$qemu" 2>/dev/null || { echo "FAIL qemu exited after ${elapsed}s"; exit 1; }
  report=$(grep -a -m1 'OTEHON_BOOT_REPORT id=' "$log" | tr -d '\r')
  if [ -n "$report" ]; then
    echo "$report elapsed=${elapsed}s"
    printf 'screendump %s\n' "$shot" | nc -U -w 3 "$monitor" >/dev/null
    sleep 2
    [ -s "$shot" ] || { echo "FAIL no screenshot"; exit 1; }
    case "$report" in
      *" compositor=1 chromium=1 react=1 zenoh=1 matter=1 gate=1 failed=0"*) exit 0 ;;
      *) echo "FAIL unexpected desktop state"; exit 1 ;;
    esac
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "FAIL no boot report in ${timeout}s"
exit 1
