#!/bin/sh
# Boot the desktop-daily check image on macOS with HVF, twice from one disk, and read the daily
# steps from the serial console (docs/otehon/daily-0.1.0.md). The image is changed, so run the
# check on a copy (cp -c on APFS costs no space).
#
# usage: desktop-daily-check-qemu.sh <raw-image> <key-disk> <serial-log> <web-screenshot.ppm> [timeout-seconds]
# exit:  0 both boots passed, 1 a step failed or no result, 3 the check could not run
set -u

image=${1:-}
key_disk=${2:-}
log=${3:-}
shot=${4:-}
timeout=${5:-900}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}
monitor=$(mktemp -u /tmp/otehon-monitor.XXXXXX)

[ -n "$image" ] && [ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -f "$key_disk" ] || { echo "NOT_RUN no key disk: $key_disk"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
[ -n "$shot" ] || { echo "NOT_RUN no screenshot path"; exit 3; }
[ -f "$firmware" ] || { echo "NOT_RUN no firmware: $firmware"; exit 3; }
command -v qemu-system-aarch64 >/dev/null || { echo "NOT_RUN no qemu"; exit 3; }

: > "$log"
qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp "${OTEHON_VM_CPUS:-4}" -m "${OTEHON_VM_MEMORY:-4096}" \
  -bios "$firmware" \
  -drive "if=virtio,format=raw,file=$image" \
  -drive "if=none,id=keys,format=raw,readonly=on,file=$key_disk" \
  -device virtio-blk-pci,drive=keys,serial=otehon-key \
  -device virtio-gpu-pci,xres=1440,yres=900 \
  -device qemu-xhci -device usb-kbd -device usb-tablet \
  -nic none -display none -monitor "unix:$monitor,server,nowait" -serial "file:$log" &
qemu=$!
trap 'kill "$qemu" 2>/dev/null; rm -f "$monitor"' EXIT
started=$(date +%s)

line() {
  grep -a "$1" "$log" | head -n 1 | tr -d '\r' | sed "s/.*\($1\)/\1/"
}

shot_taken=0
for stage in 0 1; do
  while :; do
    found=$(line "OTEHON_DAILY stage=$stage ")
    [ -z "$found" ] || break
    other=$(line "OTEHON_DAILY stage=none ")
    [ -z "$other" ] || { echo "$other"; line "OTEHON_DAILY_FACT error"; echo "FAIL the driver found no open volume"; exit 1; }
    browser=$(line "OTEHON_LOGIN_E2E result=fail browser=0")
    [ -z "$browser" ] || { echo "$browser"; echo "FAIL no desktop"; exit 1; }
    if [ "$shot_taken" = 0 ] && [ -n "$(line 'OTEHON_DAILY_SCREENSHOT web')" ]; then
      sleep 3
      printf 'screendump %s\n' "$shot" | nc -U -w 3 "$monitor" >/dev/null
      shot_taken=1
    fi
    kill -0 "$qemu" 2>/dev/null || { echo "FAIL qemu exited before stage $stage"; exit 1; }
    [ "$(( $(date +%s) - started ))" -lt "$timeout" ] || { echo "FAIL no stage $stage result in ${timeout}s"; exit 1; }
    sleep 3
  done
  echo "$found"
  grep -a "OTEHON_DAILY_FACT" "$log" | tr -d '\r' | sed 's/.*OTEHON_DAILY_FACT/OTEHON_DAILY_FACT/' | sort -u
  case "$found" in
    *" result=pass "*) ;;
    *) echo "FAIL stage $stage"; exit 1 ;;
  esac
done

while kill -0 "$qemu" 2>/dev/null; do
  [ "$(( $(date +%s) - started ))" -lt "$timeout" ] || { echo "FAIL no poweroff in ${timeout}s"; exit 1; }
  sleep 2
done
echo "BOOTS elapsed=$(( $(date +%s) - started ))s screenshot=$shot_taken"
[ -s "$shot" ] || { echo "FAIL no screenshot of the web window"; exit 1; }
echo "PASS"
exit 0
