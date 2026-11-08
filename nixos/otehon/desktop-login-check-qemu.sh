#!/bin/sh
# Boot the desktop-login check image on macOS with HVF and read the sign-in test result
# from the serial console.
#
# usage: desktop-login-check-qemu.sh <image> <serial-log> <screenshot.ppm> [timeout-seconds]
# The desktop opens its encrypted state volume with a key disk (protection-0.1.0.md). Set
# OTEHON_KEY_DISK to one made by base-make-key-disk.sh; without it the desktop does not start.
# exit:  0 every step passed
#        1 a step failed, or no result before the timeout
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
key_args=""
[ -z "${OTEHON_KEY_DISK:-}" ] || key_args="-drive if=none,id=keys,format=raw,readonly=on,file=$OTEHON_KEY_DISK -device virtio-blk-pci,drive=keys,serial=otehon-key"
qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp ${OTEHON_VM_CPUS:-4} -m "${OTEHON_QEMU_MEMORY:-${OTEHON_VM_MEMORY:-4096}}" \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image,snapshot=on" \
  -device virtio-gpu-pci,xres=1440,yres=900 \
  -device qemu-xhci -device usb-kbd -device usb-tablet \
  -nic none -display none -monitor "unix:$monitor,server,nowait" -serial "file:$log" $key_args ${OTEHON_QEMU_EXTRA:-} &
qemu=$!
trap 'kill "$qemu" 2>/dev/null; rm -f "$monitor"' EXIT

elapsed=0
while [ "$elapsed" -lt "$timeout" ]; do
  kill -0 "$qemu" 2>/dev/null || { echo "FAIL qemu exited after ${elapsed}s"; exit 1; }
  result=$(grep -a -m1 'OTEHON_LOGIN_E2E result=' "$log" | tr -d '\r' | sed 's/.*OTEHON_LOGIN_E2E/OTEHON_LOGIN_E2E/')
  if [ -n "$result" ]; then
    echo "$result elapsed=${elapsed}s"
    printf 'screendump %s\n' "$shot" | nc -U -w 3 "$monitor" >/dev/null
    sleep 2
    case "$result" in
      *"result=pass"*) exit 0 ;;
      *) grep -a 'OTEHON_LOGIN_STEP' "$log" | tr -d '\r' | tail -3; echo "FAIL sign-in test"; exit 1 ;;
    esac
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
echo "FAIL no sign-in result in ${timeout}s"
grep -a 'OTEHON_LOGIN_STEP' "$log" | tr -d '\r' | tail -3
exit 1
