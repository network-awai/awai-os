#!/bin/sh
# Run the update check: refused feeds, a good update, a failing update that must roll back, then
# power off. The image changes, so run it on a copy.
#
# usage: update-check-qemu.sh <image> <feed-dir> <serial-log> [timeout-seconds]
# exit:  0 every check passed
#        1 a check failed
#        3 the check could not run
set -u

image=${1:-}
feed=${2:-}
log=${3:-}
timeout=${4:-600}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}

[ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -d "$feed" ] || { echo "NOT_RUN no feed: $feed"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
[ -f "$firmware" ] || { echo "NOT_RUN no firmware: $firmware"; exit 3; }
command -v qemu-system-aarch64 >/dev/null || { echo "NOT_RUN no qemu"; exit 3; }
feed=$(cd "$feed" && pwd)

: > "$log"
qemu-system-aarch64 \
  -machine virt,accel=hvf -cpu host -smp 2 -m 2048 \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image" \
  -virtfs "local,path=$feed,mount_tag=otehon-feed,security_model=none,readonly=on" \
  -nic none -display none -monitor none -serial "file:$log" &
qemu=$!
trap 'kill "$qemu" 2>/dev/null' EXIT

start=$(date +%s)
while kill -0 "$qemu" 2>/dev/null; do
  [ $(( $(date +%s) - start )) -lt "$timeout" ] || { echo "FAIL timeout"; grep -a -E 'OTEHON_UPDATE|otehon-update:' "$log" | tr -d '\r' | tail -12; exit 1; }
  sleep 2
done

lines=$(grep -a -E 'OTEHON_UPDATE_|otehon-update: (STAGED|CONFIRMED|TRIAL_FAILED|ROLLED_BACK|UNHEALTHY|failed unit)' "$log" | tr -d '\r' | sed -E 's/.*(OTEHON_UPDATE_|otehon-update: )/\1/')
echo "$lines"
need() {
  printf '%s\n' "$lines" | grep -q -- "$1" || { echo "FAIL expected: $1"; exit 1; }
}
need 'good=accepted unsigned=no-signature wrong_key=bad-signature tampered=bad-signature'
need 'unsigned_closure=bad-closure'
need 'CONFIRMED version=2'
need 'REPORT stage=1 generation=b version=2 failed=0'
need 'downgrade=old-version'
need 'TRIAL_FAILED version=3'
need 'failed unit otehon-broken.service'
need 'ROLLED_BACK version=3 installed=2'
need 'REPORT stage=2 generation=b version=2 failed=0'
need 'retry_bad=blocked-version'
need 'REPORT stage=3 generation=b version=2 failed=0'
need 'DONE generation=b version=2'
if printf '%s\n' "$lines" | grep -q 'generation=c version=3'; then echo "FAIL the bad version was accepted"; exit 1; fi
echo PASS
exit 0
