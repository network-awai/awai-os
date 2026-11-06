#!/bin/sh
# Boot an Awai Otehon aarch64 image on macOS with HVF and read its boot report
# from the serial console.
#
# usage: boot-check-qemu.sh <image> <serial-log> [timeout-seconds]
# exit:  0 report seen with failed=0
#        1 report seen with failed units, or no report before the timeout
#        3 the check could not run
set -u

image=${1:-}
log=${2:-}
timeout=${3:-180}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}

[ -n "$image" ] && [ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
[ -f "$firmware" ] || { echo "NOT_RUN no firmware: $firmware"; exit 3; }
command -v qemu-system-aarch64 >/dev/null || { echo "NOT_RUN no qemu"; exit 3; }

: > "$log"
qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp 2 -m 2048 \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image,snapshot=on" \
  -nic none -display none -monitor none -serial "file:$log" &
qemu=$!
trap 'kill "$qemu" 2>/dev/null' EXIT

elapsed=0
while [ "$elapsed" -lt "$timeout" ]; do
  kill -0 "$qemu" 2>/dev/null || { echo "FAIL qemu exited after ${elapsed}s"; exit 1; }
  report=$(grep -a -m1 'OTEHON_BOOT_REPORT id=' "$log" | tr -d '\r')
  if [ -n "$report" ]; then
    echo "$report elapsed=${elapsed}s"
    case "$report" in
      *" failed=0") exit 0 ;;
      *) echo "FAIL failed units reported"; exit 1 ;;
    esac
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "FAIL no boot report in ${timeout}s"
exit 1
