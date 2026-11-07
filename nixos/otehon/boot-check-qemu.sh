#!/bin/sh
# Boot an Awai Otehon image on macOS and read its boot report from the serial console.
# aarch64 runs with HVF. OTEHON_ARCH=x86_64 runs an x86_64 image under TCG (emulated,
# slow: give it a longer timeout).
#
# usage: boot-check-qemu.sh <image> <serial-log> [timeout-seconds]
# exit:  0 report seen with failed=0
#        1 report seen with failed units, or no report before the timeout
#        3 the check could not run
set -u

image=${1:-}
log=${2:-}
timeout=${3:-180}
arch=${OTEHON_ARCH:-aarch64}
case "$arch" in
  aarch64) firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd} ;;
  x86_64) firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-x86_64-code.fd} ;;
  *) echo "NOT_RUN unknown OTEHON_ARCH: $arch"; exit 3 ;;
esac

[ -n "$image" ] && [ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
[ -f "$firmware" ] || { echo "NOT_RUN no firmware: $firmware"; exit 3; }
command -v "qemu-system-$arch" >/dev/null || { echo "NOT_RUN no qemu-system-$arch"; exit 3; }

: > "$log"
if [ "$arch" = aarch64 ]; then
  set -- -machine virt,accel=hvf -cpu host -bios "$firmware"
else
  set -- -machine q35,accel=tcg -cpu max -drive "if=pflash,format=raw,readonly=on,file=$firmware"
fi
"qemu-system-$arch" "$@" -smp 2 -m 2048 \
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
