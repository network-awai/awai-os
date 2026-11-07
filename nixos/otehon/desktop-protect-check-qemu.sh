#!/bin/sh
# Boot the desktop-protect check image on macOS with HVF, read the protection steps from the
# serial console, then search the whole disk for the canaries (docs/otehon/protection-0.1.0.md).
# The image is changed, so run the check on a copy (cp -c on APFS costs no space).
#
# usage: desktop-protect-check-qemu.sh <raw-image> <key-disk> <serial-log> <stages> [timeout-seconds]
#        stages: the driver stages this run must pass, in order: "0 1" for a new disk,
#        "2" to reopen a disk that has passed "0 1".
# exit:  0 every step passed and the disk search found only the plain canary
#        1 a step failed, the volume did not open, or the search found a protected canary
#        3 the check could not run
set -u

image=${1:-}
key_disk=${2:-}
log=${3:-}
stages=${4:-}
timeout=${5:-900}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}

[ -n "$image" ] && [ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -f "$key_disk" ] || { echo "NOT_RUN no key disk: $key_disk"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
[ -n "$stages" ] || { echo "NOT_RUN no stages"; exit 3; }
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
  -nic none -display none -monitor none -serial "file:$log" &
qemu=$!
trap 'kill "$qemu" 2>/dev/null' EXIT
started=$(date +%s)
failed=""

line() {
  grep -a "$1" "$log" | head -n 1 | tr -d '\r' | sed "s/.*\($1\)/\1/"
}

for stage in $stages; do
  while :; do
    found=$(line "OTEHON_PROTECT stage=$stage ")
    [ -z "$found" ] || break
    other=$(line "OTEHON_PROTECT stage=none ")
    [ -z "$other" ] || { echo "$other"; line "OTEHON_PROTECT_FACT error"; echo "FAIL the driver found no open volume"; exit 1; }
    browser=$(line "OTEHON_LOGIN_E2E result=fail browser=0")
    if [ -n "$browser" ]; then
      echo "$browser"
      grep -a "otehon-state\|No key available" "$log" | tr -d '\r' | head -n 3
      echo "FAIL state volume did not open, so the desktop did not start"
      exit 1
    fi
    kill -0 "$qemu" 2>/dev/null || { echo "FAIL qemu exited before stage $stage"; exit 1; }
    [ "$(( $(date +%s) - started ))" -lt "$timeout" ] || { echo "FAIL no stage $stage result in ${timeout}s"; exit 1; }
    sleep 3
  done
  echo "$found"
  grep -a "OTEHON_PROTECT_FACT" "$log" | tr -d '\r' | sed 's/.*OTEHON_PROTECT_FACT/OTEHON_PROTECT_FACT/' | sort -u
  case "$found" in
    *" result=pass "*) ;;
    *) failed="stage $stage"; break ;;
  esac
done

while kill -0 "$qemu" 2>/dev/null; do
  [ "$(( $(date +%s) - started ))" -lt "$timeout" ] || { echo "FAIL no poweroff in ${timeout}s"; exit 1; }
  sleep 2
done
echo "BOOTS elapsed=$(( $(date +%s) - started ))s"

# The canaries were joined at run time, so only what the VM wrote can match.
search() {
  LC_ALL=C grep -a -c "$1" "$image" 2>/dev/null || true
}
plain=$(search 'OTEHON_PLAIN_CANARY')
shell=$(search 'OTEHON_SHELL_CANARY')
logged=$(search 'OTEHON_LOG_CANARY')
echo "DISK plain_canary=$plain shell_canary=$shell log_canary=$logged"
[ -z "$failed" ] || { echo "FAIL $failed"; exit 1; }
[ "$plain" -gt 0 ] || { echo "FAIL search did not find the plain canary"; exit 1; }
[ "$shell" = 0 ] || { echo "FAIL the shell canary is readable on disk"; exit 1; }
[ "$logged" = 0 ] || { echo "FAIL the log canary is readable on disk"; exit 1; }
echo "PASS"
exit 0
