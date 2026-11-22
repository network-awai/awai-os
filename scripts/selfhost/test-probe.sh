#!/bin/sh
# Isolated fake adb for probe.sh: no real device is contacted.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/awai-selfhost-test.XXXXXX")
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
mkdir "$fixture/bin"
export PROBE_CALLS="$fixture/calls"
cat > "$fixture/bin/adb" <<'ADB'
#!/bin/sh
printf '%s\n' "$*" >> "$PROBE_CALLS"
[ "$1" = -s ] && [ "$2" = test-device ] || exit 98
shift 2
case "$*" in
  get-state)
    case "${PROBE_MODE:-ok}" in
      offline) echo offline; exit 0 ;;
      unauthorized) echo private-serial >&2; exit 1 ;;
      *) echo device; exit 0 ;;
    esac ;;
  'shell getprop ro.product.model')
    [ "${PROBE_MODE:-ok}" != missing ] || { echo private-serial >&2; exit 1; }
    printf 'test phone\r\n' ;;
  'shell getprop ro.oem_unlock_supported') : ;;
  'shell getprop '*) printf '0\n' ;;
  'shell uname -m') printf 'aarch64\n' ;;
  'shell uname -r') printf '6.6.139-android15-test\n' ;;
  'shell cat /proc/meminfo') printf 'MemTotal:        8111111 kB\nMemAvailable:    4999999 kB\n' ;;
  'shell df /data') printf 'Filesystem 1K-blocks Used Available Use%% Mounted on\n/dev/block/test 106000000 4000000 102000000 4%% /data\n' ;;
  'shell ls /dev/kvm') exit 1 ;;
  'shell pm list features') printf 'feature:android.hardware.test\n' ;;
  'shell pm list packages') printf 'package:com.termux\npackage:com.android.virtualmachine.res\n' ;;
  'shell ls /apex') printf 'com.android.virt@370399999\n' ;;
  *) exit 99 ;;
esac
ADB
chmod +x "$fixture/bin/adb"
PATH="$fixture/bin:$PATH"
export PATH
sh "$root/probe.sh" test-device > "$fixture/report"
# Exact fixed command contract, in order.
sed 's/^-s test-device //' "$PROBE_CALLS" > "$fixture/actual"
cat > "$fixture/expected" <<'EXPECTED'
get-state
shell getprop ro.product.manufacturer
shell getprop ro.product.model
shell getprop ro.product.device
shell getprop ro.product.board
shell getprop ro.board.platform
shell getprop ro.product.cpu.abi
shell getprop ro.build.version.sdk
shell getprop ro.build.version.release
shell getprop ro.build.type
shell uname -m
shell uname -r
shell cat /proc/meminfo
shell df /data
shell ls /dev/kvm
shell pm list features
shell pm list packages
shell ls /apex
EXPECTED
diff -u "$fixture/expected" "$fixture/actual"
grep -qx 'ro.product.model=test phone' "$fixture/report"
grep -qx 'uname_-m=aarch64' "$fixture/report"
grep -qx 'MemTotal=8111111 kB' "$fixture/report"
grep -qx 'dev_kvm=absent' "$fixture/report"
grep -qx 'avf_feature=absent' "$fixture/report"
grep -qx 'pkg_com_termux=present' "$fixture/report"
grep -qx 'pkg_com_android_virt=absent' "$fixture/report"
grep -qx 'pkg_com_android_virtualization_terminal=absent' "$fixture/report"
grep -qx 'apex_virt=present' "$fixture/report"
grep -qx 'collection_status=0' "$fixture/report"
! grep -q 'test-device\|private-serial' "$fixture/report"
for mode in offline unauthorized missing; do
  : > "$PROBE_CALLS"
  export PROBE_MODE="$mode"
  result=0
  sh "$root/probe.sh" test-device > "$fixture/report" 2> "$fixture/error" || result=$?
  case "$mode" in
    missing)
      [ "$result" = 1 ]
      grep -qx 'ro.product.model=unknown' "$fixture/report"
      grep -qx 'collection_status=1' "$fixture/report" ;;
    *) [ "$result" = 3 ]; [ ! -s "$fixture/report" ]
       [ "$(wc -l < "$PROBE_CALLS" | tr -d ' ')" = 1 ] ;;
  esac
  ! grep -q 'private-serial\|test-device' "$fixture/report" "$fixture/error"
done
unset PROBE_MODE
: > "$PROBE_CALLS"
result=0
sh "$root/probe.sh" > "$fixture/report" 2> "$fixture/error" || result=$?
[ "$result" = 2 ]
[ ! -s "$PROBE_CALLS" ]
printf 'PASS: fixed read-only commands, explicit target, empty/missing property, transport refusal, redaction, usage\n'
