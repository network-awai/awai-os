#!/bin/sh
# Isolated fake adb: no real device is contacted.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/otehon-mobile-test.XXXXXX")
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
mkdir "$fixture/bin"
export P0_CALLS="$fixture/calls"
cat > "$fixture/bin/adb" <<'ADB'
#!/bin/sh
printf '%s\n' "$*" >> "$P0_CALLS"
[ "$1" = -s ] && [ "$2" = test-device ] || exit 98
shift 2
case "$*" in
  get-state)
    case "${P0_MODE:-ok}" in
      offline) echo offline; exit 0 ;;
      unauthorized) echo private-serial >&2; exit 1 ;;
      *) echo device; exit 0 ;;
    esac ;;
  'shell getprop ro.product.model')
    [ "${P0_MODE:-ok}" != missing ] || { echo private-serial >&2; exit 1; }
    printf 'test phone\r\n' ;;
  'shell getprop ro.oem_unlock_supported') : ;;
  'shell getprop '*) printf '0\n' ;;
  *) exit 99 ;;
esac
ADB
chmod +x "$fixture/bin/adb"
PATH="$fixture/bin:$PATH"
export PATH
sh "$root/collect-p0.sh" test-device > "$fixture/report"
[ "$(wc -l < "$P0_CALLS" | tr -d ' ')" = 20 ]
# Check exact command contract and allowlist independently of the collector.
sed 's/^-s test-device //' "$P0_CALLS" > "$fixture/actual"
cat > "$fixture/expected" <<'EXPECTED'
get-state
shell getprop ro.product.manufacturer
shell getprop ro.product.model
shell getprop ro.product.device
shell getprop ro.product.board
shell getprop ro.board.platform
shell getprop ro.product.cpu.abi
shell getprop ro.build.version.release
shell getprop ro.build.version.security_patch
shell getprop ro.build.display.id
shell getprop ro.boot.flash.locked
shell getprop ro.boot.vbmeta.device_state
shell getprop ro.boot.verifiedbootstate
shell getprop sys.oem_unlock_allowed
shell getprop ro.oem_unlock_supported
shell getprop gsm.sim.state
shell getprop ro.treble.enabled
shell getprop ro.build.ab_update
shell getprop ro.boot.dynamic_partitions
shell getprop ro.boot.slot_suffix
EXPECTED
diff -u "$fixture/expected" "$fixture/actual"
grep -qx 'ro.product.model=test phone' "$fixture/report"
grep -qx 'ro.oem_unlock_supported=unknown' "$fixture/report"
! grep -q 'test-device\|private-serial' "$fixture/report"
for mode in offline unauthorized missing; do
  : > "$P0_CALLS"
  export P0_MODE="$mode"
  result=0
  sh "$root/collect-p0.sh" test-device > "$fixture/report" 2> "$fixture/error" || result=$?
  case "$mode" in
    missing)
      [ "$result" = 1 ]
      grep -qx 'ro.product.model=unknown' "$fixture/report"
      grep -qx 'collection_status=1' "$fixture/report" ;;
    *) [ "$result" = 3 ]; [ ! -s "$fixture/report" ]
       [ "$(wc -l < "$P0_CALLS" | tr -d ' ')" = 1 ] ;;
  esac
  ! grep -q 'private-serial\|test-device' "$fixture/report" "$fixture/error"
done
: > "$P0_CALLS"
result=0
sh "$root/collect-p0.sh" > "$fixture/report" 2> "$fixture/error" || result=$?
[ "$result" = 2 ]
[ ! -s "$P0_CALLS" ]
printf 'PASS: fixed read-only commands, explicit target, missing property, transport refusal, redaction, usage\n'
