#!/bin/sh
# Run the Awai Otehon base image through first boot, update, rollback and
# shutdown on macOS with HVF, then check the firewall and the disk contents.
# The image is changed, so run the check on a copy.
#
# usage: base-check-qemu.sh <image> <key-disk|none> <serial-log> [timeout-seconds]
# exit:  0 every check passed
#        1 a check failed
#        3 the check could not run
set -u

image=${1:-}
key_disk=${2:-}
log=${3:-}
timeout=${4:-420}
firmware=${OTEHON_EDK2:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}
allowed_port=18443
closed_port=18444

[ -n "$image" ] && [ -f "$image" ] || { echo "NOT_RUN no image: $image"; exit 3; }
[ -n "$key_disk" ] || { echo "NOT_RUN no key disk argument"; exit 3; }
[ "$key_disk" = none ] || [ -f "$key_disk" ] || { echo "NOT_RUN no key disk: $key_disk"; exit 3; }
[ -n "$log" ] || { echo "NOT_RUN no serial log path"; exit 3; }
[ -f "$firmware" ] || { echo "NOT_RUN no firmware: $firmware"; exit 3; }
for tool in qemu-system-aarch64 qemu-img nc; do
  command -v "$tool" >/dev/null || { echo "NOT_RUN no $tool"; exit 3; }
done

set -- -machine virt,accel=hvf -cpu host -smp 2 -m 2048 \
  -bios "$firmware" \
  -drive "if=virtio,format=qcow2,file=$image" \
  -nic "user,restrict=on,hostfwd=tcp:127.0.0.1:$allowed_port-:8443,hostfwd=tcp:127.0.0.1:$closed_port-:8444" \
  -display none -monitor none -serial "file:$log"
if [ "$key_disk" != none ]; then
  set -- "$@" -drive "if=none,id=keys,format=raw,readonly=on,file=$key_disk" \
    -device virtio-blk-pci,drive=keys,serial=otehon-key
fi

: > "$log"
qemu-system-aarch64 "$@" &
qemu=$!
raw=""
trap 'kill "$qemu" 2>/dev/null; [ -z "$raw" ] || rm -f "$raw"' EXIT

report() {
  grep -a "OTEHON_BOOT_REPORT .*stage=$1 " "$log" | head -n 1 | tr -d '\r'
}

field() {
  printf '%s\n' "$1" | sed -n "s/.* $2=\([^ ]*\).*/\1/p"
}

probe() {
  nc -w 4 127.0.0.1 "$1" </dev/null 2>/dev/null | tr -d '\r' | head -n 1
}

# Every boot must have open state, the secret, listeners and no failed units.
require_healthy() {
  for pair in state=1 sops=1 listeners=1 failed=0; do
    case " $1 " in
      *" $pair "*) ;;
      *) echo "FAIL expected $pair: $1"; exit 1 ;;
    esac
  done
}

wait_report() {
  while :; do
    kill -0 "$qemu" 2>/dev/null || { echo "FAIL qemu exited before stage $1"; exit 1; }
    found=$(report "$1")
    [ -z "$found" ] || return 0
    closed=$(report none)
    [ -z "$closed" ] || { echo "$closed"; echo "FAIL state volume did not open"; exit 1; }
    [ "$(( $(date +%s) - started ))" -lt "$timeout" ] || { echo "FAIL no stage $1 report in ${timeout}s"; exit 1; }
    sleep 2
  done
}

started=$(date +%s)
expected=a
marker=""
for stage in 0 1 2; do
  wait_report "$stage"
  echo "$found"
  require_healthy "$found"
  case "$stage" in 1) expected=b ;; *) expected=a ;; esac
  [ "$(field "$found" generation)" = "$expected" ] || {
    echo "FAIL stage $stage expected generation $expected"
    exit 1
  }
  current=$(field "$found" marker)
  [ -n "$current" ] && [ "$current" != none ] || { echo "FAIL no marker at stage $stage"; exit 1; }
  [ -z "$marker" ] || [ "$marker" = "$current" ] || { echo "FAIL state changed across reboot"; exit 1; }
  marker=$current
done

[ "$(probe $allowed_port)" = OTEHON_PORT_OPEN ] || { echo "FAIL allowed port not reachable"; exit 1; }
[ -z "$(probe $closed_port)" ] || { echo "FAIL closed port reachable"; exit 1; }
echo "PORTS allowed=open closed=dropped"

while kill -0 "$qemu" 2>/dev/null; do
  [ "$(( $(date +%s) - started ))" -lt "$timeout" ] || { echo "FAIL no poweroff in ${timeout}s"; exit 1; }
  sleep 2
done

raw=$(mktemp "$image.raw.XXXXXX") || { echo "NOT_RUN no temp file"; exit 3; }
qemu-img convert -O raw "$image" "$raw" || { echo "NOT_RUN qemu-img failed"; exit 3; }
LC_ALL=C grep -a -q 'OTEHON_PLAIN_CANARY' "$raw" || { echo "FAIL search did not find the plain canary"; exit 1; }
if LC_ALL=C grep -a -q 'OTEHON_ENCRYPTED_CANARY' "$raw"; then
  echo "FAIL encrypted canary is readable on disk"
  exit 1
fi
echo "DISK plain_canary=found encrypted_canary=absent"
echo "PASS"
exit 0
