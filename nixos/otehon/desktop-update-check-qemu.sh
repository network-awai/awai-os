#!/bin/sh
# Run the update check on the desktop: the feed timer stages a good update, a trial boot confirms it,
# then a failing update must roll back without help, with the desktop up on each good boot. The
# image changes, so run it on a copy.
#
# usage: desktop-update-check-qemu.sh <image> <feed-dir> <serial-log> [timeout-seconds]
# exit:  0 every check passed
#        1 a check failed
#        3 the check could not run
set -u

image=${1:-}
feed=${2:-}
log=${3:-}
timeout=${4:-1500}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}

[ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -d "$feed" ] || { echo "NOT_RUN no feed: $feed"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
[ -f "$firmware" ] || { echo "NOT_RUN no firmware: $firmware"; exit 3; }
command -v qemu-system-aarch64 >/dev/null || { echo "NOT_RUN no qemu"; exit 3; }
feed=$(cd "$feed" && pwd)

: > "$log"
qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp 4 -m 4096 \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image" \
  -device virtio-gpu-pci,xres=1440,yres=900 \
  -device qemu-xhci -device usb-kbd -device usb-tablet \
  -virtfs "local,path=$feed,mount_tag=otehon-feed,security_model=none,readonly=on" \
  -nic none -display none -monitor none -serial "file:$log" &
qemu=$!
trap 'kill "$qemu" 2>/dev/null' EXIT

pattern='OTEHON_DESKTOP_UPDATE|OTEHON_BOOT_REPORT id=|otehon-update: (READY|NOT_READY|STAGED|CONFIRMED|TRIAL_FAILED|ROLLED_BACK|UNHEALTHY|failed unit)'
start=$(date +%s)
while kill -0 "$qemu" 2>/dev/null; do
  if [ $(( $(date +%s) - start )) -ge "$timeout" ]; then
    echo "FAIL timeout"
    grep -a -E "$pattern" "$log" | tr -d '\r' | tail -12
    exit 1
  fi
  sleep 2
done

lines=$(grep -a -E "$pattern" "$log" | tr -d '\r' | sed -E 's/.*(OTEHON_DESKTOP_UPDATE|OTEHON_BOOT_REPORT|otehon-update:)/\1/')
echo "$lines"
need() {
  printf '%s\n' "$lines" | grep -q -- "$1" || { echo "FAIL expected: $1"; exit 1; }
}
up='compositor=1 chromium=1 react=1 zenoh=1 matter=1 gate=1 failed=0 updater=1'
need "$up update_version=1"
need 'REPORT stage=0 generation=a version=1 failed=0'
need 'STAGED version=2'
need 'CONFIRMED version=2'
need 'REPORT stage=1 generation=b version=2 failed=0'
need 'timer_again=old-version'
need 'STAGED version=3'
need 'UNHEALTHY'
need 'TRIAL_FAILED version=3'
need 'failed unit otehon-broken.service'
need 'ROLLED_BACK version=3 installed=2'
need 'REPORT stage=2 generation=b version=2 failed=0'
need 'retry_bad=blocked-version'
need 'DONE generation=b version=2'
good=$(printf '%s\n' "$lines" | grep -c -- "$up update_version=2")
[ "$good" -ge 2 ] || { echo "FAIL expected the desktop up on 2 boots of version 2, saw $good"; exit 1; }
if printf '%s\n' "$lines" | grep -q 'generation=c version=3'; then echo "FAIL the bad version was accepted"; exit 1; fi
echo PASS
exit 0
